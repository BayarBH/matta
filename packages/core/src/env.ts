import { z } from 'zod';

/** "true"/"false" env flag; anything else is a validation error. */
export const envFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Model IDs must never be Gemini 2.5 (retires inside the judging window). */
export const modelId = z
  .string()
  .min(1)
  .refine((m) => !/2\.5/.test(m), 'Gemini 2.5 models are not allowed');

export function parseEnv<T extends z.ZodType>(schema: T, source: Record<string, string | undefined> = process.env): z.infer<T> {
  const r = schema.safeParse(source);
  if (!r.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(r.error)}`);
  }
  return r.data;
}

/** The dev-only S2S bypass. Refused in production regardless of the flag. */
export function s2sBypassAllowed(nodeEnv: string | undefined, flag: boolean): boolean {
  return nodeEnv !== 'production' && flag;
}
