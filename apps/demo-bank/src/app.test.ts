import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import type { BankEnv } from './env';
import type { Verifiers } from './auth';

const baseEnv: BankEnv = {
  NODE_ENV: 'test',
  PORT: 0,
  GOOGLE_CLOUD_PROJECT: 'p',
  FIRESTORE_DATABASE_ID: 'bank-dev',
  BANK_URL: 'http://bank',
  WEB_URL: 'http://web',
  S2S_ALLOWED_SA: ['sa-web@p.iam.gserviceaccount.com'],
  S2S_DEV_INSECURE: false,
  TASKS_MODE: 'inline',
  DEMO_MODE: false,
};

const v: Verifiers = {
  async serviceToken(t) {
    if (t === 'web') return { email: 'sa-web@p.iam.gserviceaccount.com', emailVerified: true };
    if (t === 'other') return { email: 'evil@p.iam.gserviceaccount.com', emailVerified: true };
    throw new Error('bad token');
  },
  async userToken(t) {
    if (t === 'cust') return { uid: 'u1', auth_time: 0, role: 'customer', sandboxId: 'sandbox-1' };
    if (t === 'noclaims') return { uid: 'u2', auth_time: 0 };
    throw new Error('bad token');
  },
};

describe('GET /v1/health/secure', () => {
  const app = createApp(baseEnv, v);

  it('accepts an allowlisted service account', async () => {
    const r = await request(app).get('/v1/health/secure').set('authorization', 'Bearer web');
    expect(r.status).toBe(200);
    expect(r.body.caller).toEqual({ kind: 'service', email: 'sa-web@p.iam.gserviceaccount.com' });
  });

  it('rejects missing, invalid and non-allowlisted tokens', async () => {
    expect((await request(app).get('/v1/health/secure')).status).toBe(401);
    expect((await request(app).get('/v1/health/secure').set('authorization', 'Bearer junk')).status).toBe(401);
    expect((await request(app).get('/v1/health/secure').set('authorization', 'Bearer other')).status).toBe(401);
  });

  it('allows the dev bypass only outside production', async () => {
    const dev = createApp({ ...baseEnv, S2S_DEV_INSECURE: true }, v);
    expect((await request(dev).get('/v1/health/secure')).body.caller.kind).toBe('dev-insecure');
    const prod = createApp({ ...baseEnv, NODE_ENV: 'production', S2S_DEV_INSECURE: true }, v);
    expect((await request(prod).get('/v1/health/secure')).status).toBe(401);
  });
});

describe('GET /v1/me', () => {
  const app = createApp(baseEnv, v);

  it('returns claims for a valid Firebase token and rejects tokens without claims', async () => {
    const ok = await request(app).get('/v1/me').set('x-user-token', 'cust');
    expect(ok.body).toMatchObject({ role: 'customer', sandboxId: 'sandbox-1' });
    expect((await request(app).get('/v1/me').set('x-user-token', 'noclaims')).status).toBe(401);
    expect((await request(app).get('/v1/me')).status).toBe(401);
  });
});
