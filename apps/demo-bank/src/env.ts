import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { envFlag, parseEnv } from '@matta/core';

const emailList = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const BankEnv = z
  .object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().default(8081),
    GOOGLE_CLOUD_PROJECT: z.string().min(1),
    FIRESTORE_DATABASE_ID: z.string().min(1),
    BANK_URL: z.url(),
    WEB_URL: z.url(),
    /** Service accounts allowed on W routes (sa-web). */
    S2S_ALLOWED_SA: emailList,
    S2S_DEV_INSECURE: envFlag,
    TASKS_MODE: z.enum(['inline', 'cloud']).default('inline'),
    /** projects/<p>/locations/<l>/queues/hold-evaluation (cloud mode). */
    TASKS_QUEUE: z.string().optional(),
    /** Service account Cloud Tasks signs OIDC tokens as (sa-bank). */
    TASKS_SA_EMAIL: z.string().optional(),
    /** Service accounts allowed on T routes (/internal/*). */
    TASKS_ALLOWED_SA: emailList,
    DEMO_MODE: envFlag,
    POLICY_PATH: z.string().default(fileURLToPath(new URL('../../../policy/system-policy.yaml', import.meta.url))),
  })
  .refine((e) => e.TASKS_MODE !== 'cloud' || (e.TASKS_QUEUE && e.TASKS_SA_EMAIL), 'TASKS_MODE=cloud needs TASKS_QUEUE and TASKS_SA_EMAIL');
export type BankEnv = z.infer<typeof BankEnv>;

export const loadEnv = () => parseEnv(BankEnv);
