import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditEvent,
  Mandate,
  MandateChange,
  Transfer,
  decideRelease,
  releaseConditionsJa,
  ruleTextJa,
  type MandateTerms,
} from '@matta/core';
import { hashObject } from '@matta/core/node';
import type { BankEnv } from './env';
import type { Store, Tx } from './store';
import { log } from './log';

// ---- stored shapes (zod-parsed on every read) ----
export const SandboxDoc = z.object({ id: z.string(), clockOffsetMs: z.number(), customerUid: z.string(), contactUids: z.array(z.string()) });
export const AccountDoc = z.object({
  sandboxId: z.string(),
  customerUid: z.string(),
  displayName: z.string(),
  balanceJpy: z.number().int(),
  phoneJa: z.string(),
});
export const DirectoryDoc = z.object({
  key: z.string(),
  bankCode: z.string(),
  branchCode: z.string(),
  accountNumber: z.string(),
  holderNameKana: z.string(),
  bankNameJa: z.string(),
});
export const PayeeDoc = z.object({ id: z.string(), sandboxId: z.string(), key: z.string(), displayName: z.string() });
const MandatePtr = z.object({ sandboxId: z.string(), activeVersion: z.number().int() });
export const StoredTransfer = Transfer.omit({ releaseConditionsJa: true });
export type StoredTransfer = z.infer<typeof StoredTransfer>;

type Reader = Pick<Store, 'get' | 'where'> | Tx;

