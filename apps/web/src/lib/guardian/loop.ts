import type { Content, FunctionCall, Part } from '@google/genai';
import {
  MandateView,
  Transfer,
  messageGuard,
  ruleTextJa,
  shouldEscalate,
  type AuditEvent,
  type ReasonCode,
  type SystemPolicy,
} from '@matta/core';
import { TOOL_ARGS, AUTO_NOTICE_JA, FAIL_SAFE_JA, RESOURCE_JA, type ToolName } from './tools';
import { MIN_TELLER_CHECKS, TellerCheck, type Breaker, type Conversation, type ConversationView, type GuardianStore } from './state';
import { estCostJpy } from '../../config/pricing';

/** One model response, reduced to what the loop needs (keeps tests free of the SDK). */
export type ModelReply = { content: Content | undefined; functionCalls: FunctionCall[]; tokensIn: number; tokensOut: number };

export type Deps = {
  model: (contents: Content[], signal: AbortSignal) => Promise<ModelReply>;
  modelName: string;
  /** callBank: W token + the customer's Firebase token. */
  bank: (path: string, opts: { method?: string; body?: unknown; userToken?: string }) => Promise<unknown>;
  store: GuardianStore;
  policy: SystemPolicy;
  policyHash: string;
  audit: (e: Omit<AuditEvent, 'id' | 'ts' | 'service'>) => Promise<void>;
  now: () => Date;
};

export type Caller = { uid: string; sandboxId: string; token: string };

const MAX_MODEL_CALLS_PER_STEP = 8;
const BREAKER_WINDOW = 20;
// ponytail: min sample 5 so one early failure doesn't pause everything; half-open probe after 5 min.
const BREAKER_MIN_SAMPLE = 5;
const BREAKER_PROBE_MS = 5 * 60_000;

export class ConversationClosed extends Error {}

const view = (c: Conversation, paused: boolean): ConversationView => {
  const { contentsJson: _c, assessment: _a, ...rest } = c;
  return { ...rest, paused };
};

