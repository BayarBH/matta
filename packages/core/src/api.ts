import { z } from 'zod';
import { ReasonCode } from './schemas';
import { Flag, PayeeKind, TransferStatus } from './evaluate';
import { Mandate, MandateTerms, RuleId } from './mandate';

/**
 * Bank wire shapes shared by demo-bank and web. Every body/response is parsed with these.
 *
 * Routes (auth: W = sa-web Google ID token in Authorization, C/K/O = Firebase ID token in X-User-Token).
 * W+C routes are called by the web server only; C/K-only routes are called by the browser directly
 * (CORS: WEB_URL only). The web never proxies cancel/decision/mandate routes (governance rule 1).
 *   GET  /v1/me                                   C|K|O  → MeResult
 *   POST /v1/directory/lookup                     W+C    LookupBody → LookupResult
 *   POST /v1/transfers                            W+C    CreateTransferBody → Transfer
 *   GET  /v1/transfers                            C      → { transfers: Transfer[] } (own sandbox, newest first)
 *   GET  /v1/transfers/:id                        W+C | K (ContactTransferView) | O → Transfer
 *   POST /v1/transfers/:id/escalate               W      EscalateBody → Transfer (held → contact_required only)
 *   POST /v1/transfers/:id/request-early-approval C      → Transfer
 *   POST /v1/transfers/:id/cancel                 C      → Transfer
 *   POST /v1/transfers/:id/contact-decision       K      ContactDecisionBody → ContactTransferView
 *   GET  /v1/contact/inbox                        K      → ContactInbox
 *   GET  /v1/mandate                              C|K|O(?sandboxId=) → MandateView
 *   POST /v1/mandate/changes                      C (auth_time ≤ 5 min, else 401 {error:'reauth_required'}) MandateChangeBody → MandateChange
 *   POST /v1/mandate/changes/:id/contact-decision K      MandateChangeDecisionBody → MandateChange
 *   POST /v1/mandate/changes/:id/withdraw         C      → MandateChange
 *   GET  /v1/audit?transferId=                    C (own sandbox) | O → { events: AuditEvent[] }
 *   POST /internal/holds/evaluate                 T (Cloud Tasks OIDC, sa-bank) {sandboxId?} → { settled, branchReview, applied }
 *   POST /demo/sandboxes/:sid/reset               O | C of sid; DEMO_MODE → { ok }
 *   POST /demo/sandboxes/:sid/clock               O | C of sid; DEMO_MODE  ClockBody → { now }
 */

export const AccountRef = z.object({
  bankCode: z.string().regex(/^\d{4}$/),
  branchCode: z.string().regex(/^\d{3}$/),
  accountNumber: z.string().regex(/^\d{7}$/),
});
export type AccountRef = z.infer<typeof AccountRef>;

export const LookupBody = AccountRef;
export const LookupResult = z.object({
  found: z.boolean(),
  holderNameKana: z.string().optional(),
  payeeKind: PayeeKind.optional(),
  /** Registered payees have a nickname, e.g. 「アオネ不動産管理（架空）」. */
  displayName: z.string().optional(),
});
export type LookupResult = z.infer<typeof LookupResult>;

export const CreateTransferBody = AccountRef.extend({
  amountJpy: z.number().int().positive().max(100_000_000),
  memo: z.string().max(40).default(''),
  /** From the web's quarantined reader (Phase 2). Can only add flags. */
  readerFlags: z.array(Flag).default([]),
});
export type CreateTransferBody = z.infer<typeof CreateTransferBody>;

export const ContactDecision = z.object({
  contactUid: z.string(),
  decision: z.enum(['approve', 'deny']),
  reasonJa: z.string().min(1).max(200),
  decidedAt: z.string(),
});

export const Transfer = z.object({
  id: z.string(),
  sandboxId: z.string(),
  customerUid: z.string(),
  amountJpy: z.number().int(),
  payee: AccountRef.extend({ holderNameKana: z.string(), payeeKind: PayeeKind, displayName: z.string().optional() }),
  memo: z.string(),
  status: TransferStatus,
  ruleId: RuleId,
  /** Customer's own rule text that applied. */
  explanationJa: z.string(),
  flags: z.array(Flag),
  holdUntil: z.string().nullable(),
  escalatedAt: z.string().nullable(),
  escalationReasons: z.array(ReasonCode),
  contactRequiredSince: z.string().nullable(),
  earlyApprovalRequestedAt: z.string().nullable(),
  decision: ContactDecision.nullable(),
  /** Sandbox-clock timestamps (ISO). */
  createdAt: z.string(),
  settledAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  mandateVersion: z.number().int(),
  mandateHash: z.string(),
  policyHash: z.string(),
  /** Computed on read by releaseConditionsJa. */
  releaseConditionsJa: z.array(z.string()),
});
export type Transfer = z.infer<typeof Transfer>;

/** Limited view for contacts: no balance, no memo beyond flags' quotes. */
export const ContactTransferView = Transfer.pick({
  id: true,
  amountJpy: true,
  payee: true,
  status: true,
  ruleId: true,
  explanationJa: true,
  flags: true,
  holdUntil: true,
  escalationReasons: true,
  contactRequiredSince: true,
  earlyApprovalRequestedAt: true,
  createdAt: true,
  releaseConditionsJa: true,
});
export type ContactTransferView = z.infer<typeof ContactTransferView>;

export const ContactDecisionBody = z.object({ decision: z.enum(['approve', 'deny']), reasonJa: z.string().trim().min(1).max(200) });

export const EscalateBody = z.object({ reasonCodes: z.array(ReasonCode).min(1) });

export const MandateChangeStatus = z.enum(['applied', 'pending', 'rejected', 'withdrawn']);
export const MandateChange = z.object({
  id: z.string(),
  sandboxId: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  fromVersion: z.number().int(),
  proposed: MandateTerms,
  kind: z.enum(['tighten', 'loosen', 'noop']),
  loosened: z.array(z.string()),
  status: MandateChangeStatus,
  /** Sandbox-clock time a pending loosening applies by itself. */
  effectiveAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  reasonJa: z.string().nullable(),
});
export type MandateChange = z.infer<typeof MandateChange>;

export const MandateChangeBody = z.object({ terms: MandateTerms });
export const MandateChangeDecisionBody = z.object({ decision: z.enum(['cosign', 'deny']), reasonJa: z.string().trim().min(1).max(200) });

export const MandateView = z.object({ active: Mandate, pending: z.array(MandateChange) });
export type MandateView = z.infer<typeof MandateView>;

export const MeResult = z.object({
  uid: z.string(),
  email: z.string().optional(),
  role: z.enum(['customer', 'contact', 'operator']),
  sandboxId: z.string().nullable(),
  displayName: z.string().optional(),
  /** Customers only. */
  balanceJpy: z.number().int().optional(),
  /** Sandbox clock (ISO), when in a sandbox. */
  now: z.string().optional(),
});
export type MeResult = z.infer<typeof MeResult>;

export const ClockBody = z.object({ hours: z.union([z.literal(1), z.literal(24), z.literal(72)]) });

/** GET /v1/contact/inbox — contact's two lists (SPEC §9). */
export const ContactInbox = z.object({ transfers: z.array(ContactTransferView), mandateChanges: z.array(MandateChange) });
export type ContactInbox = z.infer<typeof ContactInbox>;
