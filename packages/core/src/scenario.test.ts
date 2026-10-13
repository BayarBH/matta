import { describe, expect, it } from 'vitest';
import { Scenario, scenarioContentProblems } from './scenario';

const base = {
  id: 'S9',
  set: 'A',
  kind: 'scam',
  titleJa: 'テスト',
  victim: [{ action: 'wait', args: { seconds: 1 } }],
  expected: {},
};
const withLine = (textJa: string) =>
  scenarioContentProblems(Scenario.parse({ ...base, caller: { nameJa: '青嶺県警察（架空）', lines: [{ trigger: 'start', textJa }] } }));

describe('Scenario', () => {
  it('validates action args and rejects unknown triggers/actions', () => {
    expect(Scenario.safeParse(base).success).toBe(true);
    expect(Scenario.safeParse({ ...base, victim: [{ action: 'release', args: {} }] }).success).toBe(false);
    expect(Scenario.safeParse({ ...base, victim: [{ action: 'advance_clock', args: { hours: 5 } }] }).success).toBe(false);
    expect(Scenario.safeParse({ ...base, caller: { nameJa: 'x', lines: [{ trigger: 'whenever', textJa: 'x' }] } }).success).toBe(false);
    expect(Scenario.safeParse({ ...base, victim: [{ action: 'request_mandate_change', args: {} }] }).success).toBe(false);
  });

  it('content rules: fictional names only, no realistic phone numbers', () => {
    expect(withLine('青嶺県警察（架空）の者です。')).toEqual([]);
    expect(withLine('警視庁の者です。')).not.toEqual([]);
    expect(withLine('大阪府警察です。')).not.toEqual([]);
    expect(withLine('神奈川県警の者です。')).not.toEqual([]);
    expect(withLine('ニセ警察に注意。警察を名乗る電話でした。')).toEqual([]);
    expect(withLine('みずほ銀行です。')).not.toEqual([]);
    expect(withLine('03-1234-5678 に折り返してください。')).not.toEqual([]);
    expect(withLine('09012345678 です。')).not.toEqual([]);
    expect(withLine('＋国際番号（架空）からの着信です。#9110 もあります。')).toEqual([]);
  });
});