export type Ctx = {
  env: BankEnv;
  store: Store;
  policyHash: string;
  /** Cloud mode: schedule hold evaluation at holdUntil. */
  enqueueHold?: (t: StoredTransfer, clockOffsetMs: number) => Promise<void>;
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const withConditions = (t: StoredTransfer): Transfer => ({ ...t, releaseConditionsJa: releaseConditionsJa(t) });

// ---- reads ----
export async function getSandbox(r: Reader, sid: string) {
  const d = await r.get('sandboxes', sid);
  if (!d) throw new HttpError(404, 'sandbox_not_found');
  return SandboxDoc.parse(d);
}

export const clockNow = (offsetMs: number) => new Date(Date.now() + offsetMs);

export async function sandboxNow(r: Reader, sid: string): Promise<Date> {
  return clockNow((await getSandbox(r, sid)).clockOffsetMs);
}

export async function activeMandate(r: Reader, sid: string): Promise<Mandate> {
  const ptr = MandatePtr.parse(await r.get('mandates', sid));
  return Mandate.parse(await r.get(`mandates/${sid}/versions`, String(ptr.activeVersion)));
}

export async function getTransfer(r: Reader, id: string): Promise<StoredTransfer> {
  const d = await r.get('transfers', id);
  if (!d) throw new HttpError(404, 'transfer_not_found');
  return StoredTransfer.parse(d);
}

export async function sandboxChanges(r: Reader, sid: string) {
  return (await r.where('mandateChanges', 'sandboxId', sid)).map((d) => MandateChange.parse(d));
}

// ---- audit ----
export type AuditInput = Omit<AuditEvent, 'id' | 'ts' | 'service'>;

export function auditEvent(a: AuditInput): AuditEvent {
  const ev = AuditEvent.parse({ ...a, id: randomUUID(), ts: new Date().toISOString(), service: 'bank' });
  log(a.outcome === 'ok' || a.outcome === 'pending' ? 'INFO' : 'WARNING', `audit ${a.action}`, { audit: ev });
  return ev;
}

export const writeAudit = (t: Tx, a: AuditInput) => {
  const ev = auditEvent(a);
  t.set('bankAudit', ev.id, ev);
};

// ---- writes (inside a transaction) ----

/** Debits and settles. Insufficient balance at settle time cancels instead (never overdraws). */
export async function settleInTx(ctx: Ctx, t: Tx, tr: StoredTransfer, now: Date, actor: string, why: string): Promise<StoredTransfer> {
  const acct = AccountDoc.parse(await t.get('accounts', tr.sandboxId));
  if (acct.balanceJpy < tr.amountJpy) {
    const next = { ...tr, status: 'cancelled' as const, cancelledAt: now.toISOString() };
    t.set('transfers', tr.id, next);
    writeAudit(t, { ...auditBase(ctx, tr, now, actor), action: 'transfer.cancelled', outcome: 'error', detailsJa: '残高不足のため取り消しました' });
    return next;
  }
  t.set('accounts', tr.sandboxId, { ...acct, balanceJpy: acct.balanceJpy - tr.amountJpy });
  const ledgerId = randomUUID();
  t.set('ledger', ledgerId, { id: ledgerId, sandboxId: tr.sandboxId, transferId: tr.id, amountJpy: -tr.amountJpy, simTs: now.toISOString(), payeeKey: `${tr.payee.bankCode}-${tr.payee.branchCode}-${tr.payee.accountNumber}` });
  const next = { ...tr, status: 'settled' as const, settledAt: now.toISOString() };
  t.set('transfers', tr.id, next);
  writeAudit(t, { ...auditBase(ctx, tr, now, actor), action: 'transfer.settled', outcome: 'ok', detailsJa: `振込を実行しました（${why}）` });
  return next;
}

export function auditBase(ctx: Ctx, tr: StoredTransfer, now: Date, actor: string) {
  return {
    simTs: now.toISOString(),
    sandboxId: tr.sandboxId,
    actor,
    targetType: 'transfer',
    targetId: tr.id,
    ruleId: tr.ruleId,
    mandateHash: tr.mandateHash,
    policyHash: ctx.policyHash,
  };
}

/** held → contact_required because a loosening request is open (SPEC §3). */
export function toContactRequiredByLoosening(ctx: Ctx, t: Tx, tr: StoredTransfer, terms: MandateTerms, now: Date) {
  const next: StoredTransfer = {
    ...tr,
    status: 'contact_required',
    contactRequiredSince: now.toISOString(),
    ruleId: 'R-LOOSEN-OPEN',
    explanationJa: ruleTextJa('R-LOOSEN-OPEN', terms),
  };
  t.set('transfers', tr.id, next);
  writeAudit(t, {
    ...auditBase(ctx, next, now, 'system'),
    action: 'transfer.contact_required',
    outcome: 'ok',
    detailsJa: 'ルールをゆるめる申請があったため、見守り人の承認が必要になりました',
  });
}

/** Applies a pending/new change as the next mandate version. */
export async function applyChangeInTx(ctx: Ctx, t: Tx, change: MandateChange, now: Date, actor: string, detailsJa: string) {
  const current = await activeMandate(t, change.sandboxId);
  // A loosening was judged against fromVersion; applying it over a newer version would silently undo
  // whatever changed since (e.g. a later tightening). Reject it; the customer can request again.
  if (change.kind === 'loosen' && current.version !== change.fromVersion) {
    const rejected: MandateChange = {
      ...change,
      status: 'rejected',
      decidedBy: 'system',
      decidedAt: now.toISOString(),
      reasonJa: 'ルールが申請後に変更されたため、この申請は無効になりました。必要であれば改めて申請してください。',
    };
    t.set('mandateChanges', change.id, rejected);
    writeAudit(t, {
      simTs: now.toISOString(),
      sandboxId: change.sandboxId,
      actor: 'system',
      action: 'mandate.stale_rejected',
      targetType: 'mandateChange',
      targetId: change.id,
      mandateHash: current.hash,
      policyHash: ctx.policyHash,
      outcome: 'rejected',
      detailsJa: rejected.reasonJa!,
    });
    return rejected;
  }
  const version = current.version + 1;
  const mandate: Mandate = { ...change.proposed, version, signedAt: now.toISOString(), signedBy: change.requestedBy, hash: hashObject(change.proposed) };
  t.set(`mandates/${change.sandboxId}/versions`, String(version), mandate);
  t.set('mandates', change.sandboxId, { sandboxId: change.sandboxId, activeVersion: version });
  const next: MandateChange = { ...change, status: 'applied', decidedBy: change.decidedBy ?? actor, decidedAt: now.toISOString() };
  t.set('mandateChanges', change.id, next);
  writeAudit(t, {
    simTs: now.toISOString(),
    sandboxId: change.sandboxId,
    actor,
    action: 'mandate.applied',
    targetType: 'mandateChange',
    targetId: change.id,
    mandateHash: mandate.hash,
    policyHash: ctx.policyHash,
    outcome: 'ok',
    detailsJa,
  });
  return next;
}

// ---- hold evaluation ----
export type EvalCounts = { settled: number; branchReview: number; applied: number; toContactRequired: number };

/** Releases eligible holds, sends overdue contact_required to branch review, applies due loosenings. Idempotent. */
export async function evaluateSandbox(ctx: Ctx, sid: string): Promise<EvalCounts> {
  const counts: EvalCounts = { settled: 0, branchReview: 0, applied: 0, toContactRequired: 0 };

  for (const c of await sandboxChanges(ctx.store, sid)) {
    if (c.status !== 'pending' || !c.effectiveAt) continue;
    const applied = await ctx.store.tx(async (t) => {
      const now = await sandboxNow(t, sid);
      const fresh = MandateChange.parse(await t.get('mandateChanges', c.id));
      if (fresh.status !== 'pending' || new Date(fresh.effectiveAt!) > now) return false;
      await applyChangeInTx(ctx, t, fresh, now, 'system', '冷却期間が過ぎたため、ルールの変更を適用しました');
      return true;
    });
    if (applied) counts.applied++;
  }

  const open = (await ctx.store.where('transfers', 'sandboxId', sid))
    .map((d) => StoredTransfer.parse(d))
    .filter((t) => t.status === 'held' || t.status === 'contact_required');
  for (const o of open) {
    await ctx.store.tx(async (t) => {
      const now = await sandboxNow(t, sid);
      const tr = await getTransfer(t, o.id);
      const mandate = await activeMandate(t, sid);
      const changes = await sandboxChanges(t, sid);
      const out = decideRelease(tr, {
        kind: 'clock',
        now,
        loosenedSince: changes.some((c) => c.kind === 'loosen' && c.requestedAt > tr.createdAt),
        contactDecisionWindowHours: mandate.holds.contactDecisionWindowHours,
      });
      if (out.action === 'settle') {
        await settleInTx(ctx, t, tr, now, 'system', '保留期限の経過');
        counts.settled++;
      } else if (out.action === 'to_contact_required') {
        toContactRequiredByLoosening(ctx, t, tr, mandate, now);
        counts.toContactRequired++;
      } else if (out.action === 'to_branch_review') {
        const next = { ...tr, status: 'branch_review' as const };
        t.set('transfers', tr.id, next);
        writeAudit(t, { ...auditBase(ctx, tr, now, 'system'), action: 'transfer.branch_review', outcome: 'ok', detailsJa: '見守り人の判断が期限内になかったため、窓口での本人確認に回しました' });
        counts.branchReview++;
      }
    });
  }
  return counts;
}
