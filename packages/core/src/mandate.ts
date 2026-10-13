import { z } from 'zod';

const Jpy = z.number().int().nonnegative();
const Hours = z.number().int().positive();
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Contact = z.object({ uid: z.string().min(1), displayName: z.string().min(1), relation: z.string().min(1) });
export type Contact = z.infer<typeof Contact>;

/** The rules themselves — what a customer signs and what a change proposes. */
export const MandateTerms = z.object({
  everyday: z.object({
    registeredPayeeAutoMaxJpy: Jpy,
    newPayeeAutoMaxJpy: Jpy,
    dailyAutoTotalMaxJpy: Jpy,
  }),
  contactRequired: z.object({ newPayeeOverJpy: Jpy }),
  holds: z.object({
    holdHours: Hours,
    verifiedPayeeHoldHours: Hours,
    /** JST wall-clock window; null = no quiet hours (loosest). */
    quietHours: z.object({ start: HHMM, end: HHMM }).nullable(),
    contactDecisionWindowHours: Hours,
  }),
  contacts: z.array(Contact).min(1),
  changes: z.object({ loosenCoolingOffHours: Hours, contactMayCosignLoosening: z.boolean() }),
});
export type MandateTerms = z.infer<typeof MandateTerms>;

/** An immutable signed version stored in the bank. */
export const Mandate = MandateTerms.extend({
  version: z.number().int().positive(),
  signedAt: z.string(),
  signedBy: z.string(),
  hash: z.string(),
});
export type Mandate = z.infer<typeof Mandate>;

/** SPEC §4 defaults. */
export function defaultTerms(contact: Contact): MandateTerms {
  return {
    everyday: { registeredPayeeAutoMaxJpy: 300_000, newPayeeAutoMaxJpy: 50_000, dailyAutoTotalMaxJpy: 500_000 },
    contactRequired: { newPayeeOverJpy: 1_000_000 },
    holds: { holdHours: 24, verifiedPayeeHoldHours: 1, quietHours: { start: '22:00', end: '06:00' }, contactDecisionWindowHours: 72 },
    contacts: [contact],
    changes: { loosenCoolingOffHours: 72, contactMayCosignLoosening: true },
  };
}

export type ChangeClass = {
  kind: 'tighten' | 'loosen' | 'noop';
  /** Dotted field paths that got looser (or 'contacts'); empty for tighten/noop. */
  loosened: string[];
  tightened: string[];
};

/**
 * SPEC §4 classifier. Tightening only if every field is equal or stricter AND contacts are unchanged.
 * Everything else (mixed changes, any contact change) is loosening.
 * Implemented in Phase 1 by the core task.
 */
export function classifyChange(_from: MandateTerms, _to: MandateTerms): ChangeClass {
  throw new Error('not implemented');
}

/** Plain-Japanese text of one rule in the customer's own numbers, e.g. 「新しい振込先への100万円超は見守り人の承認が必要」. */
export function ruleTextJa(_ruleId: RuleId, _terms: MandateTerms): string {
  throw new Error('not implemented');
}

export const RuleId = z.enum([
  'R-READER-HIGH',
  'R-CONTACT-LARGE-NEW',
  'R-EVERYDAY-REG',
  'R-EVERYDAY-NEW',
  'R-LOOSEN-OPEN',
  'R-HOLD-VERIFIED',
  'R-HOLD-DEFAULT',
]);
export type RuleId = z.infer<typeof RuleId>;
