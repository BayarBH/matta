import { describe, expect, it } from 'vitest';
import { classifyChange, defaultTerms, formatJpyJa, ruleTextJa, RuleId, type MandateTerms } from './mandate';

const base = () => defaultTerms({ uid: 'contact-1', displayName: '山田 美咲', relation: '姉' });
const edit = (f: (t: MandateTerms) => void) => {
  const t = structuredClone(base());
  f(t);
  return t;
};
const kind = (to: MandateTerms) => classifyChange(base(), to).kind;

describe('classifyChange', () => {
  it('identical is noop', () => {
    expect(classifyChange(base(), base())).toEqual({ kind: 'noop', loosened: [], tightened: [] });
  });

  // [field, make stricter, make looser]
  const cases: Array<[string, (t: MandateTerms) => void, (t: MandateTerms) => void]> = [
    ['everyday.registeredPayeeAutoMaxJpy', (t) => (t.everyday.registeredPayeeAutoMaxJpy = 100_000), (t) => (t.everyday.registeredPayeeAutoMaxJpy = 500_000)],
    ['everyday.newPayeeAutoMaxJpy', (t) => (t.everyday.newPayeeAutoMaxJpy = 10_000), (t) => (t.everyday.newPayeeAutoMaxJpy = 100_000)],
    ['everyday.dailyAutoTotalMaxJpy', (t) => (t.everyday.dailyAutoTotalMaxJpy = 200_000), (t) => (t.everyday.dailyAutoTotalMaxJpy = 900_000)],
    ['contactRequired.newPayeeOverJpy', (t) => (t.contactRequired.newPayeeOverJpy = 500_000), (t) => (t.contactRequired.newPayeeOverJpy = 3_000_000)],
    ['holds.holdHours', (t) => (t.holds.holdHours = 48), (t) => (t.holds.holdHours = 1)],
    ['holds.verifiedPayeeHoldHours', (t) => (t.holds.verifiedPayeeHoldHours = 6), (t) => (t.holds.verifiedPayeeHoldHours = 1 + 0)],
    ['holds.contactDecisionWindowHours', (t) => (t.holds.contactDecisionWindowHours = 24), (t) => (t.holds.contactDecisionWindowHours = 168)],
    ['changes.loosenCoolingOffHours', (t) => (t.changes.loosenCoolingOffHours = 168), (t) => (t.changes.loosenCoolingOffHours = 1)],
    ['changes.contactMayCosignLoosening', (t) => (t.changes.contactMayCosignLoosening = false), () => {}],
  ];

  for (const [field, stricter, looser] of cases) {
    it(`${field}: stricter → tighten`, () => {
      const r = classifyChange(base(), edit(stricter));
      expect(r.kind).toBe('tighten');
      expect(r.tightened).toEqual([field]);
    });
    it(`${field}: looser → loosen`, () => {
      // verifiedPayeeHoldHours default is already 1 (minimum) and cosign default is true: loosen from a stricter start.
      const from = edit(stricter);
      const to = edit(looser);
      const r = classifyChange(from, to);
      expect(r.kind).toBe('loosen');
      expect(r.loosened).toEqual([field]);
    });
  }

  it('mixed change (one stricter, one looser) is loosen', () => {
    const r = classifyChange(
      base(),
      edit((t) => {
        t.holds.holdHours = 48;
        t.everyday.newPayeeAutoMaxJpy = 100_000;
      }),
    );
    expect(r).toMatchObject({ kind: 'loosen', loosened: ['everyday.newPayeeAutoMaxJpy'], tightened: ['holds.holdHours'] });
  });

  describe('every contact change is loosening', () => {
    const other = { uid: 'contact-x', displayName: '佐藤 一郎', relation: '友人' };
    const variants: Array<[string, (t: MandateTerms) => void]> = [
      ['add', (t) => t.contacts.push(other)],
      ['remove (to a different single contact list)', (t) => (t.contacts = [other])],
      ['replace uid', (t) => (t.contacts[0]!.uid = 'contact-2')],
      ['edit display name', (t) => (t.contacts[0]!.displayName = '山田 美咲（新）')],
      ['edit relation', (t) => (t.contacts[0]!.relation = '母')],
    ];
    for (const [name, f] of variants) {
      it(name, () => {
        const r = classifyChange(base(), edit(f));
        expect(r.kind).toBe('loosen');
        expect(r.loosened).toContain('contacts');
      });
    }
    it('removing one of two contacts', () => {
      const two = edit((t) => t.contacts.push(other));
      expect(classifyChange(two, base()).loosened).toEqual(['contacts']);
    });
    it('contact change + every other field stricter is still loosen', () => {
      const r = classifyChange(
        base(),
        edit((t) => {
          t.holds.holdHours = 72;
          t.contactRequired.newPayeeOverJpy = 100_000;
          t.contacts.push(other);
        }),
      );
      expect(r.kind).toBe('loosen');
    });
    it('reordering contacts is not a change', () => {
      const two = edit((t) => t.contacts.push(other));
      const swapped = edit((t) => (t.contacts = [other, ...t.contacts]));
      expect(classifyChange(two, swapped).kind).toBe('noop');
    });
  });

  describe('quiet hours (22:00–06:00 default)', () => {
    const q = (start: string, end: string) => edit((t) => (t.holds.quietHours = { start, end }));
    it('wider window → tighten', () => expect(kind(q('21:00', '07:00'))).toBe('tighten'));
    it('narrower window → loosen', () => expect(kind(q('23:00', '05:00'))).toBe('loosen'));
    it('removed → loosen', () => expect(kind(edit((t) => (t.holds.quietHours = null)))).toBe('loosen'));
    it('null → window is tighten', () => {
      const none = edit((t) => (t.holds.quietHours = null));
      expect(classifyChange(none, base()).kind).toBe('tighten');
    });
    it('shifted (not a superset) → loosen', () => expect(kind(q('23:00', '07:00'))).toBe('loosen'));
    it('same window → noop', () => expect(kind(q('22:00', '06:00'))).toBe('noop'));
  });
});

