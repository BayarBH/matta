import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { defaultTerms, type MandateTerms } from '@matta/core';
import { createApp } from './app';
import type { BankEnv } from './env';
import type { Verifiers } from './auth';
import { memoryStore } from './store';
import { seedDirectory, seedSandbox } from './seed';

const SA_WEB = 'sa-web@p.iam.gserviceaccount.com';
const SA_BANK = 'sa-bank@p.iam.gserviceaccount.com';

const baseEnv: BankEnv = {
  NODE_ENV: 'test',
  PORT: 0,
  GOOGLE_CLOUD_PROJECT: 'p',
  FIRESTORE_DATABASE_ID: 'bank-dev',
  BANK_URL: 'http://bank',
  WEB_URL: 'http://web',
  S2S_ALLOWED_SA: [SA_WEB],
  S2S_DEV_INSECURE: false,
  TASKS_MODE: 'inline',
  TASKS_ALLOWED_SA: [SA_BANK],
  DEMO_MODE: true,
  POLICY_PATH: 'unused',
};

/** Service tokens: 'web' | 'tasks' | 'other'. User tokens: '<uid>' (fresh auth) or '<uid>:stale'. */
const v: Verifiers = {
  async serviceToken(t) {
    const email = { web: SA_WEB, tasks: SA_BANK, other: 'evil@p.iam.gserviceaccount.com' }[t];
    if (!email) throw new Error('bad token');
    return { email, emailVerified: true };
  },
  async userToken(t) {
    const [uid, stale] = t.split(':') as [string, string?];
    const authTime = Math.floor(Date.now() / 1000) - (stale ? 3600 : 0);
    const m = /^(customer|contact)-(\d)$/.exec(uid);
    if (m) return { uid, auth_time: authTime, role: m[1], sandboxId: `sandbox-${m[2]}` };
    if (uid === 'operator') return { uid, auth_time: authTime, role: 'operator', sandboxId: null };
    if (uid === 'noclaims') return { uid, auth_time: authTime };
    throw new Error('bad token');
  },
};

const RENT = { bankCode: '9990', branchCode: '101', accountNumber: '1000001' };
const DEALER = { bankCode: '9990', branchCode: '102', accountNumber: '3000001' };
const UNIVERSITY = { bankCode: '9991', branchCode: '202', accountNumber: '4000001' };
const PROTECTION = { bankCode: '9992', branchCode: '303', accountNumber: '5000002' };

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const store = memoryStore();
  await seedDirectory(store);
  for (const sid of ['sandbox-1', 'sandbox-2']) await seedSandbox(store, sid);
  app = createApp({ env: baseEnv, store, policyHash: 'test-policy' }, v);
});

// ---- helpers ----
const api = () => request(app);
const asCustomerViaWeb = (r: request.Test, n = 1) => r.set('authorization', 'Bearer web').set('x-user-token', `customer-${n}`);
const send = async (to: object, amountJpy: number, memo = '') => {
  const r = await asCustomerViaWeb(api().post('/v1/transfers')).send({ ...to, amountJpy, memo });
  expect(r.status).toBe(201);
  return r.body as { id: string; status: string; ruleId: string; holdUntil: string | null };
};
const status = async (id: string) => (await api().get('/v1/transfers').set('x-user-token', 'customer-1')).body.transfers.find((t: { id: string }) => t.id === id).status;
const advance = (hours: number, n = 1) => api().post(`/demo/sandboxes/sandbox-${n}/clock`).set('x-user-token', `customer-${n}`).send({ hours });
const decide = (id: string, token: string, decision: 'approve' | 'deny') =>
  api().post(`/v1/transfers/${id}/contact-decision`).set('x-user-token', token).send({ decision, reasonJa: '確認しました' });
const balance = async () => (await api().get('/v1/me').set('x-user-token', 'customer-1')).body.balanceJpy as number;
const terms = (patch: (t: MandateTerms) => void) => {
  const t = defaultTerms({ uid: 'contact-1', displayName: '山田 美咲', relation: '姉' });
  patch(t);
  return t;
};
const changeMandate = (t: MandateTerms, token = 'customer-1') => api().post('/v1/mandate/changes').set('x-user-token', token).send({ terms: t });

