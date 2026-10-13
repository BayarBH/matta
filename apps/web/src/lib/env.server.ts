import { z } from 'zod';
import { envFlag, modelId, parseEnv } from '@matta/core';

const WebEnv = z.object({
  NODE_ENV: z.string().default('development'),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().default('global'),
  MODEL_FAST: modelId,
  MODEL_SMART: modelId,
  FIRESTORE_DATABASE_ID: z.string().min(1),
  WEB_URL: z.url(),
  BANK_URL: z.url(),
  TASKS_MODE: z.enum(['inline', 'cloud']).default('inline'),
  S2S_DEV_INSECURE: envFlag,
  DEMO_MODE: envFlag,
});
export type WebEnv = z.infer<typeof WebEnv>;

let cached: WebEnv | undefined;
/** Parsed on first use so `next build` runs without env. */
export const env = (): WebEnv => (cached ??= parseEnv(WebEnv));
