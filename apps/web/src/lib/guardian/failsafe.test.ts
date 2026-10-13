// Fail-safe suite (SPEC §14): injected LLM failures never release money and never leak unguarded text.
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FunctionCall } from '@google/genai';
import { SAFE_TEMPLATE, defaultTerms, type SystemPolicy, type Transfer } from '@matta/core';
import { loadPolicy } from '@matta/core/node';
import { runStep, type Deps, type ModelReply } from './loop';
import { FAIL_SAFE_JA } from './tools';
import type { Breaker, ContactNotice, Conversation, GuardianStore } from './state';

const loaded = loadPolicy(fileURLToPath(new URL('../../../../../policy/system-policy.yaml', import.meta.url)));

const transfer = (): Transfer => ({
  id: 't1', sandboxId: 'sandbox-1', customerUid: 'customer-1', amountJpy: 290_000,
  payee: { bankCode: '9991', branchCode: '203', accountNumber: '5000003', holderNameKana: 'カ）サイトカンリセンター', payeeKind: 'new' },
  memo: '', status: 'held', ruleId: 'R-HOLD-DEFAULT', explanationJa: 'それ以外の振込は24時間保留する', flags: [],
  holdUntil: '2026-10-14T00:00:00.000Z', escalatedAt: null, escalationReasons: [], contactRequiredSince: null,
  earlyApprovalRequestedAt: null, decision: null, createdAt: '2026-10-13T00:00:00.000Z', settledAt: null, cancelledAt: null,
  mandateVersion: 1, mandateHash: 'h', policyHash: 'p', releaseConditionsJa: [],
});

type Step = FunctionCall[] | Error | 'hang';

function harness(script: Step[], opts: { breaker?: Breaker; policy?: SystemPolicy } = {}) {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  let t = transfer();
  let modelCalls = 0;
  const convs = new Map<string, Conversation>();
  const notices: ContactNotice[] = [];
  let breaker: Breaker = opts.breaker ?? { paused: false, pausedAt: null, recent: [] };
  const store: GuardianStore = {
    loadConversation: async (id) => structuredClone(convs.get(id) ?? null),
    saveConversation: async (c) => void convs.set(c.transferId, structuredClone(c)),
    putNotice: async (n) => void notices.push(n),
    noticesForSandbox: async () => notices,
    getBreaker: async () => breaker,
    setBreaker: async (b) => void (breaker = b),
  };
  const deps: Deps = {
    modelName: 'fake',
    async model(_c, signal): Promise<ModelReply> {
      modelCalls++;
      const next = script.shift();
      if (!next) throw new Error('script exhausted');
      if (next === 'hang') return new Promise((_ok, fail) => signal.addEventListener('abort', () => fail(signal.reason)));
      if (next instanceof Error) throw next;
      return { content: { role: 'model', parts: next.map((functionCall) => ({ functionCall })) }, functionCalls: next, tokensIn: 1, tokensOut: 1 };
    },
    async bank(path, o) {
      calls.push({ path, method: o.method ?? 'GET', body: o.body });
      if (path.endsWith('/escalate')) return (t = { ...t, status: 'contact_required', escalationReasons: (o.body as { reasonCodes: [] }).reasonCodes });
      if (path === '/v1/mandate') return { active: { ...defaultTerms({ uid: 'contact-1', displayName: '美咲', relation: '姉' }), version: 1, signedAt: 'x', signedBy: 'customer-1', hash: 'h' }, pending: [] };
      if (path === '/v1/transfers/t1') return t;
      throw new Error(`unexpected bank path ${path}`);
    },
    store,
    policy: opts.policy ?? loaded.policy,
    policyHash: loaded.policyHash,
    audit: async () => undefined,
    now: () => new Date('2026-10-13T01:00:00Z'),
  };
  return {
    run: (text?: string) => runStep(deps, { uid: 'customer-1', sandboxId: 'sandbox-1', token: 'tok' }, 't1', text),
    calls,
    notices,
    get breaker() { return breaker; },
    get modelCalls() { return modelCalls; },
    get status() { return t.status; },
  };
}

const fc = (name: string, args: Record<string, unknown> = {}): FunctionCall => ({ name, args });
const ask = (q = 'どのようなご用途か教えていただけますか。') => fc('ask_customer', { questionJa: q });

/** Only GET transfer/mandate and escalate may ever reach the bank. */
const onlySafeBankCalls = (calls: Array<{ path: string; method: string }>) =>
  calls.every((c) => (c.method === 'GET' && /^\/v1\/(transfers\/t1|mandate)$/.test(c.path)) || (c.method === 'POST' && c.path.endsWith('/escalate')));
const failSafeEscalated = (calls: Array<{ path: string; body?: unknown }>) =>
  calls.some((c) => c.path.endsWith('/escalate') && JSON.stringify(c.body) === JSON.stringify({ reasonCodes: ['guardian_unavailable'] }));

describe('fail-safe suite', () => {
  it('LLM throws → escalate([guardian_unavailable]), fixed message', async () => {
    const h = harness([new Error('500 internal')]);
    const conv = await h.run();
    expect(failSafeEscalated(h.calls)).toBe(true);
    expect(onlySafeBankCalls(h.calls)).toBe(true);
    expect(conv.messages.map((m) => m.textJa)).toEqual([FAIL_SAFE_JA]);
    expect(h.status).toBe('contact_required');
  });

  it('LLM times out (policy model_timeout_ms) → fail-safe', async () => {
    const policy = { ...loaded.policy, guardian: { ...loaded.policy.guardian, model_timeout_ms: 30 } };
    const h = harness(['hang'], { policy });
    const conv = await h.run();
    expect(conv.failSafe).toBe(true);
    expect(failSafeEscalated(h.calls)).toBe(true);
  });

  it('invalid tool args are refused by the policy gate and change nothing', async () => {
    const h = harness([[fc('ask_customer', { questionJa: 42 }), fc('escalate', { reasonCodes: ['not_a_code'] })], [ask()]]);
    const conv = await h.run();
    expect(h.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(conv.messages.map((m) => m.textJa)).toEqual(['どのようなご用途か教えていただけますか。']);
  });

  it('forbidden phrases, URLs and phone numbers in ask_customer are replaced by the safe template', async () => {
    for (const q of ['パスワードを入力してください。', '詳しくは https://example.com をご覧ください。', '03-1234-5678 にお電話ください。']) {
      const h = harness([[ask(q)]]);
      const conv = await h.run();
      expect(conv.messages.map((m) => m.textJa), q).toEqual([SAFE_TEMPLATE]);
    }
  });

  it('a non-existent release_transfer tool is refused; no release path exists', async () => {
    const h = harness([[fc('release_transfer', { transferId: 't1' }), fc('settle', {})], [ask()]]);
    await h.run();
    expect(h.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(onlySafeBankCalls(h.calls)).toBe(true);
    expect(h.status).toBe('held');
  });

  it('circuit breaker: > 30% errors over the last 20 pauses the guardian; then start() fails safe without calling the model', async () => {
    const recent = [...Array(6).fill(true), ...Array(13).fill(false)]; // 6/19 errors so far
    const h = harness([new Error('boom')], { breaker: { paused: false, pausedAt: null, recent } });
    await h.run();
    expect(h.breaker.paused).toBe(true); // 7/20 = 35%

    const h2 = harness([[ask()]], { breaker: h.breaker });
    const conv = await h2.run();
    expect(h2.modelCalls).toBe(0);
    expect(conv.paused).toBe(true);
    expect(conv.failSafe).toBe(true);
    expect(failSafeEscalated(h2.calls)).toBe(true);
  });
});