// ---- tests ----
describe('service identity', () => {
  it('accepts sa-web and rejects missing, invalid and non-allowlisted tokens', async () => {
    expect((await api().get('/v1/health/secure').set('authorization', 'Bearer web')).body.caller).toEqual({ kind: 'service', email: SA_WEB });
    expect((await api().get('/v1/health/secure')).status).toBe(401);
    expect((await api().get('/v1/health/secure').set('authorization', 'Bearer junk')).status).toBe(401);
    expect((await api().get('/v1/health/secure').set('authorization', 'Bearer other')).status).toBe(401);
  });

  it('allows the dev bypass only outside production', async () => {
    const store = memoryStore();
    const dev = createApp({ env: { ...baseEnv, S2S_DEV_INSECURE: true }, store, policyHash: 'x' }, v);
    expect((await request(dev).get('/v1/health/secure')).body.caller.kind).toBe('dev-insecure');
    const prod = createApp({ env: { ...baseEnv, NODE_ENV: 'production', S2S_DEV_INSECURE: true }, store, policyHash: 'x' }, v);
    expect((await request(prod).get('/v1/health/secure')).status).toBe(401);
  });

  it('creating a transfer needs both the sa-web token and the customer token', async () => {
    expect((await api().post('/v1/transfers').set('x-user-token', 'customer-1').send({ ...RENT, amountJpy: 1000 })).status).toBe(401);
    expect((await api().post('/v1/transfers').set('authorization', 'Bearer web').send({ ...RENT, amountJpy: 1000 })).status).toBe(401);
  });

  it('/internal/holds/evaluate accepts only the Cloud Tasks service account', async () => {
    expect((await api().post('/internal/holds/evaluate').set('authorization', 'Bearer tasks').send({})).status).toBe(200);
    expect((await api().post('/internal/holds/evaluate').set('authorization', 'Bearer web').send({})).status).toBe(401);
  });
});

describe('/v1/me', () => {
  it('returns balance for customers and rejects tokens without claims', async () => {
    const r = await api().get('/v1/me').set('x-user-token', 'customer-1');
    expect(r.body).toMatchObject({ role: 'customer', sandboxId: 'sandbox-1', balanceJpy: 4_800_000 });
    expect((await api().get('/v1/me').set('x-user-token', 'contact-1')).body.balanceJpy).toBeUndefined();
    expect((await api().get('/v1/me').set('x-user-token', 'noclaims')).status).toBe(401);
  });
});

describe('acceptance flows', () => {
  it('L1: ¥85,000 rent to a registered payee settles instantly', async () => {
    const t = await send(RENT, 85_000);
    expect(t).toMatchObject({ status: 'settled', ruleId: 'R-EVERYDAY-REG' });
    expect(await balance()).toBe(4_715_000);
  });

  it('¥300,000 to a new payee is held 24 h and settles after the clock passes it', async () => {
    const t = await send(DEALER, 300_000);
    expect(t).toMatchObject({ status: 'held', ruleId: 'R-HOLD-DEFAULT' });
    await advance(1);
    expect(await status(t.id)).toBe('held');
    await advance(24);
    expect(await status(t.id)).toBe('settled');
    expect(await balance()).toBe(4_500_000);
  });

  it('verified payee is held only 1 h', async () => {
    const t = await send(UNIVERSITY, 520_000);
    expect(t).toMatchObject({ status: 'held', ruleId: 'R-HOLD-VERIFIED' });
    await advance(1);
    expect(await status(t.id)).toBe('settled');
  });

  it('¥1,200,000 to a new payee waits for the contact and settles on approval', async () => {
    const t = await send(DEALER, 1_200_000);
    expect(t).toMatchObject({ status: 'contact_required', ruleId: 'R-CONTACT-LARGE-NEW' });
    await advance(24);
    expect(await status(t.id)).toBe('contact_required');
    const r = await decide(t.id, 'contact-1', 'approve');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('settled');
    expect(await balance()).toBe(3_600_000);
  });

  it('contact denial cancels; no money leaves', async () => {
    const t = await send(DEALER, 1_200_000);
    expect((await decide(t.id, 'contact-1', 'deny')).body.status).toBe('cancelled');
    expect(await balance()).toBe(4_800_000);
  });

  it('a protection-account payee name goes to the contact by rule (bank keyword pre-check)', async () => {
    const t = await send(PROTECTION, 30_000);
    expect(t).toMatchObject({ status: 'contact_required', ruleId: 'R-READER-HIGH' });
  });
});

