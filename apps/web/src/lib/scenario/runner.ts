import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  LookupResult,
  MandateChange,
  MandateTerms,
  MandateView,
  Transfer,
  type ContactStep,
  type Scenario,
  type Trigger,
  type VictimStep,
} from '@matta/core';
import { env } from '../env.server';
import { db } from '../firebase.admin';
import { writeAudit } from '../audit';
import { log } from '../log';
import { ConversationView } from '../guardian/state';
import { autopilotIdToken } from './identity';

/**
 * Scenario runner (DEMO_MODE only, SPEC §10). The autopilot victim and contact act through the same public
 * APIs a browser uses — web /api/* for W+C routes, the bank directly for C/K routes — with the sandbox's own
 * identities. Nothing here has more power than customer-N / contact-N themselves.
 */

export const RunEvent = z.object({ ts: z.string(), kind: z.enum(['caller', 'victim', 'contact', 'system']), textJa: z.string() });
export type RunEvent = z.infer<typeof RunEvent>;

export const Check = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export const ScenarioRun = z.object({
  id: z.string(),
  sandboxId: z.string(),
  scenarioId: z.string(),
  autopilotVictim: z.boolean(),
  autopilotContact: z.boolean(),
  status: z.enum(['running', 'manual', 'done', 'error']),
  events: z.array(RunEvent),
  /** Triggers already fired, so caller lines and contact steps happen once. */
  fired: z.array(z.string()).default([]),
  transferId: z.string().nullable(),
  changeId: z.string().nullable(),
  result: z.object({ passed: z.boolean(), checks: z.array(Check) }).nullable(),
  startedAt: z.string(),
});
export type ScenarioRun = z.infer<typeof ScenarioRun>;

const runs = () => db().collection('scenarioRuns');

class Api {
  private tokens = new Map<string, string>();
  constructor(private readonly n: string) {}

  /** Fresh tokens per call keep auth_time recent for mandate changes (≤ 5 min). */
  private async token(role: 'customer' | 'contact', fresh = false) {
    const uid = `${role}-${this.n}`;
    if (fresh || !this.tokens.has(uid)) this.tokens.set(uid, await autopilotIdToken(uid));
    return this.tokens.get(uid)!;
  }

  async web<T extends z.ZodType>(path: string, schema: T, body?: unknown): Promise<z.infer<T>> {
    const res = await fetch(new URL(path, env().WEB_URL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${await this.token('customer')}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`web ${path} -> ${res.status} ${await res.text()}`);
    return schema.parse(await res.json());
  }

  async bank<T extends z.ZodType>(role: 'customer' | 'contact', path: string, schema: T, body?: unknown, fresh = false): Promise<z.infer<T>> {
    const res = await fetch(new URL(path, env().BANK_URL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-user-token': await this.token(role, fresh), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`bank ${path} -> ${res.status} ${await res.text()}`);
    return schema.parse(await res.json());
  }
}

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) throw new Error(`bad mandate path ${path}`);
    o = o[k] as Record<string, unknown>;
  }
  o[keys.at(-1)!] = value;
}

/** One run's state + side effects. */
class Run {
  private readonly api: Api;
  constructor(
    private readonly scenario: Scenario,
    private state: ScenarioRun,
  ) {
    this.api = new Api(state.sandboxId.replace('sandbox-', ''));
  }

  private async save(patch: Partial<ScenarioRun>, ...events: RunEvent[]) {
    Object.assign(this.state, patch);
    this.state.events.push(...events);
    await runs()
      .doc(this.state.id)
      .update({ ...patch, ...(events.length ? { events: FieldValue.arrayUnion(...events) } : {}) });
  }

  private emit(kind: RunEvent['kind'], textJa: string) {
    return this.save({}, { ts: now(), kind, textJa });
  }

  private audit(role: 'customer' | 'contact', action: string, detailsJa: string) {
    return writeAudit({
      sandboxId: this.state.sandboxId,
      actor: `autopilot:${role}`,
      action: `autopilot.${action}`,
      targetType: this.state.transferId ? 'transfer' : 'scenarioRun',
      targetId: this.state.transferId ?? this.state.id,
      outcome: 'ok',
      detailsJa,
    });
  }

  /** Caller lines and autopilot-contact decisions for a trigger, each at most once per run. */
  async fire(trigger: Trigger) {
    if (this.state.fired.includes(trigger)) return;
    await this.save({ fired: [...this.state.fired, trigger] });
    for (const l of this.scenario.caller?.lines ?? []) if (l.trigger === trigger) await this.emit('caller', l.textJa);
    if (!this.state.autopilotContact) return;
    for (const c of this.scenario.contact) if (c.after === trigger) await this.contactDecides(c);
  }

