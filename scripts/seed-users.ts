// Creates or updates the seven demo users and their custom claims. Idempotent.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { UserClaims, parseEnv } from '@matta/core';

const env = parseEnv(
  z.object({
    GOOGLE_CLOUD_PROJECT: z.string().min(1),
    SEED_PASSWORD_CUSTOMER: z.string().min(8),
    SEED_PASSWORD_CONTACT: z.string().min(8),
    SEED_PASSWORD_OPERATOR: z.string().min(8),
  }),
);

const auth = getAuth(initializeApp({ projectId: env.GOOGLE_CLOUD_PROJECT }));

type Seed = { uid: string; displayName: string; password: string; claims: UserClaims };
const seeds: Seed[] = [
  ...[1, 2, 3].flatMap((n): Seed[] => [
    { uid: `customer-${n}`, displayName: '山田 花子（デモ）', password: env.SEED_PASSWORD_CUSTOMER, claims: { role: 'customer', sandboxId: `sandbox-${n}` } },
    { uid: `contact-${n}`, displayName: '山田 美咲（姉・デモ）', password: env.SEED_PASSWORD_CONTACT, claims: { role: 'contact', sandboxId: `sandbox-${n}` } },
  ]),
  { uid: 'operator', displayName: 'デモ運営', password: env.SEED_PASSWORD_OPERATOR, claims: { role: 'operator', sandboxId: null } },
];

const rows = [];
for (const s of seeds) {
  const claims = UserClaims.parse(s.claims);
  const email = `${s.uid}@matta-demo.example`;
  let uid: string;
  let action: string;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
    await auth.updateUser(uid, { password: s.password, displayName: s.displayName, emailVerified: true, disabled: false });
    action = 'updated';
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    uid = (await auth.createUser({ uid: s.uid, email, password: s.password, displayName: s.displayName, emailVerified: true })).uid;
    action = 'created';
  }
  await auth.setCustomUserClaims(uid, { role: claims.role, sandboxId: claims.sandboxId ?? null });
  rows.push({ email, uid, role: claims.role, sandboxId: claims.sandboxId ?? '-', action });
}
console.table(rows);