/** Runs the guardian until it asks the customer something or ends. `customerText` undefined = start. */
export async function runStep(deps: Deps, caller: Caller, transferId: string, customerText?: string): Promise<ConversationView> {
  const nowIso = () => deps.now().toISOString();
  const transfer = async () => Transfer.parse(await deps.bank(`/v1/transfers/${transferId}`, { userToken: caller.token }));
  const t0 = await transfer(); // also proves the caller owns this transfer (bank checks sandbox)
  const base = { sandboxId: caller.sandboxId, targetType: 'transfer', targetId: transferId, policyHash: deps.policyHash };

  let conv: Conversation = (await deps.store.loadConversation(transferId)) ?? {
    transferId,
    sandboxId: caller.sandboxId,
    customerUid: caller.uid,
    status: 'open',
    messages: [],
    turnsUsed: 0,
    escalated: false,
    failSafe: false,
    resources: [],
    checks: [],
    contentsJson: '[]',
  };
  if (conv.customerUid !== caller.uid) throw new ConversationClosed('not_owner');
  if (customerText === undefined && conv.messages.length > 0) return view(conv, (await deps.store.getBreaker()).paused);
  if (conv.status === 'closed') {
    if (customerText === undefined) return view(conv, (await deps.store.getBreaker()).paused);
    throw new ConversationClosed('closed');
  }
  if (t0.status !== 'held' && t0.status !== 'contact_required') throw new ConversationClosed('not_checked');

  const contents: Content[] = JSON.parse(conv.contentsJson);
  const pushUser = (parts: Part[]) => {
    const last = contents.at(-1);
    if (last?.role === 'user') last.parts = [...(last.parts ?? []), ...parts];
    else contents.push({ role: 'user', parts });
  };
  if (customerText !== undefined) {
    conv.messages.push({ role: 'customer', textJa: customerText.slice(0, 400), ts: nowIso() });
    // Statement, not instruction (rule 5): wrapped and escaped. It answers the pending ask_customer call, so it rides
    // inside that function response (Gemini rejects text mixed into a function-response turn).
    const answer = `<customer>${customerText.slice(0, 400).replace(/[<>]/g, '')}</customer>`;
    const pending = contents.at(-1)?.role === 'user' ? contents.at(-1)?.parts?.find((p) => p.functionResponse?.name === 'ask_customer') : undefined;
    if (pending?.functionResponse) pending.functionResponse.response = { ...pending.functionResponse.response, customerAnswer: answer };
    else pushUser([{ text: answer }]);
    await deps.audit({ ...base, actor: `customer:${caller.uid}`, action: 'guardian.customer_message', outcome: 'ok', detailsJa: 'お客さまがAIガーディアンに回答しました' });
  } else {
    pushUser([{ text: '会話を開始してください。まず get_transfer_facts を呼んでください。' }]);
  }

  const breaker = await deps.store.getBreaker();
  const probing = breaker.paused && breaker.pausedAt !== null && deps.now().getTime() - new Date(breaker.pausedAt).getTime() > BREAKER_PROBE_MS;
  if (breaker.paused && !probing) {
    conv = await failSafe(deps, caller, conv, 'paused');
    return view(conv, true);
  }

  try {
    let stop = false;
    for (let i = 0; i < MAX_MODEL_CALLS_PER_STEP && !stop; i++) {
      const started = Date.now();
      let reply: ModelReply;
      const call = () => deps.model(contents, AbortSignal.timeout(deps.policy.guardian.model_timeout_ms));
      try {
        try {
          reply = await call();
        } catch (e) {
          // One retry on a timeout only (rare long-tail latency); the error still counts for the breaker. Still fails safe after.
          if (!/abort|timeout/i.test(String(e))) throw e;
          await recordCall(deps, true, breaker, probing);
          await deps.audit({ ...base, actor: 'guardian', action: 'guardian.model_call', model: deps.modelName, latencyMs: Date.now() - started, outcome: 'error', detailsJa: 'AIの応答が時間内になかったため、1回だけ再試行します' });
          reply = await call();
        }
      } catch (e) {
        await recordCall(deps, true, breaker, probing);
        await deps.audit({ ...base, actor: 'guardian', action: 'guardian.model_call', model: deps.modelName, latencyMs: Date.now() - started, outcome: 'error', detailsJa: `AIの呼び出しに失敗しました（${String(e).slice(0, 60)}）` });
        throw e;
      }
      await deps.audit({ ...base, actor: 'guardian', action: 'guardian.model_call', model: deps.modelName, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, estCostJpy: estCostJpy(deps.modelName, reply.tokensIn, reply.tokensOut), latencyMs: Date.now() - started, outcome: 'ok', detailsJa: `AIが ${reply.functionCalls.map((c) => c.name).join(', ') || '（なし）'} を選びました` });
      if (!reply.content || reply.functionCalls.length === 0) {
        await recordCall(deps, true, breaker, probing);
        throw new Error('invalid model output: no tool call');
      }
      await recordCall(deps, false, breaker, probing);
      contents.push(reply.content);

      const responses: Part[] = [];
      for (const call of reply.functionCalls) {
        const out = await execTool(deps, caller, conv, transfer, base, call);
        responses.push({ functionResponse: { id: call.id, name: call.name, response: out.result } });
        if (out.stop) stop = true;
      }
      pushUser(responses);
    }
  } catch (e) {
    console.log(JSON.stringify({ severity: 'ERROR', message: 'guardian step failed', service: 'web', transferId, error: String(e).slice(0, 1000) }));
    conv = await failSafe(deps, caller, conv, String(e));
    return view(conv, (await deps.store.getBreaker()).paused);
  }

  conv.contentsJson = JSON.stringify(contents);
  await deps.store.saveConversation(conv);
  return view(conv, false);
}

type ToolOut = { result: Record<string, unknown>; stop?: boolean };