  private async contactDecides(c: ContactStep) {
    if (c.target === 'mandate_change') {
      if (!this.state.changeId) return this.emit('system', '見守り人の判断対象となるルール変更がありません');
      const body = { decision: c.decision === 'approve' ? 'cosign' : 'deny', reasonJa: c.reasonJa };
      await this.api.bank('contact', `/v1/mandate/changes/${this.state.changeId}/contact-decision`, MandateChange, body);
    } else {
      if (!this.state.transferId) return this.emit('system', '見守り人の判断対象となる振込がありません');
      await this.api.bank('contact', `/v1/transfers/${this.state.transferId}/contact-decision`, z.unknown(), {
        decision: c.decision,
        reasonJa: c.reasonJa,
      });
    }
    const label = c.decision === 'approve' ? '承認しました' : '承認しませんでした';
    await this.emit('contact', `見守り人（自動シミュレーション）が${label}：${c.reasonJa}`);
    await this.audit('contact', `contact.${c.decision}`, `自動シミュレーションの見守り人が${label}`);
    if (c.target === 'transfer' && c.decision === 'deny') await this.fire('transfer_cancelled');
  }

  private async afterTransferStatus(t: Transfer) {
    if (t.status === 'held') await this.fire('transfer_held');
    if (t.status === 'contact_required') await this.fire('transfer_contact_required');
    if (t.status === 'cancelled') await this.fire('transfer_cancelled');
  }

  private guardianSeen = 0;

  private async guardian(path: string, body?: unknown) {
    const conv = await this.api.web(path, ConversationView, body);
    const said = conv.messages.filter((m) => m.role === 'guardian');
    for (const m of said.slice(this.guardianSeen)) await this.emit('system', `AIガーディアン：${m.textJa}`);
    this.guardianSeen = said.length;
    await this.fire('guardian_message');
    return conv;
  }

  private async victim(step: VictimStep) {
    const sid = this.state.sandboxId;
    switch (step.action) {
      case 'lookup_payee': {
        const r = await this.api.web('/api/bank/lookup', LookupResult, step.args);
        await this.emit('victim', `振込先を照会しました（${r.found ? r.holderNameKana : '見つかりません'}）`);
        await this.fire('payee_looked_up');
        return;
      }
      case 'submit_transfer': {
        const t = await this.api.web('/api/bank/transfers', Transfer, { memo: '', ...step.args });
        await this.save({ transferId: t.id }, { ts: now(), kind: 'victim', textJa: `${t.amountJpy.toLocaleString('ja-JP')}円の振込を申し込みました` });
        await this.audit('customer', 'submit_transfer', '自動シミュレーションの預金者が振込を申し込みました');
        await this.afterTransferStatus(t);
        // The customer UI auto-starts the guardian for checked transfers; the autopilot does the same.
        if (t.status === 'held' || t.status === 'contact_required') await this.guardian(`/api/guardian/${t.id}/start`, {});
        return;
      }
      case 'answer_guardian': {
        if (!this.state.transferId) return;
        const { conversation: conv } = await this.api.web(
          `/api/guardian/${this.state.transferId}`,
          z.object({ conversation: ConversationView.nullable() }),
        );
        if (!conv || conv.status === 'closed') return this.emit('system', 'AIガーディアンとの会話は終了しているため、回答を省略しました');
        await this.emit('victim', step.args.textJa);
        await this.guardian(`/api/guardian/${this.state.transferId}/message`, { textJa: step.args.textJa });
        return;
      }
      case 'request_mandate_change': {
        const view = await this.api.bank('customer', '/v1/mandate', MandateView);
        const terms = structuredClone(MandateTerms.parse(view.active)) as Record<string, unknown>;
        for (const [path, value] of Object.entries(step.args.patch)) setPath(terms, path, value);
        (terms.contacts as unknown[]).push(...step.args.contactsAdd);
        const change = await this.api.bank('customer', '/v1/mandate/changes', MandateChange, { terms }, true);
        await this.save({ changeId: change.id }, { ts: now(), kind: 'victim', textJa: '見守りルールの変更を申請しました' });
        await this.audit('customer', 'request_mandate_change', `自動シミュレーションの預金者がルール変更を申請しました（${change.status}）`);
        if (change.status === 'pending') await this.fire('mandate_change_pending');
        if (this.state.transferId) await this.afterTransferStatus(await this.transfer());
        return;
      }
      case 'request_early_approval':
        if (this.state.transferId) await this.api.bank('customer', `/v1/transfers/${this.state.transferId}/request-early-approval`, Transfer, {});
        return this.emit('victim', '見守り人に早めの承認を依頼しました');
      case 'cancel':
        if (this.state.transferId) await this.api.bank('customer', `/v1/transfers/${this.state.transferId}/cancel`, Transfer, {});
        await this.emit('victim', '振込を取り消しました');
        return this.fire('transfer_cancelled');
      case 'advance_clock':
        await this.api.bank('customer', `/demo/sandboxes/${sid}/clock`, z.unknown(), { hours: step.args.hours });
        await this.emit('system', `デモ時計を${step.args.hours}時間進めました`);
        await this.fire('clock_advanced');
        if (this.state.transferId) await this.afterTransferStatus(await this.transfer());
        return;
      case 'wait':
        return sleep(step.args.seconds * 1000);
    }
  }