describe('release only under SPEC §5 conditions', () => {
  it('contact_required never settles with time; it goes to branch review after the decision window', async () => {
    const t = await send(DEALER, 1_200_000);
    await advance(72);
    expect(await status(t.id)).toBe('branch_review');
    expect(await balance()).toBe(4_800_000);
    expect((await decide(t.id, 'contact-1', 'approve')).status).toBe(409);
  });

  it('escalation is monotonic: an escalated hold does not release when the hold expires', async () => {
    const t = await send(DEALER, 290_000);
    const r = await api().post(`/v1/transfers/${t.id}/escalate`).set('authorization', 'Bearer web').send({ reasonCodes: ['urgency', 'coached_answers'] });
    expect(r.body).toMatchObject({ status: 'contact_required', escalationReasons: ['urgency', 'coached_answers'] });
    await advance(24);
    expect(await status(t.id)).toBe('contact_required');
    expect((await api().post(`/v1/transfers/${t.id}/release`).set('authorization', 'Bearer web')).status).toBe(404);
  });

  it('escalate requires sa-web', async () => {
    const t = await send(DEALER, 290_000);
    expect((await api().post(`/v1/transfers/${t.id}/escalate`).send({ reasonCodes: ['urgency'] })).status).toBe(401);
    expect((await api().post(`/v1/transfers/${t.id}/escalate`).set('authorization', 'Bearer other').send({ reasonCodes: ['urgency'] })).status).toBe(401);
    expect((await api().post(`/v1/transfers/${t.id}/escalate`).set('x-user-token', 'customer-1').send({ reasonCodes: ['urgency'] })).status).toBe(401);
    expect(await status(t.id)).toBe('held');
  });

  it('a contact of another sandbox gets 403 and nothing changes', async () => {
    const t = await send(DEALER, 1_200_000);
    expect((await decide(t.id, 'contact-2', 'approve')).status).toBe(403);
    expect(await status(t.id)).toBe('contact_required');
  });

  it('the customer cannot approve their own transfer', async () => {
    const t = await send(DEALER, 1_200_000);
    expect((await decide(t.id, 'customer-1', 'approve')).status).toBe(403);
    expect(await status(t.id)).toBe('contact_required');
  });

  it('the contact may approve a held transfer early', async () => {
    const t = await send(DEALER, 300_000);
    await api().post(`/v1/transfers/${t.id}/request-early-approval`).set('x-user-token', 'customer-1').expect(200);
    const inbox = await api().get('/v1/contact/inbox').set('x-user-token', 'contact-1');
    expect(inbox.body.transfers[0].earlyApprovalRequestedAt).toBeTruthy();
    expect((await decide(t.id, 'contact-1', 'approve')).body.status).toBe('settled');
  });

  it('contacts get a limited view without memo or customer identity', async () => {
    const t = await send(DEALER, 1_200_000, '車の代金');
    const r = await api().get(`/v1/transfers/${t.id}`).set('x-user-token', 'contact-1');
    expect(r.status).toBe(200);
    expect(r.body.memo).toBeUndefined();
    expect(r.body.customerUid).toBeUndefined();
  });

  it('the customer can cancel a held transfer', async () => {
    const t = await send(DEALER, 300_000);
    expect((await api().post(`/v1/transfers/${t.id}/cancel`).set('x-user-token', 'customer-1')).body.status).toBe('cancelled');
    await advance(24);
    expect(await status(t.id)).toBe('cancelled');
  });
});