async function execTool(
  deps: Deps,
  caller: Caller,
  conv: Conversation,
  transfer: () => Promise<Transfer>,
  base: { sandboxId: string; targetType: string; targetId: string; policyHash: string },
  call: FunctionCall,
): Promise<ToolOut> {
  const nowIso = () => deps.now().toISOString();
  const name = call.name as ToolName;
  const reject = async (why: string): Promise<ToolOut> => {
    await deps.audit({ ...base, actor: 'guardian', action: `guardian.tool.${call.name ?? 'unknown'}`, outcome: 'rejected', detailsJa: `ポリシーにより拒否しました（${why}）` });
    return { result: { error: why } };
  };
  // Policy gate: known tool + zod args.
  if (!(name in TOOL_ARGS)) return reject('unknown_tool');
  const parsed = TOOL_ARGS[name].safeParse(call.args ?? {});
  if (!parsed.success) return reject('invalid_args');
  const args = parsed.data as Record<string, unknown>;
  const ok = (detailsJa: string, extra: Partial<AuditEvent> = {}) =>
    deps.audit({ ...base, actor: 'guardian', action: `guardian.tool.${name}`, outcome: 'ok', detailsJa, ...extra });
  const guardianMsgs = () => conv.messages.filter((m) => m.role !== 'customer').length;
  const say = (role: 'guardian' | 'system', textJa: string) => conv.messages.push({ role, textJa, ts: nowIso() });

  switch (name) {
    case 'get_transfer_facts': {
      const t = await transfer();
      await ok('振込の事実情報を銀行から取得しました');
      // No holder name or memo text: payee fields reach the model only as reader/keyword flag codes.
      return {
        result: {
          amountJpy: t.amountJpy,
          payeeKind: t.payee.payeeKind,
          status: t.status,
          ruleId: t.ruleId,
          ruleTextJa: t.explanationJa,
          flags: t.flags.map((f) => ({ code: f.code, field: f.field })),
          escalationReasons: t.escalationReasons,
          memoPresent: t.memo.length > 0,
        },
      };
    }
    case 'ask_customer': {
      if (conv.turnsUsed >= deps.policy.guardian.max_turns) return reject('max_turns: record_assessment then end_conversation');
      if (guardianMsgs() >= deps.policy.limits.guardian_messages_per_transfer) return reject('message_limit');
      const g = messageGuard(String(args.questionJa), deps.policy);
      if (!g.ok) await deps.audit({ ...base, actor: 'guardian', action: 'guard.violation', outcome: 'rejected', detailsJa: `メッセージガードが文面を差し替えました（${g.violations.join(', ')}）` });
      say('guardian', g.text);
      conv.turnsUsed++;
      if (args.check && !conv.checks.includes(args.check as TellerCheck)) conv.checks.push(args.check as TellerCheck);
      await ok('お客さまに質問しました');
      return { result: { shown: true, replacedByGuard: !g.ok }, stop: true };
    }
    case 'explain_rule': {
      const m = MandateView.parse(await deps.bank('/v1/mandate', { userToken: caller.token }));
      say('system', `あなたのルール：${ruleTextJa(args.ruleId as Parameters<typeof ruleTextJa>[0], m.active)}`);
      await ok(`ルール ${String(args.ruleId)} を説明しました`, { ruleId: String(args.ruleId), mandateHash: m.active.hash });
      return { result: { shown: true } };
    }
    case 'record_assessment': {
      const assessment = { ...(args as Omit<NonNullable<Conversation['assessment']>, 'turnsUsed'>), turnsUsed: conv.turnsUsed };
      conv.assessment = assessment;
      // Code, not the model, decides escalation (SPEC §6).
      const d = shouldEscalate(assessment, deps.policy);
      await ok(`評価を記録しました（${assessment.riskLevel}：${assessment.reasonCodes.join(', ') || 'なし'}）${assessment.rationaleJa ? `／${assessment.rationaleJa}` : ''}`);
      const t = await transfer();
      if (d.escalate) await escalate(deps, caller, conv, t, d.reasonCodes, base);
      if ((d.escalate || t.status === 'contact_required') && assessment.reasonCodes.length) {
        await deps.store.putNotice({ id: `${conv.transferId}-auto`, sandboxId: caller.sandboxId, transferId: conv.transferId, summaryJa: AUTO_NOTICE_JA, reasonCodes: assessment.reasonCodes, createdAt: nowIso() });
      }
      return { result: { recorded: true, escalated: conv.escalated } };
    }
    case 'escalate': {
      // The model may only add strictness; ignored unless the transfer is still held.
      const t = await transfer();
      await escalate(deps, caller, conv, t, args.reasonCodes as ReasonCode[], base);
      return { result: { status: conv.escalated ? 'contact_required' : t.status } };
    }
    case 'notify_contact': {
      const since = deps.now().getTime() - 3600_000;
      const recent = (await deps.store.noticesForSandbox(caller.sandboxId)).filter((n) => new Date(n.createdAt).getTime() > since);
      if (recent.length >= deps.policy.limits.contact_notices_per_hour) return reject('contact_notice_limit');
      const g = messageGuard(String(args.summaryJa), deps.policy);
      if (!g.ok) await deps.audit({ ...base, actor: 'guardian', action: 'guard.violation', outcome: 'rejected', detailsJa: `メッセージガードが文面を差し替えました（${g.violations.join(', ')}）` });
      const t = await transfer();
      await deps.store.putNotice({
        id: `${conv.transferId}-${Date.now()}`,
        sandboxId: caller.sandboxId,
        transferId: conv.transferId,
        summaryJa: g.ok ? g.text : AUTO_NOTICE_JA,
        reasonCodes: [...new Set([...(conv.assessment?.reasonCodes ?? []), ...t.escalationReasons])],
        createdAt: nowIso(),
      });
      await ok('見守り人にお知らせしました');
      return { result: { sent: true } };
    }
    case 'suggest_resource': {
      const kind = args.kind as keyof typeof RESOURCE_JA;
      if (!conv.resources.includes(kind)) conv.resources.push(kind);
      say('system', RESOURCE_JA[kind]);
      await ok(`相談先（${kind}）を案内しました`);
      return { result: { shown: true } };
    }
    case 'end_conversation': {
      if (!conv.assessment) return reject('record_assessment first');
      // Gate (held only): a calm cover story must not end the check early. Escalated or contact_required needs nothing more.
      const t = await transfer();
      if (t.status === 'held' && !conv.escalated && conv.checks.length < MIN_TELLER_CHECKS) {
        const missing = TellerCheck.options.filter((c) => !conv.checks.includes(c));
        if (conv.turnsUsed < deps.policy.guardian.max_turns) return reject(`teller_checks_incomplete: also ask about ${missing.join(', ')}`);
        // Out of turns without coverage: only tighten, and only if something already looked off (≥1 elevated code).
        const elevated = conv.assessment.reasonCodes.filter((c) => deps.policy.reason_codes[c]?.severity === 'elevated');
        if (elevated.length) await escalate(deps, caller, conv, t, [...new Set<ReasonCode>(['coached_answers', ...elevated])], base);
      }
      conv.status = 'closed';
      await ok('会話を終了しました');
      return { result: { closed: true }, stop: true };
    }
  }
}

