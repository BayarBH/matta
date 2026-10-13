import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { env } from '../env.server';
import { log } from '../log';

const IdTokenReply = z.object({ idToken: z.string() });

async function identityToolkit(method: string, body: object): Promise<string> {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY missing');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`identitytoolkit ${method} -> ${res.status}`);
  return IdTokenReply.parse(await res.json()).idToken;
}

/**
 * A fresh Firebase ID token for a demo identity of the caller's own sandbox (autopilot, DEMO_MODE only).
 * Cloud: custom token signed by sa-web (Token Creator on itself), exchanged via signInWithCustomToken.
 * Local dev: user ADC can't sign custom tokens, so fall back to the seed password (never in production).
 */
export async function autopilotIdToken(uid: string): Promise<string> {
  if (!env().DEMO_MODE) throw new Error('autopilot identities exist only in DEMO_MODE');
  const app = getApps()[0] ?? initializeApp({ projectId: env().GOOGLE_CLOUD_PROJECT });
  try {
    const custom = await getAuth(app).createCustomToken(uid);
    return await identityToolkit('signInWithCustomToken', { token: custom });
  } catch (e) {
    if (env().NODE_ENV === 'production') throw e;
    const role = uid.split('-')[0]!.toUpperCase();
    const password = process.env[`SEED_PASSWORD_${role}`];
    if (!password) throw new Error(`custom token failed (${String(e).slice(0, 120)}) and SEED_PASSWORD_${role} is not set for the dev fallback`);
    log('WARNING', 'autopilot: custom token unavailable locally, using dev password fallback', { uid });
    return identityToolkit('signInWithPassword', { email: `${uid}@matta-demo.example`, password });
  }
}
