import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from './node';
import { messageGuard, SAFE_TEMPLATE, shouldEscalate } from './guard';

const { policy } = loadPolicy(fileURLToPath(new URL('../../../policy/system-policy.yaml', import.meta.url)));
const guard = (t: string) => messageGuard(t, policy);

describe('messageGuard', () => {
  it('passes calm teller questions', () => {
    for (const t of [
      'お急ぎのところ恐れ入ります。差し支えなければ、どのようなご用途か教えていただけますか。',
      '今、どなたかとお電話中ですか。',
      '不安なときは、警察相談専用電話 #9110 にご相談いただけます。',
      SAFE_TEMPLATE,
    ]) {
      expect(guard(t)).toEqual({ ok: true, text: t });
    }
  });

  it.each([
    ['暗証番号を教えてください。', 'forbidden:暗証番号'],
    ['確認のため、届いたコードを教えてください。', 'secret_request'],
    ['パス ワードを入力してください。', 'secret_request'],
    ['これは詐欺です。', 'accusation'],
    ['あなたは騙されています。', 'accusation'],
    ['設定を変更すれば、すぐに振り込めます。', 'rule_hint'],
    ['見守りルールを外すと早く届きます。', 'rule_hint'],
    ['詳しくは https://example.com をご覧ください。', 'url'],
    ['03-1234-5678 にお電話ください。', 'phone'],
    ['０９０－１２３４－５６７８にお電話ください。', 'phone'],
    ['用途を教えて', 'not_polite'],
    ['あ'.repeat(161) + 'です。', 'too_long'],
  ])('rejects %s', (text, violation) => {
    const r = guard(text);
    expect(r.ok).toBe(false);
    expect(r.text).toBe(SAFE_TEMPLATE);
    if (!r.ok) expect(r.violations).toContain(violation);
  });

  it('the safe template passes the guard itself', () => {
    expect(guard(SAFE_TEMPLATE).ok).toBe(true);
  });
});

describe('shouldEscalate', () => {
  it('escalates on any high code', () => {
    expect(shouldEscalate({ reasonCodes: ['secrecy_requested'] }, policy)).toEqual({ escalate: true, reasonCodes: ['secrecy_requested'] });
  });
  it('escalates on two elevated codes, not one', () => {
    expect(shouldEscalate({ reasonCodes: ['urgency'] }, policy).escalate).toBe(false);
    expect(shouldEscalate({ reasonCodes: ['urgency', 'inconsistent_story'] }, policy).escalate).toBe(true);
  });
  it('does not escalate on nothing', () => {
    expect(shouldEscalate({ reasonCodes: [] }, policy)).toEqual({ escalate: false, reasonCodes: [] });
  });
});