/** Monotonic: only held → contact_required. Anything else is a no-op. */
async function escalate(deps: Deps, caller: Caller, conv: Conversation, t: Transfer, reasonCodes: ReasonCode[], base: { sandboxId: string; targetType: string; targetId: string; policyHash: string }) {
  if (t.status !== 'held') return;
  await deps.bank(`/v1/transfers/${t.id}/escalate`, { method: 'POST', body: { reasonCodes }, userToken: caller.token });
  conv.escalated = true;
  await deps.audit({ ...base, actor: 'guardian', action: 'guardian.escalate', ruleId: t.ruleId, mandateHash: t.mandateHash, outcome: 'ok', detailsJa: `見守り人の承認が必要な状態に引き上げました（${reasonCodes.join(', ')}）` });
}

/** SPEC §6 fail-safe: deterministic escalate(['guardian_unavailable']), fixed message, contact notice. Never releases. */
async function failSafe(deps: Deps, caller: Caller, conv: Conversation, why: string): Promise<Conversation> {
  const base = { sandboxId: caller.sandboxId, targetType: 'transfer', targetId: conv.transferId, policyHash: deps.policyHash };
  try {
    const t = Transfer.parse(await deps.bank(`/v1/transfers/${conv.transferId}`, { userToken: caller.token }));
    await escalate(deps, caller, conv, t, ['guardian_unavailable'], base);
  } catch (e) {
    // The bank is the only place money moves; if we can't even reach it, the hold simply stays.
    await deps.audit({ ...base, actor: 'system', action: 'guardian.fail_safe_escalate_failed', outcome: 'error', detailsJa: `フェイルセーフの引き上げに失敗しました（保留は維持されます）：${String(e).slice(0, 60)}` });
  }
  conv.messages.push({ role: 'system', textJa: FAIL_SAFE_JA, ts: deps.now().toISOString() });
  conv.failSafe = true;
  conv.status = 'closed';
  await deps.store.putNotice({ id: `${conv.transferId}-failsafe`, sandboxId: caller.sandboxId, transferId: conv.transferId, summaryJa: FAIL_SAFE_JA, reasonCodes: ['guardian_unavailable'], createdAt: deps.now().toISOString() });
  await deps.audit({ ...base, actor: 'system', action: 'guardian.fail_safe', outcome: 'error', detailsJa: `AIガーディアンが利用できないため、見守り人の確認に切り替えました（${why.slice(0, 60)}）` });
  await deps.store.saveConversation(conv);
  return conv;
}

async function recordCall(deps: Deps, errored: boolean, prev: Breaker, probing: boolean) {
  const cur = await deps.store.getBreaker().catch(() => prev);
  const recent = (probing && !errored ? [] : [...cur.recent, errored]).slice(-BREAKER_WINDOW);
  const rate = recent.length ? recent.filter(Boolean).length / recent.length : 0;
  const paused = recent.length >= BREAKER_MIN_SAMPLE && rate > deps.policy.guardian.pause_if_error_rate_over;
  const next: Breaker = { paused, pausedAt: paused ? (cur.paused && !probing ? cur.pausedAt : deps.now().toISOString()) : null, recent };
  await deps.store.setBreaker(next);
  Object.assign(prev, next);
}
