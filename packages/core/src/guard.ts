import { z } from 'zod';
import { ReasonCode } from './schemas';
import type { SystemPolicy } from './policy';

/** Shown instead of any guardian/contact text that fails the guard. Must itself pass the guard. */
export const SAFE_TEMPLATE = 'ご確認ありがとうございます。差し支えなければ、このお振込みのご用途を教えていただけますか。';

// Paraphrased secret requests (beyond the policy's literal forbidden list).
const SECRET_REQUEST = /(暗証|パスコード|パス\s*ワード|PIN|ワンタイム|認証コード|確認コード|コードを(教え|入力|お知らせ))/i;
const ACCUSATION = /(詐欺(です|だ|に違いない)|騙されて(い|る)|だまされて(い|る)|犯罪です)/;
const RULE_HINT = /(設定を(変更|変え|オフ|解除)|解除するには|ルールを(外|ゆるめ|緩め|変えれば)|保護を(オフ|外)|見守りを(外|止め))/;
const URL = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|jp|net|org|io)\b)/i;
// 6+ digits possibly separated by - or spaces, or a full-width variant.
const PHONE = /(\+?\d[\d\-\s()]{7,}\d|[０-９][０-９\-－\s]{7,}[０-９])/;
const POLITE = /(です|ます|ください|ません|でした|ましょう)/;

export type GuardResult = { ok: true; text: string } | { ok: false; text: string; violations: string[] };

/** SPEC §6 message guard. Runs on every customer- or contact-facing text the LLM produced. */
export function messageGuard(text: string, policy: Pick<SystemPolicy, 'message_guard'>): GuardResult {
  const g = policy.message_guard;
  const t = text.trim();
  const v: string[] = [];
  if (!t) v.push('empty');
  if (t.length > g.max_chars) v.push('too_long');
  for (const f of g.forbidden) if (t.includes(f)) v.push(`forbidden:${f}`);
  if (SECRET_REQUEST.test(t)) v.push('secret_request');
  if (ACCUSATION.test(t)) v.push('accusation');
  if (RULE_HINT.test(t)) v.push('rule_hint');
  if (URL.test(t)) v.push('url');
  const withoutAllowed = g.phone_allowlist.reduce((s, p) => s.split(p).join(''), t);
  if (PHONE.test(withoutAllowed)) v.push('phone');
  if (t && !POLITE.test(t)) v.push('not_polite');
  return v.length ? { ok: false, text: SAFE_TEMPLATE, violations: [...new Set(v)] } : { ok: true, text: t };
}

export const ScamPattern = z.enum(['fake_police', 'fake_billing', 'refund', 'investment', 'romance', 'family_impersonation', 'other']);

/** SPEC §6 guardian assessment. */
export const Assessment = z.object({
  scamPatterns: z.array(ScamPattern),
  reasonCodes: z.array(ReasonCode),
  riskLevel: z.enum(['none', 'elevated', 'high']),
  rationaleJa: z.string().max(200),
  turnsUsed: z.number().int().nonnegative(),
});
export type Assessment = z.infer<typeof Assessment>;

/** Code — not the model — decides escalation: any high code, or ≥ N elevated codes. */
export function shouldEscalate(
  a: Pick<Assessment, 'reasonCodes'>,
  policy: Pick<SystemPolicy, 'reason_codes' | 'escalation'>,
): { escalate: boolean; reasonCodes: ReasonCode[] } {
  const codes = [...new Set(a.reasonCodes)];
  const sev = (c: ReasonCode) => policy.reason_codes[c]?.severity;
  const high = codes.filter((c) => sev(c) === 'high');
  const elevated = codes.filter((c) => sev(c) === 'elevated');
  const escalate = (policy.escalation.any_high && high.length > 0) || elevated.length >= policy.escalation.elevated_count_at_least;
  return { escalate, reasonCodes: escalate ? codes : [] };
}
