import express from 'express';
import type { SecureHealth } from '@matta/core';
import type { BankEnv } from './env';
import { requireService, requireUser, type Verifiers } from './auth';
import { log } from './log';

export function createApp(env: BankEnv, v: Verifiers) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/v1/health/secure', requireService(env, v), (req, res) => {
    log('INFO', 'secure health verified', { caller: req.service });
    const body: SecureHealth = { ok: true, caller: req.service! };
    res.json(body);
  });

  app.get('/v1/me', requireUser(v, ['customer', 'contact', 'operator']), (req, res) => {
    const { uid, email, role, sandboxId } = req.user!;
    res.json({ uid, email, role, sandboxId: sandboxId ?? null });
  });

  return app;
}
