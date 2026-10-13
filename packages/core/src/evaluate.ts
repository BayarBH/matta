import { z } from 'zod';
import { ReasonCode } from './schemas';
import type { MandateTerms, RuleId } from './mandate';

export const PayeeKind = z.enum(['registered', 'verified', 'new']);
export type PayeeKind = z.infer<typeof PayeeKind>;

export const Flag = z.object({
  code: ReasonCode,
  severity: z.enum(['high', 'elevated']),
  source: z.enum(['bank_keyword', 'reader']),
  field: z.enum(['payee_name', 'memo']),
  quote: z.string().max(40),
});
export type Flag = z.infer<typeof Flag>;

export type Tier = 'clear' | 'held' | 'contact_required';

export type EvalInput = {
  terms: MandateTerms;
  amountJpy: number;
  payeeKind: PayeeKind;
  /** Sum of today's (JST, sandbox clock) settled transfers by this customer. */
  settledTodayJpy: number;
  /** Sandbox clock. */
  now: Date;
  /** A loosening change was requested in the last 72 h (any status). */
  recentLoosening: boolean;
  flags: Flag[];
};

export type EvalResult = {
  tier: Tier;
  ruleId: RuleId;
  /** Built from the customer's own rule text (ruleTextJa). */
  explanationJa: string;
  /** Set for tier 'held'. */
  holdHours?: number;
};

/** SPEC §5 tiers, first match wins. Implemented in Phase 1 by the core task. */
export function evaluateTransfer(_input: EvalInput): EvalResult {
  throw new Error('not implemented');
}

/** True if `now` (JST wall clock) falls inside the quiet-hours window; windows may wrap midnight. */
export function inQuietHours(_q: MandateTerms['holds']['quietHours'], _now: Date): boolean {
  throw new Error('not implemented');
}

export const TransferStatus = z.enum(['settled', 'held', 'contact_required', 'cancelled', 'branch_review']);
export type TransferStatus = z.infer<typeof TransferStatus>;

/** What release logic needs to know about a transfer. */
export type ReleaseState = {
  status: TransferStatus;
  holdUntil: string | null;
  escalatedAt: string | null;
  contactRequiredSince: string | null;
  createdAt: string;
};

export type ReleaseEvent =
  | { kind: 'clock'; now: Date; loosenedSince: boolean; contactDecisionWindowHours: number }
  | {
      kind: 'contact_approval';
      now: Date;
      decidedAt: Date;
      contactRole: string;
      sameSandbox: boolean;
      listedInActiveMandate: boolean;
    };

export type ReleaseOutcome =
  | { action: 'settle'; why: string }
  | { action: 'to_contact_required'; why: string }
  | { action: 'to_branch_review'; why: string }
  | { action: 'none'; why: string };

/**
 * SPEC §3/§5 release rules. Only the bank calls this. Never returns 'settle' for contact_required
 * on a clock event. Implemented in Phase 1 by the core task.
 */
export function decideRelease(_t: ReleaseState, _e: ReleaseEvent): ReleaseOutcome {
  throw new Error('not implemented');
}

/** Short Japanese lines for <TransferFacts/>: what has to happen before the money leaves. */
export function releaseConditionsJa(_t: ReleaseState & { ruleId: RuleId }): string[] {
  throw new Error('not implemented');
}

/** Deterministic keyword pre-check over the payee holder name (katakana) and memo (SPEC §7). */
export function keywordFlags(_fields: { payeeName: string; memo: string }): Flag[] {
  throw new Error('not implemented');
}
