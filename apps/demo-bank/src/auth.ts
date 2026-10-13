import type { RequestHandler } from 'express';
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

/** W: Google ID token from an allowlisted service account (sa-web) in `Authorization`. */
export function requireService(env: BankEnv, v: Verifiers): RequestHandler {
  return async (req, res, next) => {
    const token = bearer(req.header('authorization'));
    if (!token && s2sBypassAllowed(env.NODE_ENV, env.S2S_DEV_INSECURE)) {
      req.service = { kind: 'dev-insecure', email: 'dev-insecure@local' };
      return next();
    }
    try {
      if (!token) throw new Error('missing service token');
      const { email, emailVerified } = await v.serviceToken(token);
      if (!emailVerified || !env.S2S_ALLOWED_SA.includes(email)) throw new Error(`caller not allowlisted: ${email}`);
      req.service = { kind: 'service', email };
      next();
    } catch (e) {
      log('WARNING', 'service auth rejected', { path: req.path, reason: String(e) });
      res.status(401).json({ error: 'service_auth_required' });
    }
  };
}

/** C / K / O: Firebase ID token in `X-User-Token`, with role (and sandbox) from custom claims. */
export function requireUser(v: Verifiers, roles: Role[]): RequestHandler {
  return async (req, res, next) => {
    const token = req.header('x-user-token');
    try {
      if (!token) throw new Error('missing user token');
      const decoded = await v.userToken(token);
      const claims = UserClaims.parse(decoded);
      if (!roles.includes(claims.role)) {
        log('WARNING', 'user role rejected', { path: req.path, uid: decoded.uid, role: claims.role });
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      req.user = { uid: decoded.uid, email: decoded.email, authTime: decoded.auth_time, ...claims };
      next();
    } catch (e) {
      log('WARNING', 'user auth rejected', { path: req.path, reason: String(e) });
      res.status(401).json({ error: 'user_auth_required' });
    }
  };
}
