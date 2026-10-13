import { z } from 'zod';
import { envFlag, parseEnv } from '@matta/core';

const BankEnv = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(8081),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  FIRESTORE_DATABASE_ID: z.string().min(1),
  BANK_URL: z.url(),
  WEB_URL: z.url(),
  /** Comma-separated service-account emails allowed to call W-auth routes (sa-web). */
  S2S_ALLOWED_SA: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  S2S_DEV_INSECURE: envFlag,
  TASKS_MODE: z.enum(['inline', 'cloud']).default('inline'),
  DEMO_MODE: envFlag,
});
export type BankEnv = z.infer<typeof BankEnv>;

export const loadEnv = () => parseEnv(BankEnv);
