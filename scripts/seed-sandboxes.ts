// Seeds the fictional bank (directory, verified registry, sandbox-1..3) into FIRESTORE_DATABASE_ID. Idempotent: each sandbox is wiped and reseeded.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { parseEnv } from '@matta/core';
import { firestoreStore } from '../apps/demo-bank/src/store';
import { SANDBOXES, seedDirectory, seedSandbox } from '../apps/demo-bank/src/seed';

const env = parseEnv(z.object({ GOOGLE_CLOUD_PROJECT: z.string().min(1), FIRESTORE_DATABASE_ID: z.string().min(1) }));
const store = firestoreStore(getFirestore(initializeApp({ projectId: env.GOOGLE_CLOUD_PROJECT }), env.FIRESTORE_DATABASE_ID));

await seedDirectory(store);
for (const sid of SANDBOXES) {
  await seedSandbox(store, sid);
  console.log(`seeded ${sid}`);
}
console.log(`bank database: ${env.FIRESTORE_DATABASE_ID}`);
