import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { z, ZodError } from 'zod';
import {
  ClockBody,
  ContactDecisionBody,
  ContactTransferView,
  CreateTransferBody,
  EscalateBody,
  LookupBody,
  MandateChange,
  MandateChangeBody,
  MandateChangeDecisionBody,
  MandateTerms,
  AuditEvent,
  classifyChange,
  decideRelease,
  evaluateTransfer,
  keywordFlags,
  type AccountRef,
  type ContactInbox,
  type Flag,
  type LookupResult,
  type MandateView,
  type MeResult,
  type SecureHealth,
} from '@matta/core';
import type { BankEnv } from './env';
import { checkService, requireService, requireUser, type OnReject, type Verifiers } from './auth';
import {
  AccountDoc,
  DirectoryDoc,
  HttpError,
  PayeeDoc,
  StoredTransfer,
  activeMandate,
  applyChangeInTx,
  auditBase,
  auditEvent,
  evaluateSandbox,
  getSandbox,
  getTransfer,
  sandboxChanges,
  sandboxNow,
  settleInTx,
  toContactRequiredByLoosening,
  withConditions,
  writeAudit,
  type Ctx,
} from './bank';
import { accountKey, seedDirectory, seedSandbox } from './seed';
import type { Store, Tx } from './store';
import { log } from './log';

const FRESH_AUTH_SECONDS = 300;
const LOOSEN_LOOKBACK_MS = 72 * 3600_000;
const jstDay = (iso: string | Date) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const actorOf = (req: Request) =>
  req.user ? `${req.user.role}:${req.user.uid}` : req.service ? `service:${req.service.email}` : 'anonymous';

async function resolvePayee(r: Pick<Store, 'get'> | Tx, sid: string, ref: AccountRef) {
  const key = accountKey(ref);
  const dirDoc = await r.get('directory', key);
  if (!dirDoc) return null;
  const dir = DirectoryDoc.parse(dirDoc);
  const reg = await r.get('payees', `${sid}-${key}`);
  if (reg) return { dir, payeeKind: 'registered' as const, displayName: PayeeDoc.parse(reg).displayName };
  if (await r.get('verifiedPayees', key)) return { dir, payeeKind: 'verified' as const };
  return { dir, payeeKind: 'new' as const };
}

