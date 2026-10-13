import { z } from 'zod';

export const Role = z.enum(['customer', 'contact', 'operator']);
export type Role = z.infer<typeof Role>;

export const SandboxId = z.string().regex(/^sandbox-\d+$/);

/** Firebase custom claims set by scripts/seed-users.ts. Operators have no sandbox. */
export const UserClaims = z.discriminatedUnion('role', [
  z.object({ role: z.literal('customer'), sandboxId: SandboxId }),
  z.object({ role: z.literal('contact'), sandboxId: SandboxId }),
  z.object({ role: z.literal('operator'), sandboxId: z.null().optional() }),
]);
export type UserClaims = z.infer<typeof UserClaims>;

export const ReasonCode = z.enum([
  'authority_claim',
  'secrecy_requested',
  'safe_account',
  'disable_protection_request',
  'on_call_with_instructor',
  'guaranteed_returns',
  'payee_name_flag',
  'guardian_unavailable',
  'urgency',
  'crypto_or_gold',
  'coached_answers',
  'inconsistent_story',
  'instructions_to_ai',
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const AuditEvent = z.object({
  id: z.string(),
  ts: z.string(),
  simTs: z.string().optional(),
  sandboxId: z.string().nullable(),
  service: z.enum(['web', 'bank']),
  actor: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  ruleId: z.string().optional(),
  mandateHash: z.string().optional(),
  policyHash: z.string().optional(),
  model: z.string().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  estCostJpy: z.number().optional(),
  latencyMs: z.number().optional(),
  outcome: z.enum(['ok', 'rejected', 'error', 'pending']),
  detailsJa: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/** Response of bank GET /v1/health/secure. */
export const SecureHealth = z.object({
  ok: z.literal(true),
  caller: z.object({ kind: z.enum(['service', 'dev-insecure']), email: z.string() }),
});
export type SecureHealth = z.infer<typeof SecureHealth>;
