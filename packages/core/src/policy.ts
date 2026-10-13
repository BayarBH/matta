import { z } from 'zod';
import { ReasonCode } from './schemas';

/** Shape of policy/system-policy.yaml (SPEC §6). */
export const SystemPolicy = z.object({
  version: z.number().int(),
  reason_codes: z.record(ReasonCode, z.object({ severity: z.enum(['high', 'elevated']), ja: z.string() })),
  escalation: z.object({ any_high: z.boolean(), elevated_count_at_least: z.number().int().positive() }),
  guardian: z.object({
    max_turns: z.number().int().positive(),
    model_timeout_ms: z.number().int().positive(),
    pause_if_error_rate_over: z.number().min(0).max(1),
  }),
  message_guard: z.object({
    max_chars: z.number().int().positive(),
    forbidden: z.array(z.string()),
    phone_allowlist: z.array(z.string()),
  }),
  limits: z.object({
    guardian_messages_per_transfer: z.number().int().positive(),
    contact_notices_per_hour: z.number().int().positive(),
  }),
});
export type SystemPolicy = z.infer<typeof SystemPolicy>;
