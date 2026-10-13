// Authorization / spoof suite (SPEC §14): every attempt here must be rejected, and every 401/403 audited.
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { defaultTerms } from '@matta/core';
import { createApp } from './app';
import type { BankEnv } from './env';
import type { Verifiers } from './auth';
import { memoryStore } from './store';
import { seedDirectory, seedSandbox } from './seed';

const SA_WEB = 'sa-web@p.iam.gserviceaccount.com';
const SA_BANK = 'sa-bank@p.iam.gserviceaccount.com';
const baseEnv: BankEnv = {
  NODE_ENV: 'production',
  PORT: 0,
  GOOGLE_CLOUD_PROJECT: 'p',
  FIRESTORE_DATABASE_ID: 'bank',
  BANK_URL: 'http://bank',
  WEB_URL: 'http://web',
  S2S_ALLOWED_SA: [SA_WEB],
  S2S_DEV_INSECURE: true, // must be ignored in production
  TASKS_MODE: 'inline',
  TASKS_ALLOWED_SA: [SA_BANK],
  DEMO_MODE: true,
  POLICY_PATH: 'unused',
};

/** Service tokens: 'web' | 'tasks' | 'other'. User tokens: '<uid>' (fresh) or '<uid>:stale'. */
const v: Verifiers = {
  async serviceToken(t) {
    const email = { web: SA_WEB, tasks: SA_BANK, other: 'evil@p.iam.gserviceaccount.com' }[t];
    if (!email) throw new Error('bad token');
    return { email, emailVerified: true };
  },
  async userToken(t) {
    const [uid, stale] = t.split(':') as [string, string?];
    const auth_time = Math.floor(Date.now() / 1000) - (stale ? 3600 : 0);
    const m = /^(customer|contact)-(\d)$/.exec(uid);
    if (m) return { uid, auth_time, role: m[1], sandboxId: `sandbox-${m[2]}` };
    if (uid === 'operator') return { uid, auth_time, role: 'operator', sandboxId: null };
    throw new Error('bad token');
  },
};

const DEALER = { bankCode: '9990', branchCode: '102', accountNumber: '3000001' };

let store: ReturnType<typeof memoryStore>;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  store = memoryStore();
  await seedDirectory(store);
  for (const sid of ['sandbox-1', 'sandbox-2']) await seedSandbox(store, sid);
  app = createApp({ env: baseEnv, store, policyHash: 'test' }, v);
});

const api = () => request(app);
const send = async (amountJpy: number) => {
  const r = await api().post('/v1/transfers').set('authorization', 'Bearer web').set('x-user-token', 'customer-1').send({ ...DEALER, amountJpy });
  expect(r.status).toBe(201);
  return r.body as { id: string; status: string };
};
const statusOf = async (id: string) =>
  (await api().get(`/v1/transfers/${id}`).set('authorization', 'Bearer web').set('x-user-token', 'customer-1')).body.status as string;
const rejectedAudits = async () => (await store.all('bankAudit')).filter((e) => e.outcome === 'rejected').length;
const decision = { decision: 'approve', reasonJa: '確認しました' };

/** Runs one attempt, expects the status, and checks a 401/403 left a 'rejected' audit event. */
let attempts = 0;
async function expectRejected(r: request.Test, status: number) {
  const before = await rejectedAudits();
  const res = await r;
  attempts++;
  expect(res.status).toBe(status);
  if (status === 401 || status === 403) {
    await new Promise((ok) => setTimeout(ok, 5)); // onReject writes fire-and-forget
    expect(await rejectedAudits()).toBe(before + 1);
  }
  return res;
}

