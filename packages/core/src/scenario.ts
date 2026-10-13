import { z } from 'zod';
import { AccountRef } from './api';
import { Contact } from './mandate';
import { TransferStatus } from './evaluate';

/** Red-team / legit scenario files in scenarios/{A,B}/*.json (SPEC §10). Never published. */

export const Trigger = z.enum([
  'start',
  'payee_looked_up',
  'transfer_held',
  'transfer_contact_required',
  'guardian_message',
  'clock_advanced',
  'mandate_change_pending',
  'transfer_cancelled',
]);
export type Trigger = z.infer<typeof Trigger>;

const TextJa = z.string().trim().min(1).max(200);

export const VictimStep = z.discriminatedUnion('action', [
  z.object({ action: z.literal('lookup_payee'), args: AccountRef }),
  z.object({
    action: z.literal('submit_transfer'),
    args: AccountRef.extend({ amountJpy: z.number().int().positive(), memo: z.string().max(40).optional() }),
  }),
  z.object({ action: z.literal('answer_guardian'), args: z.object({ textJa: TextJa }) }),
  z.object({
    action: z.literal('request_mandate_change'),
    args: z
      .object({
        /** Dotted MandateTerms path → new value, applied to the active terms. */
        patch: z.record(z.string().regex(/^[a-zA-Z]+(\.[a-zA-Z]+)*$/), z.union([z.number(), z.boolean(), z.null()])).default({}),
        contactsAdd: z.array(Contact).default([]),
      })
      .refine((a) => Object.keys(a.patch).length > 0 || a.contactsAdd.length > 0, 'empty mandate change'),
  }),
  z.object({ action: z.literal('request_early_approval'), args: z.object({}).default({}) }),
  z.object({ action: z.literal('cancel'), args: z.object({}).default({}) }),
  z.object({ action: z.literal('advance_clock'), args: z.object({ hours: z.union([z.literal(1), z.literal(24), z.literal(72)]) }) }),
  z.object({ action: z.literal('wait'), args: z.object({ seconds: z.number().int().min(1).max(30) }) }),
]);
export type VictimStep = z.infer<typeof VictimStep>;

export const ContactStep = z.object({
  after: Trigger,
  decision: z.enum(['approve', 'deny']),
  reasonJa: TextJa,
  /** What the contact decides on; default the scenario's transfer. Mandate changes use cosign/deny. */
  target: z.enum(['transfer', 'mandate_change']).default('transfer'),
});
export type ContactStep = z.infer<typeof ContactStep>;

export const Scenario = z.object({
  id: z.string().regex(/^[A-Z]\d+[a-z]?(-[a-z0-9]+)?$/),
  set: z.enum(['A', 'B']),
  kind: z.enum(['scam', 'legit']),
  titleJa: TextJa,
  caller: z.object({ nameJa: TextJa, lines: z.array(z.object({ trigger: Trigger, textJa: TextJa })).min(1) }).optional(),
  victim: z.array(VictimStep).min(1),
  contact: z.array(ContactStep).default([]),
  expected: z.object({
    noMoneyOutWithoutContact: z.boolean().optional(),
    finalStatus: TransferStatus.optional(),
    mustEscalate: z.boolean().optional(),
    maxAddedDelayMin: z.number().nonnegative().optional(),
    mandateChangeStatus: z.enum(['pending', 'applied', 'rejected', 'withdrawn']).optional(),
  }),
});
export type Scenario = z.infer<typeof Scenario>;

/** Real organisations that must never appear (rule 11). Generic 「警察」 is fine; named forces only as 青嶺県警察（架空）. */
const DENY = [/警視庁/, /警察庁/, /金融庁/, /三菱|三井住友|みずほ|りそな|ゆうちょ|楽天銀行|PayPay/, /国税庁|税務署/];
const NAMED_FORCE = /([一-龯]{1,3})[都道府県]警/g;
/** Realistic Japanese phone numbers (0X-XXXX-XXXX, 0120-, 090…). 「＋国際番号（架空）」 and #9110 are fine. */
const PHONE = /(?<![\d#])0\d{1,4}[-‐ー−]?\d{1,4}[-‐ー−]?\d{3,4}(?!\d)|\+\d{1,3}[\d -]{6,}/;

/** Content rules on every text in a scenario; returns problems (empty = ok). */
export function scenarioContentProblems(s: Scenario): string[] {
  const texts: Array<[string, string]> = [['titleJa', s.titleJa]];
  if (s.caller) {
    texts.push(['caller.nameJa', s.caller.nameJa]);
    s.caller.lines.forEach((l, i) => texts.push([`caller.lines[${i}]`, l.textJa]));
  }
  s.victim.forEach((v, i) => v.action === 'answer_guardian' && texts.push([`victim[${i}]`, v.args.textJa]));
  s.contact.forEach((c, i) => texts.push([`contact[${i}]`, c.reasonJa]));
  const problems: string[] = [];
  for (const [where, t] of texts) {
    for (const d of DENY) if (d.test(t)) problems.push(`${where}: real organisation name (${d.source})`);
    for (const m of t.matchAll(NAMED_FORCE)) if (!m[1]!.endsWith('青嶺')) problems.push(`${where}: named police force ${m[0]}`);
    if (PHONE.test(t)) problems.push(`${where}: realistic phone number`);
  }
  return problems;
}