  private transfer() {
    return this.api.web(`/api/bank/transfers/${this.state.transferId}`, Transfer);
  }

  private async evaluate() {
    const exp = this.scenario.expected;
    const checks: z.infer<typeof Check>[] = [];
    const t = this.state.transferId ? await this.transfer() : null;
    if (exp.finalStatus) checks.push({ name: 'finalStatus', ok: t?.status === exp.finalStatus, detail: `${t?.status ?? 'no transfer'}` });
    if (exp.noMoneyOutWithoutContact) {
      const ok = !t || t.status !== 'settled' || t.decision?.decision === 'approve';
      checks.push({ name: 'noMoneyOutWithoutContact', ok, detail: `${t?.status}, decision=${t?.decision?.decision ?? 'none'}` });
    }
    if (exp.mustEscalate !== undefined) {
      const escalated = !!t?.escalatedAt;
      checks.push({ name: 'mustEscalate', ok: escalated === exp.mustEscalate, detail: `escalatedAt=${t?.escalatedAt ?? 'null'}` });
    }
    if (exp.mandateChangeStatus) {
      const status = this.state.changeId
        ? (await this.api.bank('customer', `/v1/mandate/changes/${this.state.changeId}`, MandateChange)).status
        : 'no change';
      checks.push({ name: 'mandateChangeStatus', ok: status === exp.mandateChangeStatus, detail: status });
    }
    if (exp.maxAddedDelayMin !== undefined && t) {
      const delay = t.settledAt ? (Date.parse(t.settledAt) - Date.parse(t.createdAt)) / 60_000 : Infinity;
      checks.push({ name: 'maxAddedDelayMin', ok: delay <= exp.maxAddedDelayMin, detail: `${delay} min (sandbox clock)` });
    }
    return { passed: checks.every((c) => c.ok), checks };
  }

  async runAutopilot() {
    try {
      await this.fire('start');
      for (const step of this.scenario.victim) await this.victim(step);
      const result = await this.evaluate();
      await this.save({ status: 'done', result }, { ts: now(), kind: 'system', textJa: result.passed ? 'シナリオ完了：期待どおりの結果です' : 'シナリオ完了：期待と異なる結果があります' });
    } catch (e) {
      log('ERROR', 'scenario run failed', { runId: this.state.id, error: String(e) });
      await this.save({ status: 'error' }, { ts: now(), kind: 'system', textJa: `エラーで停止しました：${String(e).slice(0, 160)}` });
    }
    return this.state;
  }
}

/** Starts a run. With the victim autopilot on, runs to completion within the request (≤ a few minutes). */
export async function startRun(scenario: Scenario, sandboxId: string, opts: { autopilotVictim: boolean; autopilotContact: boolean }) {
  const state: ScenarioRun = {
    id: randomUUID(),
    sandboxId,
    scenarioId: scenario.id,
    ...opts,
    status: opts.autopilotVictim ? 'running' : 'manual',
    events: [],
    fired: [],
    transferId: null,
    changeId: null,
    result: null,
    startedAt: now(),
  };
  await runs().doc(state.id).set(state);
  const run = new Run(scenario, state);
  if (!opts.autopilotVictim) {
    await run.fire('start');
    return state;
  }
  return run.runAutopilot();
}

export async function getRun(id: string): Promise<ScenarioRun | null> {
  const d = await runs().doc(id).get();
  return d.exists ? ScenarioRun.parse(d.data()) : null;
}

/** Manual mode: the /demo console reports what happened in the human-driven windows. */
export async function fireTrigger(scenario: Scenario, state: ScenarioRun, trigger: Trigger, ids: { transferId?: string; changeId?: string }) {
  const run = new Run(scenario, state);
  if (ids.transferId || ids.changeId) {
    await runs().doc(state.id).update({ transferId: ids.transferId ?? state.transferId, changeId: ids.changeId ?? state.changeId });
    state.transferId = ids.transferId ?? state.transferId;
    state.changeId = ids.changeId ?? state.changeId;
  }
  await run.fire(trigger);
  return state;
}
