import { z } from 'zod';
import { ReasonCode } from './schemas';
import { quietMinutes, ruleTextJa, type MandateTerms, type RuleId } from './mandate';

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

/** SPEC §5 tiers, first match wins. */
export function evaluateTransfer(input: EvalInput): EvalResult {
  const { terms, amountJpy, payeeKind, settledTodayJpy, now, recentLoosening, flags } = input;
  const r = (tier: Tier, ruleId: RuleId, holdHours?: number): EvalResult => ({
    tier,
    ruleId,
    explanationJa: ruleTextJa(ruleId, terms),
    ...(holdHours !== undefined ? { holdHours } : {}),
  });
  const isNew = payeeKind !== 'registered';
  const withinDaily = settledTodayJpy + amountJpy <= terms.everyday.dailyAutoTotalMaxJpy;

  if (flags.some((f) => f.severity === 'high')) return r('contact_required', 'R-READER-HIGH');
  if (isNew && amountJpy > terms.contactRequired.newPayeeOverJpy) return r('contact_required', 'R-CONTACT-LARGE-NEW');

  if (payeeKind === 'registered' && amountJpy <= terms.everyday.registeredPayeeAutoMaxJpy && withinDaily) {
    return r('clear', 'R-EVERYDAY-REG');
  }
  if (
    isNew &&
    amountJpy <= terms.everyday.newPayeeAutoMaxJpy &&
    !inQuietHours(terms.holds.quietHours, now) &&
    withinDaily &&
    flags.length === 0
  ) {
    return r('clear', 'R-EVERYDAY-NEW');
  }

  if (recentLoosening) return r('contact_required', 'R-LOOSEN-OPEN');
  if (payeeKind === 'verified') return r('held', 'R-HOLD-VERIFIED', terms.holds.verifiedPayeeHoldHours);
  return r('held', 'R-HOLD-DEFAULT', terms.holds.holdHours);
}

const JST_MS = 9 * 3600_000;

/** True if `now` (JST wall clock) falls inside the quiet-hours window; windows may wrap midnight. */
export function inQuietHours(q: MandateTerms['holds']['quietHours'], now: Date): boolean {
  const minute = Math.floor((now.getTime() + JST_MS) / 60_000) % 1440;
  return quietMinutes(q).has(minute);
}

/** yyyy/MM/dd HH:mm in JST. */
export function formatJst(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + JST_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
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
 * on a clock event.
 */
export function decideRelease(t: ReleaseState, e: ReleaseEvent): ReleaseOutcome {
  if (e.kind === 'clock') {
    if (t.status === 'held') {
      if (e.loosenedSince) return { action: 'to_contact_required', why: 'loosening requested while held' };
      if (t.escalatedAt) return { action: 'none', why: 'escalated; time alone never releases' };
      if (t.holdUntil && new Date(t.holdUntil).getTime() <= e.now.getTime()) return { action: 'settle', why: 'hold expired' };
      return { action: 'none', why: 'hold not expired' };
    }
    if (t.status === 'contact_required') {
      const since = t.contactRequiredSince ? new Date(t.contactRequiredSince).getTime() : Infinity;
      if (e.now.getTime() >= since + e.contactDecisionWindowHours * 3600_000) {
        return { action: 'to_branch_review', why: 'no contact decision within window' };
      }
      return { action: 'none', why: 'waiting for contact' };
    }
    return { action: 'none', why: `status ${t.status}` };
  }

  if (e.contactRole !== 'contact' || !e.sameSandbox || !e.listedInActiveMandate) return { action: 'none', why: 'unauthorized' };
  if (t.status === 'held') return { action: 'settle', why: 'early contact approval' };
  if (t.status === 'contact_required') {
    const since = t.contactRequiredSince ? new Date(t.contactRequiredSince).getTime() : Infinity;
    if (e.decidedAt.getTime() > since) return { action: 'settle', why: 'contact approved after escalation' };
    return { action: 'none', why: 'approval predates contact_required' };
  }
  return { action: 'none', why: `status ${t.status}` };
}

/** Short Japanese lines for <TransferFacts/>: what has to happen before the money leaves. */
export function releaseConditionsJa(t: ReleaseState & { ruleId: RuleId }): string[] {
  switch (t.status) {
    case 'held':
      if (t.escalatedAt) return ['確認が必要なため、時間の経過だけでは振り込まれません', '見守り人が承認すると振り込まれます'];
      return [
        ...(t.holdUntil ? [`${formatJst(t.holdUntil)}（保留期限）を過ぎると振り込まれます`] : []),
        '見守り人が承認すると、期限前でも振り込まれます',
      ];
    case 'contact_required':
      return ['見守り人の承認が必要です。承認されるまで、お金は口座から出ません。'];
    case 'settled':
      return ['振込済みです'];
    case 'cancelled':
      return ['取り消されました'];
    case 'branch_review':
      return ['窓口での本人確認が必要です'];
  }
}

// Severities mirror policy/system-policy.yaml (a test checks they match).
const SEVERITY = {
  authority_claim: 'high',
  safe_account: 'high',
  payee_name_flag: 'high',
  guaranteed_returns: 'high',
  instructions_to_ai: 'elevated',
  crypto_or_gold: 'elevated',
  urgency: 'elevated',
} as const;
type KeywordCode = keyof typeof SEVERITY;

const NAME_RULES: Array<[RegExp, KeywordCode[]]> = [
  [/ケイサツ|ケンケイ|ケイシチヨウ|キンユウチヨウ|ザイムキヨク|シヤクシヨ/, ['authority_claim']],
  [/ホゴ|アンゼン|カンリコウザ|ホカン/, ['safe_account', 'payee_name_flag']],
];
const MEMO_RULES: Array<[RegExp, KeywordCode[]]> = [
  [/(?<![A-Z])AI(?![A-Z])|承認済み|指示|無視/i, ['instructions_to_ai']],
  [/警察/, ['authority_claim']],
  [/保護|安全口座/, ['safe_account']],
  [/暗号資産|ビットコイン|仮想通貨|金地金/, ['crypto_or_gold']],
  [/元本保証|高利回り/, ['guaranteed_returns']],
  [/至急|本日中/, ['urgency']],
];

/** Bank holder names use large kana only: NFKC (half-width → full-width) then small kana → large. */
const normalizeHolderName = (s: string) =>
  s.normalize('NFKC').replace(/[ァィゥェォッャュョヮ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 1));

/** Deterministic keyword pre-check over the payee holder name (katakana) and memo (SPEC §7). */
export function keywordFlags(fields: { payeeName: string; memo: string }): Flag[] {
  const out = new Map<string, Flag>();
  const scan = (raw: string, field: Flag['field'], rules: Array<[RegExp, KeywordCode[]]>) => {
    const text = field === 'payee_name' ? normalizeHolderName(raw) : raw.normalize('NFKC');
    for (const [re, codes] of rules) {
      if (!re.test(text)) continue;
      for (const code of codes) {
        out.set(`${code}:${field}`, { code, severity: SEVERITY[code], source: 'bank_keyword', field, quote: raw.slice(0, 40) });
      }
    }
  };
  scan(fields.payeeName, 'payee_name', NAME_RULES);
  scan(fields.memo, 'memo', MEMO_RULES);
  return [...out.values()];
}

/** For tests: every code keywordFlags can emit, with its severity. */
export const KEYWORD_SEVERITY: Readonly<Record<KeywordCode, 'high' | 'elevated'>> = SEVERITY;
