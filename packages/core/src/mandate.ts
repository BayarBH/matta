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

type Cmp = -1 | 0 | 1; // -1 looser, 0 equal, 1 stricter
const lowerStricter = (a: number, b: number): Cmp => (b === a ? 0 : b < a ? 1 : -1);
const higherStricter = (a: number, b: number): Cmp => (b === a ? 0 : b > a ? 1 : -1);

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Minutes of the day [0,1440) inside a (possibly midnight-wrapping) window; null or start==end → empty. */
export function quietMinutes(q: MandateTerms['holds']['quietHours']): Set<number> {
  const s = new Set<number>();
  if (!q) return s;
  const start = toMin(q.start);
  const end = toMin(q.end);
  for (let m = start; m !== end; m = (m + 1) % 1440) s.add(m);
  return s;
}

function cmpQuiet(a: MandateTerms['holds']['quietHours'], b: MandateTerms['holds']['quietHours']): Cmp {
  const A = quietMinutes(a);
  const B = quietMinutes(b);
  const bHasAllA = [...A].every((m) => B.has(m));
  if (bHasAllA) return B.size === A.size ? 0 : 1;
  return -1; // some quiet minutes removed → looser (even if others were added)
}

const contactKey = (cs: Contact[]) =>
  cs
    .map((c) => JSON.stringify([c.uid, c.displayName, c.relation]))
    .sort()
    .join('|');

/**
 * SPEC §4 classifier. Tightening only if every field is equal or stricter AND contacts are unchanged.
 * Everything else (mixed changes, any contact change) is loosening.
 */
export function classifyChange(from: MandateTerms, to: MandateTerms): ChangeClass {
  const fields: Array<[string, Cmp]> = [
    ['everyday.registeredPayeeAutoMaxJpy', lowerStricter(from.everyday.registeredPayeeAutoMaxJpy, to.everyday.registeredPayeeAutoMaxJpy)],
    ['everyday.newPayeeAutoMaxJpy', lowerStricter(from.everyday.newPayeeAutoMaxJpy, to.everyday.newPayeeAutoMaxJpy)],
    ['everyday.dailyAutoTotalMaxJpy', lowerStricter(from.everyday.dailyAutoTotalMaxJpy, to.everyday.dailyAutoTotalMaxJpy)],
    ['contactRequired.newPayeeOverJpy', lowerStricter(from.contactRequired.newPayeeOverJpy, to.contactRequired.newPayeeOverJpy)],
    ['holds.holdHours', higherStricter(from.holds.holdHours, to.holds.holdHours)],
    ['holds.verifiedPayeeHoldHours', higherStricter(from.holds.verifiedPayeeHoldHours, to.holds.verifiedPayeeHoldHours)],
    ['holds.quietHours', cmpQuiet(from.holds.quietHours, to.holds.quietHours)],
    // Shorter window → branch review sooner (never a release) → stricter.
    ['holds.contactDecisionWindowHours', lowerStricter(from.holds.contactDecisionWindowHours, to.holds.contactDecisionWindowHours)],
    ['changes.loosenCoolingOffHours', higherStricter(from.changes.loosenCoolingOffHours, to.changes.loosenCoolingOffHours)],
    [
      'changes.contactMayCosignLoosening',
      from.changes.contactMayCosignLoosening === to.changes.contactMayCosignLoosening ? 0 : to.changes.contactMayCosignLoosening ? -1 : 1,
    ],
    ['contacts', contactKey(from.contacts) === contactKey(to.contacts) ? 0 : -1],
  ];
  const loosened = fields.filter(([, c]) => c === -1).map(([f]) => f);
  const tightened = fields.filter(([, c]) => c === 1).map(([f]) => f);
  const kind = loosened.length ? 'loosen' : tightened.length ? 'tighten' : 'noop';
  return { kind, loosened, tightened };
}

/** 「100万円」「5万円」 for whole man-yen, else 「12,345円」. */
export function formatJpyJa(n: number): string {
  if (n >= 10_000 && n % 10_000 === 0) return `${(n / 10_000).toLocaleString('ja-JP')}万円`;
  return `${n.toLocaleString('ja-JP')}円`;
}

/** Plain-Japanese text of one rule in the customer's own numbers, e.g. 「新しい振込先への100万円超は見守り人の承認が必要」. */
export function ruleTextJa(ruleId: RuleId, terms: MandateTerms): string {
  const { everyday, contactRequired, holds, changes } = terms;
  const quiet = holds.quietHours ? `（${holds.quietHours.start}〜${holds.quietHours.end}を除く）` : '';
  switch (ruleId) {
    case 'R-READER-HIGH':
      return '受取人名やメモに注意が必要な語がある振込は、見守り人の承認が必要';
    case 'R-CONTACT-LARGE-NEW':
      return `新しい振込先への${formatJpyJa(contactRequired.newPayeeOverJpy)}超の振込は、見守り人の承認が必要`;
    case 'R-EVERYDAY-REG':
      return `登録済みの振込先へは${formatJpyJa(everyday.registeredPayeeAutoMaxJpy)}まで、1日の合計${formatJpyJa(everyday.dailyAutoTotalMaxJpy)}まではすぐに振り込む`;
    case 'R-EVERYDAY-NEW':
      return `新しい振込先へは${formatJpyJa(everyday.newPayeeAutoMaxJpy)}まで${quiet}すぐに振り込む`;
    case 'R-LOOSEN-OPEN':
      return `ルールをゆるめる申請から${changes.loosenCoolingOffHours}時間は、日常の範囲外の振込に見守り人の承認が必要`;
    case 'R-HOLD-VERIFIED':
      return `銀行が確認済みの振込先は${holds.verifiedPayeeHoldHours}時間保留する`;
    case 'R-HOLD-DEFAULT':
      return `それ以外の振込は${holds.holdHours}時間保留する`;
  }
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