describe('authorization / spoof suite', () => {
  it('a contact of another sandbox cannot decide transfers or mandate changes, and sees none of them', async () => {
    const t = await send(1_200_000);
    await expectRejected(api().post(`/v1/transfers/${t.id}/contact-decision`).set('x-user-token', 'contact-2').send(decision), 403);
    const loosen = defaultTerms({ uid: 'contact-1', displayName: '山田 美咲', relation: '姉' });
    loosen.holds.holdHours = 1;
    const ch = await api().post('/v1/mandate/changes').set('x-user-token', 'customer-1').send({ terms: loosen });
    expect(ch.body.status).toBe('pending');
    await expectRejected(
      api().post(`/v1/mandate/changes/${ch.body.id}/contact-decision`).set('x-user-token', 'contact-2').send({ decision: 'cosign', reasonJa: 'x' }),
      403,
    );
    const inbox = (await api().get('/v1/contact/inbox').set('x-user-token', 'contact-2')).body;
    expect(inbox.transfers).toEqual([]);
    expect(inbox.mandateChanges).toEqual([]);
    await expectRejected(api().get(`/v1/transfers/${t.id}`).set('x-user-token', 'contact-2'), 403);
    expect(await statusOf(t.id)).toBe('contact_required');
  });

  it('the customer cannot approve their own transfer; the operator cannot either', async () => {
    const t = await send(1_200_000);
    await expectRejected(api().post(`/v1/transfers/${t.id}/contact-decision`).set('x-user-token', 'customer-1').send(decision), 403);
    await expectRejected(api().post(`/v1/transfers/${t.id}/contact-decision`).set('x-user-token', 'operator').send(decision), 403);
    expect(await statusOf(t.id)).toBe('contact_required');
  });

  it('escalate needs sa-web: no token, user tokens and other service accounts get 401 (dev bypass ignored in production)', async () => {
    const t = await send(300_000);
    const esc = () => api().post(`/v1/transfers/${t.id}/escalate`).send({ reasonCodes: ['urgency'] });
    await expectRejected(esc(), 401);
    await expectRejected(esc().set('x-user-token', 'contact-1'), 401);
    await expectRejected(esc().set('authorization', 'Bearer other'), 401);
    await expectRejected(esc().set('authorization', 'Bearer tasks'), 401);
    expect(await statusOf(t.id)).toBe('held');
  });

  it('escalate never lowers anything: contact_required stays, settled/cancelled get 409', async () => {
    const big = await send(1_200_000);
    const r = await api().post(`/v1/transfers/${big.id}/escalate`).set('authorization', 'Bearer web').send({ reasonCodes: ['urgency'] });
    expect(r.body.status).toBe('contact_required');
    await api().post(`/v1/transfers/${big.id}/cancel`).set('x-user-token', 'customer-1');
    await expectRejected(api().post(`/v1/transfers/${big.id}/escalate`).set('authorization', 'Bearer web').send({ reasonCodes: ['urgency'] }), 409);
    expect(await statusOf(big.id)).toBe('cancelled');
  });

  it('a mandate change without fresh auth gets 401', async () => {
    const t = defaultTerms({ uid: 'contact-1', displayName: '山田 美咲', relation: '姉' });
    t.everyday.registeredPayeeAutoMaxJpy = 1;
    await expectRejected(api().post('/v1/mandate/changes').set('x-user-token', 'customer-1:stale').send({ terms: t }), 401);
  });

  it('forged clock calls are rejected; demo routes vanish without DEMO_MODE', async () => {
    const clock = () => api().post('/demo/sandboxes/sandbox-1/clock').send({ hours: 72 });
    await expectRejected(clock().set('x-user-token', 'customer-2'), 403);
    await expectRejected(clock().set('x-user-token', 'contact-1'), 403);
    await expectRejected(clock(), 401);
    const prodApp = createApp({ env: { ...baseEnv, DEMO_MODE: false }, store, policyHash: 'test' }, v);
    expect((await request(prodApp).post('/demo/sandboxes/sandbox-1/clock').set('x-user-token', 'customer-1').send({ hours: 72 })).status).toBe(404);
    attempts++;
  });

  it('the internal hold evaluator rejects sa-web and users', async () => {
    await expectRejected(api().post('/internal/holds/evaluate').set('authorization', 'Bearer web').send({}), 401);
    await expectRejected(api().post('/internal/holds/evaluate').set('x-user-token', 'operator').send({}), 401);
  });

  it('there is no route that releases, settles or de-escalates a transfer', async () => {
    const t = await send(1_200_000);
    for (const p of ['release', 'settle', 'approve', 'de-escalate', 'unescalate', 'unlock']) {
      const r = await api().post(`/v1/transfers/${t.id}/${p}`).set('authorization', 'Bearer web').set('x-user-token', 'customer-1').send({});
      attempts++;
      expect(r.status, p).toBe(404);
    }
    for (const m of ['patch', 'put', 'delete'] as const) {
      const r = await api()[m](`/v1/transfers/${t.id}`).set('authorization', 'Bearer web').set('x-user-token', 'customer-1').send({ status: 'settled' });
      attempts++;
      expect(r.status, m).toBe(404);
    }
    expect(await statusOf(t.id)).toBe('contact_required');
  });

  it('a contact removed from the active mandate can no longer decide', async () => {
    const replaced = defaultTerms({ uid: 'contact-9', displayName: '別の人', relation: '友人' });
    const ch = await api().post('/v1/mandate/changes').set('x-user-token', 'customer-1').send({ terms: replaced });
    expect(ch.body.kind).toBe('loosen');
    const co = await api().post(`/v1/mandate/changes/${ch.body.id}/contact-decision`).set('x-user-token', 'contact-1').send({ decision: 'cosign', reasonJa: '了解' });
    expect(co.body.status).toBe('applied');
    const t = await send(1_200_000);
    await expectRejected(api().post(`/v1/transfers/${t.id}/contact-decision`).set('x-user-token', 'contact-1').send(decision), 403);
    expect(await statusOf(t.id)).toBe('contact_required');
  });

  it('summary: every attempt above was rejected', () => {
    console.log(`authz suite: ${attempts} spoof/authorization attempts, all rejected`);
    expect(attempts).toBeGreaterThan(20);
  });
});
