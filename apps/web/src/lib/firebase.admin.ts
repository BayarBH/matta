import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { UserClaims } from '@matta/core';
import { env } from './env.server';

/** firebase-admin with Application Default Credentials. Server only. */
function adminApp() {
  return getApps()[0] ?? initializeApp({ projectId: env().GOOGLE_CLOUD_PROJECT });
}

export const db = () => getFirestore(adminApp(), env().FIRESTORE_DATABASE_ID);

export type RequestUser = { uid: string; email: string | undefined; token: string } & UserClaims;

/** Verifies `Authorization: Bearer <Firebase ID token>`; null when missing or invalid. */
export async function verifyRequestUser(req: Request): Promise<RequestUser | null> {
  const h = req.headers.get('authorization');
  const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  if (!token) return null;
  try {
    const decoded = await getAuth(adminApp()).verifyIdToken(token, true);
    return { uid: decoded.uid, email: decoded.email, token, ...UserClaims.parse(decoded) };
  } catch {
    return null;
  }
}
