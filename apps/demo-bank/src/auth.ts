import type { Request, RequestHandler } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { Auth } from 'firebase-admin/auth';
import { UserClaims, s2sBypassAllowed, type Role } from '@matta/core';
import type { BankEnv } from './env';
import { log } from './log';

export type ServiceCaller = { kind: 'service' | 'dev-insecure'; email: string };
export type UserCaller = { uid: string; email: string | undefined; authTime: number } & UserClaims;

export type Verifiers = {
  /** Returns the verified service-account email of a Google ID token, or throws. */
  serviceToken: (token: string) => Promise<{ email: string; emailVerified: boolean }>;
  /** Verifies a Firebase ID token (including revocation), or throws. */
  userToken: (token: string) => Promise<{ uid: string; email?: string; auth_time: number; [k: string]: unknown }>;
};

/** Called on every rejected auth attempt (audited by the app). */
export type OnReject = (req: Request, status: 401 | 403, reason: string) => void;

export function realVerifiers(env: BankEnv, auth: Auth): Verifiers {
  const oauth = new OAuth2Client();
  return {
    async serviceToken(token) {
      const ticket = await oauth.verifyIdToken({ idToken: token, audience: env.BANK_URL });
      const p = ticket.getPayload();
      if (!p?.email) throw new Error('no email in token');
      return { email: p.email, emailVerified: p.email_verified === true };
    },
    userToken: (token) => auth.verifyIdToken(token, true),
  };
}

const bearer = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7) : undefined);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      service?: ServiceCaller;
      user?: UserCaller;
    }
  }
}

/** Verifies the Google ID token in `Authorization` against an allowlist; throws on failure. */
export async function checkService(env: BankEnv, v: Verifiers, req: Request, allow: string[]): Promise<ServiceCaller> {
  const token = bearer(req.header('authorization'));
  if (!token && s2sBypassAllowed(env.NODE_ENV, env.S2S_DEV_INSECURE)) return { kind: 'dev-insecure', email: 'dev-insecure@local' };
  if (!token) throw new Error('missing service token');
  const { email, emailVerified } = await v.serviceToken(token);
  if (!emailVerified || !allow.includes(email)) throw new Error(`caller not allowlisted: ${email}`);
  return { kind: 'service', email };
}

/** W (sa-web) by default; T (Cloud Tasks, sa-bank) with `allow = env.TASKS_ALLOWED_SA`. */
export function requireService(env: BankEnv, v: Verifiers, onReject: OnReject, allow = env.S2S_ALLOWED_SA): RequestHandler {
  return async (req, res, next) => {
    try {
      req.service = await checkService(env, v, req, allow);
      next();
    } catch (e) {
      log('WARNING', 'service auth rejected', { path: req.path, reason: String(e) });
      onReject(req, 401, String(e));
      res.status(401).json({ error: 'service_auth_required' });
    }
  };
}

/** C / K / O: Firebase ID token in `X-User-Token`, with role (and sandbox) from custom claims. */
export function requireUser(v: Verifiers, roles: Role[], onReject: OnReject): RequestHandler {
  return async (req, res, next) => {
    const token = req.header('x-user-token');
    let decoded: Awaited<ReturnType<Verifiers['userToken']>>;
    let claims: UserClaims;
    try {
      if (!token) throw new Error('missing user token');
      decoded = await v.userToken(token);
      claims = UserClaims.parse(decoded);
    } catch (e) {
      log('WARNING', 'user auth rejected', { path: req.path, reason: String(e) });
      onReject(req, 401, String(e));
      res.status(401).json({ error: 'user_auth_required' });
      return;
    }
    req.user = { uid: decoded.uid, email: decoded.email, authTime: decoded.auth_time, ...claims };
    if (!roles.includes(claims.role)) {
      log('WARNING', 'user role rejected', { path: req.path, uid: decoded.uid, role: claims.role });
      onReject(req, 403, `role ${claims.role} not allowed`);
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