export function createApp(ctx: Ctx, v: Verifiers) {
  const { env, store } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: env.WEB_URL, allowedHeaders: ['content-type', 'x-user-token', 'authorization'] }));
  app.use(express.json({ limit: '32kb' }));

  const onReject: OnReject = (req, status, reason) => {
    const ev = auditEvent({
      sandboxId: req.user?.sandboxId ?? null,
      actor: actorOf(req),
      action: 'auth.rejected',
      targetType: 'route',
      targetId: `${req.method} ${req.path}`,
      policyHash: ctx.policyHash,
      outcome: 'rejected',
      detailsJa: status === 401 ? `認証に失敗したため拒否しました（${reason.slice(0, 80)}）` : `権限がないため拒否しました（${reason.slice(0, 80)}）`,
    });
    store.set('bankAudit', ev.id, ev).catch((e) => log('ERROR', 'audit write failed', { error: String(e) }));
  };

  const W = requireService(env, v, onReject);
  const T = requireService(env, v, onReject, env.TASKS_ALLOWED_SA);
  const user = (...roles: Parameters<typeof requireUser>[1]) => requireUser(v, roles, onReject);
  const C = user('customer');
  const K = user('contact');

  /** Customer of this sandbox only. */
  const ownSandbox = (req: Request, sid: string) => {
    if (req.user?.sandboxId !== sid) throw new HttpError(403, 'other_sandbox');
  };

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/v1/health/secure', W, (req, res) => {
    log('INFO', 'secure health verified', { caller: req.service });
    const body: SecureHealth = { ok: true, caller: req.service! };
    res.json(body);
  });

  app.get(
    '/v1/me',
    user('customer', 'contact', 'operator'),
    h(async (req, res) => {
      const { uid, email, role, sandboxId } = req.user!;
      const body: MeResult = { uid, email, role, sandboxId: sandboxId ?? null };
      if (sandboxId) {
        body.now = (await sandboxNow(store, sandboxId)).toISOString();
        if (role === 'customer') {
          const acct = AccountDoc.parse(await store.get('accounts', sandboxId));
          Object.assign(body, { displayName: acct.displayName, balanceJpy: acct.balanceJpy });
        } else {
          const m = await activeMandate(store, sandboxId);
          body.displayName = m.contacts.find((c) => c.uid === uid)?.displayName ?? '見守り人';
        }
      }
      res.json(body);
    }),
  );

  app.post(
    '/v1/directory/lookup',
    W,
    C,
    h(async (req, res) => {
      const ref = LookupBody.parse(req.body);
      const p = await resolvePayee(store, req.user!.sandboxId!, ref);
      const body: LookupResult = p
        ? { found: true, holderNameKana: p.dir.holderNameKana, payeeKind: p.payeeKind, ...(p.payeeKind === 'registered' ? { displayName: p.displayName } : {}) }
        : { found: false };
      res.json(body);
    }),
  );

  app.post(
    '/v1/transfers',
    W,
    C,
    h(async (req, res) => {
      const body = CreateTransferBody.parse(req.body);
      const sid = req.user!.sandboxId!;
      const actor = actorOf(req);
      const created = await store.tx(async (t) => {
        const now = await sandboxNow(t, sid);
        const mandate = await activeMandate(t, sid);
        const payee = await resolvePayee(t, sid, body);
        if (!payee) throw new HttpError(404, 'payee_not_found');
        const acct = AccountDoc.parse(await t.get('accounts', sid));
        if (acct.balanceJpy < body.amountJpy) throw new HttpError(422, 'insufficient_balance');
        const all = (await t.where('transfers', 'sandboxId', sid)).map((d) => StoredTransfer.parse(d));
        const settledTodayJpy = all
          .filter((x) => x.status === 'settled' && x.settledAt && jstDay(x.settledAt) === jstDay(now))
          .reduce((s, x) => s + x.amountJpy, 0);
        const recentLoosening = (await sandboxChanges(t, sid)).some(
          (c) => c.kind === 'loosen' && now.getTime() - new Date(c.requestedAt).getTime() < LOOSEN_LOOKBACK_MS,
        );
        // Bank keyword pre-check ∪ web reader flags (which can only add).
        const flags = new Map<string, Flag>();
        for (const f of [...keywordFlags({ payeeName: payee.dir.holderNameKana, memo: body.memo }), ...body.readerFlags]) {
          if (!flags.has(`${f.code}:${f.field}`)) flags.set(`${f.code}:${f.field}`, f);
        }
        const ev = evaluateTransfer({
          terms: mandate,
          amountJpy: body.amountJpy,
          payeeKind: payee.payeeKind,
          settledTodayJpy,
          now,
          recentLoosening,
          flags: [...flags.values()],
        });
        const nowIso = now.toISOString();
        const tr: StoredTransfer = {
          id: randomUUID(),
          sandboxId: sid,
          customerUid: req.user!.uid,
          amountJpy: body.amountJpy,
          payee: {
            bankCode: body.bankCode,
            branchCode: body.branchCode,
            accountNumber: body.accountNumber,
            holderNameKana: payee.dir.holderNameKana,
            payeeKind: payee.payeeKind,
            ...(payee.payeeKind === 'registered' ? { displayName: payee.displayName } : {}),
          },
          memo: body.memo,
          status: ev.tier === 'clear' ? 'held' : ev.tier, // clear settles below in the same transaction
          ruleId: ev.ruleId,
          explanationJa: ev.explanationJa,
          flags: [...flags.values()],
          holdUntil: ev.tier === 'held' ? new Date(now.getTime() + ev.holdHours! * 3600_000).toISOString() : null,
          escalatedAt: null,
          escalationReasons: [],
          contactRequiredSince: ev.tier === 'contact_required' ? nowIso : null,
          earlyApprovalRequestedAt: null,
          decision: null,
          createdAt: nowIso,
          settledAt: null,
          cancelledAt: null,
          mandateVersion: mandate.version,
          mandateHash: mandate.hash,
          policyHash: ctx.policyHash,
        };
        t.set('transfers', tr.id, tr);
        writeAudit(t, {
          ...auditBase(ctx, tr, now, actor),
          action: 'transfer.created',
          outcome: ev.tier === 'clear' ? 'ok' : 'pending',
          detailsJa: `${ev.tier === 'clear' ? '日常の範囲内' : ev.tier === 'held' ? '保留' : '見守り人の承認が必要'}：${ev.explanationJa}`,
        });
        return { tr: ev.tier === 'clear' ? await settleInTx(ctx, t, tr, now, 'system', '日常の範囲内') : tr, offset: (await getSandbox(t, sid)).clockOffsetMs };
      });
      if (created.tr.status === 'held' && ctx.enqueueHold) {
        await ctx.enqueueHold(created.tr, created.offset).catch((e) =>
          log('ERROR', 'enqueue hold evaluation failed; hold stays in place', { transferId: created.tr.id, error: String(e) }),
        );
      }
      res.status(201).json(withConditions(created.tr));
    }),
  );

  app.get(
    '/v1/transfers',
    C,
    h(async (req, res) => {
      const transfers = (await store.where('transfers', 'sandboxId', req.user!.sandboxId))
        .map((d) => withConditions(StoredTransfer.parse(d)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({ transfers });
    }),
  );

  app.get(
    '/v1/transfers/:id',
    user('customer', 'contact', 'operator'),
    h(async (req, res) => {
      const role = req.user!.role;
      if (role === 'customer') {
        try {
          req.service = await checkService(env, v, req, env.S2S_ALLOWED_SA);
        } catch (e) {
          throw new HttpError(401, 'service_auth_required');
        }
      }
      const tr = await getTransfer(store, String(req.params.id));
      if (role !== 'operator') ownSandbox(req, tr.sandboxId);
      res.json(role === 'contact' ? ContactTransferView.parse(withConditions(tr)) : withConditions(tr));
    }),
  );

  app.post(
    '/v1/transfers/:id/escalate',
    W,
    h(async (req, res) => {
      const { reasonCodes } = EscalateBody.parse(req.body);
      const actor = actorOf(req);
      const out = await store.tx(async (t) => {
        const tr = await getTransfer(t, String(req.params.id));
        const now = await sandboxNow(t, tr.sandboxId);
        if (tr.status !== 'held' && tr.status !== 'contact_required') throw new HttpError(409, 'not_escalatable');
        const next: StoredTransfer = {
          ...tr,
          status: 'contact_required',
          contactRequiredSince: tr.contactRequiredSince ?? now.toISOString(),
          escalatedAt: tr.escalatedAt ?? now.toISOString(),
          escalationReasons: [...new Set([...tr.escalationReasons, ...reasonCodes])],
        };
        t.set('transfers', tr.id, next);
        writeAudit(t, {
          ...auditBase(ctx, next, now, actor),
          action: 'transfer.escalated',
          outcome: 'ok',
          detailsJa: `見守り人の承認が必要な状態にしました（理由: ${reasonCodes.join(', ')}）`,
        });
        return next;
      });
      res.json(withConditions(out));
    }),
  );

  app.post(
    '/v1/transfers/:id/request-early-approval',
    C,
    h(async (req, res) => {
      const actor = actorOf(req);
      const out = await store.tx(async (t) => {
        const tr = await getTransfer(t, String(req.params.id));
        ownSandbox(req, tr.sandboxId);
        if (tr.status !== 'held') throw new HttpError(409, 'not_held');
        const now = await sandboxNow(t, tr.sandboxId);
        const next = { ...tr, earlyApprovalRequestedAt: tr.earlyApprovalRequestedAt ?? now.toISOString() };
        t.set('transfers', tr.id, next);
        writeAudit(t, { ...auditBase(ctx, tr, now, actor), action: 'transfer.early_approval_requested', outcome: 'ok', detailsJa: '見守り人に早めの承認を依頼しました' });
        return next;
      });
      res.json(withConditions(out));
    }),
  );

  app.post(
    '/v1/transfers/:id/cancel',
    C,
    h(async (req, res) => {
      const actor = actorOf(req);
      const out = await store.tx(async (t) => {
        const tr = await getTransfer(t, String(req.params.id));
        ownSandbox(req, tr.sandboxId);
        if (tr.status !== 'held' && tr.status !== 'contact_required') throw new HttpError(409, 'not_cancellable');
        const now = await sandboxNow(t, tr.sandboxId);
        const next = { ...tr, status: 'cancelled' as const, cancelledAt: now.toISOString() };
        t.set('transfers', tr.id, next);
        writeAudit(t, { ...auditBase(ctx, tr, now, actor), action: 'transfer.cancelled', outcome: 'ok', detailsJa: 'ご本人が振込を取り消しました' });
        return next;
      });
      res.json(withConditions(out));
    }),
  );

  app.post(
    '/v1/transfers/:id/contact-decision',
    K,
    h(async (req, res) => {
      const body = ContactDecisionBody.parse(req.body);
      const { uid, role } = req.user!;
      const actor = actorOf(req);
      const out = await store.tx(async (t) => {
        const tr = await getTransfer(t, String(req.params.id));
        ownSandbox(req, tr.sandboxId);
        const mandate = await activeMandate(t, tr.sandboxId);
        const listed = mandate.contacts.some((c) => c.uid === uid);
        if (!listed) throw new HttpError(403, 'not_a_listed_contact');
        if (tr.status !== 'held' && tr.status !== 'contact_required') throw new HttpError(409, 'not_pending');
        const now = await sandboxNow(t, tr.sandboxId);
        const decision = { contactUid: uid, decision: body.decision, reasonJa: body.reasonJa, decidedAt: now.toISOString() };
        const decisionId = randomUUID();
        t.set('contactDecisions', decisionId, { id: decisionId, sandboxId: tr.sandboxId, transferId: tr.id, ...decision });
        const withDecision = { ...tr, decision };
        if (body.decision === 'deny') {
          const next = { ...withDecision, status: 'cancelled' as const, cancelledAt: now.toISOString() };
          t.set('transfers', tr.id, next);
          writeAudit(t, { ...auditBase(ctx, tr, now, actor), action: 'transfer.contact_denied', outcome: 'ok', detailsJa: `見守り人が承認しませんでした（${body.reasonJa}）` });
          return next;
        }
        const rel = decideRelease(tr, { kind: 'contact_approval', now, decidedAt: now, contactRole: role, sameSandbox: true, listedInActiveMandate: listed });
        if (rel.action !== 'settle') throw new HttpError(409, 'not_releasable');
        writeAudit(t, { ...auditBase(ctx, tr, now, actor), action: 'transfer.contact_approved', outcome: 'ok', detailsJa: `見守り人が承認しました（${body.reasonJa}）` });
        return settleInTx(ctx, t, withDecision, now, actor, '見守り人の承認');
      });
      res.json(ContactTransferView.parse(withConditions(out)));
    }),
  );

  app.get(
    '/v1/contact/inbox',
    K,
    h(async (req, res) => {
      const sid = req.user!.sandboxId!;
      const transfers = (await store.where('transfers', 'sandboxId', sid))
        .map((d) => StoredTransfer.parse(d))
        .filter((t) => t.status === 'held' || t.status === 'contact_required')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((t) => ContactTransferView.parse(withConditions(t)));
      const mandateChanges = (await sandboxChanges(store, sid)).filter((c) => c.status === 'pending');
      const body: ContactInbox = { transfers, mandateChanges };
      res.json(body);
    }),
  );

  app.get(
    '/v1/mandate',
    user('customer', 'contact', 'operator'),
    h(async (req, res) => {
      const sid = req.user!.role === 'operator' ? z.string().parse(req.query.sandboxId) : req.user!.sandboxId!;
      const body: MandateView = {
        active: await activeMandate(store, sid),
        pending: (await sandboxChanges(store, sid)).filter((c) => c.status === 'pending'),
      };
      res.json(body);
    }),
  );

  app.post(
    '/v1/mandate/changes',
    C,
    h(async (req, res) => {
      const { uid, authTime } = req.user!;
      const sid = req.user!.sandboxId!;
      if (Date.now() / 1000 - authTime > FRESH_AUTH_SECONDS) {
        onReject(req, 401, 'mandate change without fresh auth');
        res.status(401).json({ error: 'reauth_required' });
        return;
      }
      const { terms } = MandateChangeBody.parse(req.body);
      const actor = actorOf(req);
      const out = await store.tx(async (t) => {
        const now = await sandboxNow(t, sid);
        const mandate = await activeMandate(t, sid);
        const cls = classifyChange(MandateTerms.parse(mandate), terms);
        if (cls.kind === 'noop') throw new HttpError(400, 'no_change');
        const change: MandateChange = {
          id: randomUUID(),
          sandboxId: sid,
          requestedBy: uid,
          requestedAt: now.toISOString(),
          fromVersion: mandate.version,
          proposed: terms,
          kind: cls.kind,
          loosened: cls.loosened,
          status: 'pending',
          effectiveAt: null,
          decidedBy: null,
          decidedAt: null,
          reasonJa: null,
        };
        if (cls.kind === 'tighten') {
          t.set('mandateChanges', change.id, change);
          return applyChangeInTx(ctx, t, change, now, actor, 'ルールを厳しくする変更のため、すぐに適用しました');
        }
        const pending = { ...change, effectiveAt: new Date(now.getTime() + mandate.changes.loosenCoolingOffHours * 3600_000).toISOString() };
        t.set('mandateChanges', pending.id, pending);
        const base = { simTs: now.toISOString(), sandboxId: sid, targetType: 'mandateChange', targetId: pending.id, mandateHash: mandate.hash, policyHash: ctx.policyHash };
        writeAudit(t, { ...base, actor, action: 'mandate.loosen_requested', outcome: 'pending', detailsJa: `ルールをゆるめる申請（${cls.loosened.join(', ')}）。${mandate.changes.loosenCoolingOffHours}時間後に有効` });
        for (const c of mandate.contacts) {
          writeAudit(t, { ...base, actor: 'system', action: 'contact.notified', outcome: 'ok', detailsJa: `見守り人（${c.displayName}）にルール変更の申請をお知らせしました` });
        }
        const held = (await t.where('transfers', 'sandboxId', sid)).map((d) => StoredTransfer.parse(d)).filter((x) => x.status === 'held');
        for (const tr of held) toContactRequiredByLoosening(ctx, t, tr, mandate, now);
        return pending;
      });
      res.status(201).json(out);
    }),
  );

  app.post(
    '/v1/mandate/changes/:id/contact-decision',
    K,
    h(async (req, res) => {
      const body = MandateChangeDecisionBody.parse(req.body);
      const { uid } = req.user!;
      const actor = actorOf(req);
      const out = await store.tx(async (t) => {
        const raw = await t.get('mandateChanges', String(req.params.id));
        if (!raw) throw new HttpError(404, 'change_not_found');
        const change = MandateChange.parse(raw);
        ownSandbox(req, change.sandboxId);
        const mandate = await activeMandate(t, change.sandboxId);
        if (!mandate.contacts.some((c) => c.uid === uid)) throw new HttpError(403, 'not_a_listed_contact');
        if (change.status !== 'pending') throw new HttpError(409, 'not_pending');
        const now = await sandboxNow(t, change.sandboxId);
        const decided = { ...change, decidedBy: uid, decidedAt: now.toISOString(), reasonJa: body.reasonJa };
        if (body.decision === 'cosign') {
          if (!mandate.changes.contactMayCosignLoosening) throw new HttpError(409, 'cosign_disabled');
          return applyChangeInTx(ctx, t, decided, now, actor, `見守り人が承認したため、ルールの変更を適用しました（${body.reasonJa}）`);
        }
        const rejected = { ...decided, status: 'rejected' as const };
        t.set('mandateChanges', change.id, rejected);
        writeAudit(t, {
          simTs: now.toISOString(),
          sandboxId: change.sandboxId,
          actor,
          action: 'mandate.rejected',
          targetType: 'mandateChange',
          targetId: change.id,
          mandateHash: mandate.hash,
          policyHash: ctx.policyHash,
          outcome: 'ok',
          detailsJa: `見守り人がルールの変更を承認しませんでした（${body.reasonJa}）`,
        });
        return rejected;
      });
      res.json(out);
    }),
  );

  app.get(
    '/v1/mandate/changes/:id',
    user('customer', 'contact'),
    h(async (req, res) => {
      const raw = await store.get('mandateChanges', String(req.params.id));
      if (!raw) throw new HttpError(404, 'change_not_found');
      const change = MandateChange.parse(raw);
      ownSandbox(req, change.sandboxId);
      res.json(change);
    }),
  );

  app.post(
    '/v1/mandate/changes/:id/withdraw',
    C,
    h(async (req, res) => {
      const actor = actorOf(req);
      const out = await store.tx(async (t) => {
        const raw = await t.get('mandateChanges', String(req.params.id));
        if (!raw) throw new HttpError(404, 'change_not_found');
        const change = MandateChange.parse(raw);
        ownSandbox(req, change.sandboxId);
        if (change.status !== 'pending') throw new HttpError(409, 'not_pending');
        const now = await sandboxNow(t, change.sandboxId);
        const next = { ...change, status: 'withdrawn' as const, decidedBy: req.user!.uid, decidedAt: now.toISOString() };
        t.set('mandateChanges', change.id, next);
        writeAudit(t, {
          simTs: now.toISOString(),
          sandboxId: change.sandboxId,
          actor,
          action: 'mandate.withdrawn',
          targetType: 'mandateChange',
          targetId: change.id,
          policyHash: ctx.policyHash,
          outcome: 'ok',
          detailsJa: 'ご本人がルール変更の申請を取り下げました',
        });
        return next;
      });
      res.json(out);
    }),
  );

  app.get(
    '/v1/audit',
    user('customer', 'operator'),
    h(async (req, res) => {
      const transferId = z.string().min(1).parse(req.query.transferId);
      let events = (await store.where('bankAudit', 'targetId', transferId)).map((d) => AuditEvent.parse(d));
      if (req.user!.role === 'customer') events = events.filter((e) => e.sandboxId === req.user!.sandboxId);
      res.json({ events: events.sort((a, b) => a.ts.localeCompare(b.ts)) });
    }),
  );

  app.get(
    '/v1/ops/metrics',
    user('operator'),
    h(async (_req, res) => {
      const all = (await store.all('transfers')).map((d) => StoredTransfer.parse(d));
      const count = (key: (t: StoredTransfer) => string) =>
        all.reduce<Record<string, number>>((acc, t) => ((acc[key(t)] = (acc[key(t)] ?? 0) + 1), acc), {});
      // Added delay for transfers that settled but were not cleared instantly (sandbox minutes).
      const delays = all
        .filter((t) => t.status === 'settled' && t.settledAt && t.settledAt !== t.createdAt)
        .map((t) => (Date.parse(t.settledAt!) - Date.parse(t.createdAt)) / 60_000)
        .sort((a, b) => a - b);
      const mid = delays.length >> 1;
      res.json({
        byStatus: count((t) => t.status),
        byRule: count((t) => t.ruleId),
        openHolds: all.filter((t) => t.status === 'held').length,
        contactRequired: all.filter((t) => t.status === 'contact_required').length,
        medianAddedDelayMinLegit: delays.length ? (delays.length % 2 ? delays[mid]! : (delays[mid - 1]! + delays[mid]!) / 2) : null,
      });
    }),
  );

  app.post(
    '/internal/holds/evaluate',
    T,
    h(async (req, res) => {
      const { sandboxId } = z.object({ sandboxId: z.string().optional() }).parse(req.body ?? {});
      const sids = sandboxId ? [sandboxId] : (await store.all('sandboxes')).map((d) => String(d.id));
      const total = { settled: 0, branchReview: 0, applied: 0, toContactRequired: 0 };
      for (const sid of sids) {
        const c = await evaluateSandbox(ctx, sid);
        for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += c[k];
      }
      log('INFO', 'holds evaluated', { caller: req.service, ...total });
      res.json(total);
    }),
  );

  // ---- demo controls (DEMO_MODE only) ----
  const demo = express.Router();
  demo.use((_req, res, next) => (env.DEMO_MODE ? next() : res.status(404).json({ error: 'not_found' })));
  demo.use(user('customer', 'operator'));
  const demoSandbox = (req: Request) => {
    const sid = String(req.params.sid);
    if (req.user!.role === 'customer') ownSandbox(req, sid);
    return sid;
  };
  demo.post(
    '/sandboxes/:sid/reset',
    h(async (req, res) => {
      const sid = demoSandbox(req);
      await getSandbox(store, sid);
      await seedDirectory(store);
      await seedSandbox(store, sid);
      const ev = auditEvent({ sandboxId: sid, actor: actorOf(req), action: 'demo.reset', targetType: 'sandbox', targetId: sid, policyHash: ctx.policyHash, outcome: 'ok', detailsJa: 'デモ環境を初期状態に戻しました' });
      await store.set('bankAudit', ev.id, ev);
      res.json({ ok: true });
    }),
  );
  demo.post(
    '/sandboxes/:sid/clock',
    h(async (req, res) => {
      const sid = demoSandbox(req);
      const { hours } = ClockBody.parse(req.body);
      const actor = actorOf(req);
      const now = await store.tx(async (t) => {
        const sb = await getSandbox(t, sid);
        const next = { ...sb, clockOffsetMs: sb.clockOffsetMs + hours * 3600_000 };
        t.set('sandboxes', sid, next);
        const now = new Date(Date.now() + next.clockOffsetMs);
        writeAudit(t, { simTs: now.toISOString(), sandboxId: sid, actor, action: 'demo.clock_advanced', targetType: 'sandbox', targetId: sid, policyHash: ctx.policyHash, outcome: 'ok', detailsJa: `デモの時計を${hours}時間進めました` });
        return now;
      });
      const counts = await evaluateSandbox(ctx, sid);
      res.json({ now: now.toISOString(), ...counts });
    }),
  );
  app.use('/demo', demo);

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      if (err.status === 401 || err.status === 403) onReject(req, err.status, err.code);
      res.status(err.status).json({ error: err.code });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid_request', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      return;
    }
    log('ERROR', 'unhandled error', { path: req.path, error: String(err), stack: (err as Error)?.stack });
    res.status(500).json({ error: 'internal' });
  });

  return app;
}

export type { BankEnv };
