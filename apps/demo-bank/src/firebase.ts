import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { BankEnv } from './env';

/** firebase-admin with Application Default Credentials. */
export function initFirebase(env: BankEnv) {
  const app = getApps()[0] ?? initializeApp({ projectId: env.GOOGLE_CLOUD_PROJECT });
  return { auth: getAuth(app), db: getFirestore(app, env.FIRESTORE_DATABASE_ID) };
}