describe('ruleTextJa', () => {
  it('uses the customer’s own numbers', () => {
    const t = base();
    expect(ruleTextJa('R-CONTACT-LARGE-NEW', t)).toBe('新しい振込先への100万円超の振込は、見守り人の承認が必要');
    expect(ruleTextJa('R-EVERYDAY-REG', t)).toBe('登録済みの振込先へは30万円まで、1日の合計50万円まではすぐに振り込む');
    expect(ruleTextJa('R-EVERYDAY-NEW', t)).toBe('新しい振込先へは5万円まで（22:00〜06:00を除く）すぐに振り込む');
    expect(ruleTextJa('R-HOLD-DEFAULT', t)).toBe('それ以外の振込は24時間保留する');
    expect(ruleTextJa('R-HOLD-VERIFIED', t)).toBe('銀行が確認済みの振込先は1時間保留する');
    expect(ruleTextJa('R-LOOSEN-OPEN', t)).toBe('ルールをゆるめる申請から72時間は、日常の範囲外の振込に見守り人の承認が必要');
    expect(ruleTextJa('R-CONTACT-LARGE-NEW', edit((x) => (x.contactRequired.newPayeeOverJpy = 2_500_000)))).toContain('250万円超');
  });
  it('covers every rule id', () => {
    for (const id of RuleId.options) expect(ruleTextJa(id, base()).length).toBeGreaterThan(5);
  });
});

describe('formatJpyJa', () => {
  it('formats man-yen and odd amounts', () => {
    expect(formatJpyJa(1_000_000)).toBe('100万円');
    expect(formatJpyJa(50_000)).toBe('5万円');
    expect(formatJpyJa(12_345)).toBe('12,345円');
    expect(formatJpyJa(9_000)).toBe('9,000円');
  });
});