describe('mandate changes', () => {
  it('a change without fresh auth gets 401 reauth_required', async () => {
    const r = await changeMandate(terms((t) => (t.everyday.registeredPayeeAutoMaxJpy = 100_000)), 'customer-1:stale');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('reauth_required');
  });

  it('tightening applies immediately', async () => {
    const r = await changeMandate(terms((t) => (t.everyday.registeredPayeeAutoMaxJpy = 100_000)));
    expect(r.body).toMatchObject({ kind: 'tighten', status: 'applied' });
    const m = await api().get('/v1/mandate').set('x-user-token', 'customer-1');
    expect(m.body.active.version).toBe(2);
    expect(m.body.active.everyday.registeredPayeeAutoMaxJpy).toBe(100_000);
  });

  it('loosening becomes pending, notifies the contact, moves held transfers to contact_required, applies after 72 h', async () => {
    const held = await send(DEALER, 300_000);
    const r = await changeMandate(terms((t) => (t.everyday.newPayeeAutoMaxJpy = 500_000)));
    expect(r.body).toMatchObject({ kind: 'loosen', status: 'pending', loosened: ['everyday.newPayeeAutoMaxJpy'] });
    expect(await status(held.id)).toBe('contact_required');

    const inbox = await api().get('/v1/contact/inbox').set('x-user-token', 'contact-1');
    expect(inbox.body.mandateChanges.map((c: { id: string }) => c.id)).toEqual([r.body.id]);
    const audit = await api().get('/v1/audit').query({ transferId: held.id }).set('x-user-token', 'customer-1');
    expect(audit.body.events.map((e: { action: string }) => e.action)).toContain('transfer.contact_required');

    // While the loosening is open, a new non-everyday transfer needs the contact.
    expect((await send(DEALER, 200_000)).ruleId).toBe('R-LOOSEN-OPEN');

    await advance(24);
    expect((await api().get('/v1/mandate').set('x-user-token', 'customer-1')).body.active.version).toBe(1);
    await advance(72);
    const m = await api().get('/v1/mandate').set('x-user-token', 'customer-1');
    expect(m.body.active.version).toBe(2);
    expect(m.body.active.everyday.newPayeeAutoMaxJpy).toBe(500_000);
    expect(await status(held.id)).not.toBe('settled');
  });

  it('a pending loosening never overwrites a tightening applied after it', async () => {
    const loosen = await changeMandate(terms((t) => (t.holds.holdHours = 1)));
    expect(loosen.body.status).toBe('pending');
    const tighten = await changeMandate(terms((t) => (t.contactRequired.newPayeeOverJpy = 500_000)));
    expect(tighten.body.status).toBe('applied');
    await advance(72);
    const m = (await api().get('/v1/mandate').set('x-user-token', 'customer-1')).body;
    expect(m.active.version).toBe(2);
    expect(m.active.holds.holdHours).toBe(24);
    expect(m.active.contactRequired.newPayeeOverJpy).toBe(500_000);
  });

  it('a contact change is loosening; the contact may co-sign (applies now) or deny', async () => {
    const add = await changeMandate(terms((t) => t.contacts.push({ uid: 'stranger', displayName: '新しい人', relation: '知人' })));
    expect(add.body).toMatchObject({ kind: 'loosen', status: 'pending' });
    const denied = await api()
      .post(`/v1/mandate/changes/${add.body.id}/contact-decision`)
      .set('x-user-token', 'contact-1')
      .send({ decision: 'deny', reasonJa: '知らない人です' });
    expect(denied.body.status).toBe('rejected');

    const raise = await changeMandate(terms((t) => (t.holds.holdHours = 12)));
    expect((await api().post(`/v1/mandate/changes/${raise.body.id}/contact-decision`).set('x-user-token', 'contact-2').send({ decision: 'cosign', reasonJa: 'x' })).status).toBe(403);
    const cosigned = await api()
      .post(`/v1/mandate/changes/${raise.body.id}/contact-decision`)
      .set('x-user-token', 'contact-1')
      .send({ decision: 'cosign', reasonJa: '本人と話しました' });
    expect(cosigned.body.status).toBe('applied');
    expect((await api().get('/v1/mandate').set('x-user-token', 'customer-1')).body.active.holds.holdHours).toBe(12);
  });
});

describe('demo controls', () => {
  it('a customer cannot reset or move the clock of another sandbox', async () => {
    expect((await api().post('/demo/sandboxes/sandbox-1/reset').set('x-user-token', 'customer-2')).status).toBe(403);
    expect((await advance(24, 2)).status).toBe(200);
    expect((await api().post('/demo/sandboxes/sandbox-1/clock').set('x-user-token', 'customer-2').send({ hours: 24 })).status).toBe(403);
    expect((await api().post('/demo/sandboxes/sandbox-1/clock').set('x-user-token', 'contact-1').send({ hours: 24 })).status).toBe(403);
  });

  it('reset restores the seeded balance and clears transfers', async () => {
    await send(RENT, 85_000);
    await api().post('/demo/sandboxes/sandbox-1/reset').set('x-user-token', 'customer-1').expect(200);
    expect(await balance()).toBe(4_800_000);
    expect((await api().get('/v1/transfers').set('x-user-token', 'customer-1')).body.transfers).toEqual([]);
  });
});

describe('ops metrics', () => {
  it('is operator-only and counts transfers across sandboxes', async () => {
    expect((await api().get('/v1/ops/metrics').set('x-user-token', 'customer-1')).status).toBe(403);
    await send(RENT, 85_000);
    const held = await send(DEALER, 300_000);
    await send(DEALER, 1_200_000);
    await advance(24);
    expect(await status(held.id)).toBe('settled');
    const m = (await api().get('/v1/ops/metrics').set('x-user-token', 'operator')).body;
    expect(m.byStatus).toEqual({ settled: 2, contact_required: 1 });
    expect(m.byRule).toMatchObject({ 'R-EVERYDAY-REG': 1, 'R-HOLD-DEFAULT': 1, 'R-CONTACT-LARGE-NEW': 1 });
    expect(m.contactRequired).toBe(1);
    expect(m.openHolds).toBe(0);
    expect(m.medianAddedDelayMinLegit).toBeGreaterThanOrEqual(24 * 60);
  });
});
