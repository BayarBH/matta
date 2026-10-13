// Reader fail-safe: invalid output twice → guardian_unavailable (elevated); a new payee can then never clear as everyday.
import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { defaultTerms, evaluateTransfer } from '@matta/core';
import { loadPolicy } from '@matta/core/node';

const loaded = loadPolicy(fileURLToPath(new URL('../../../../policy/system-policy.yaml', import.meta.url)));
const generateContent = vi.fn(async () => ({ text: 'not json {', usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 5 } }));

vi.mock('./env.server', () => ({ env: () => ({ MODEL_FAST: 'gemini-3.5-flash-lite' }) }));
vi.mock('./policy.server', () => ({ policy: () => loaded }));
vi.mock('./genai.server', () => ({
  genai: () => ({ models: { generateContent } }),
  usage: (r: { usageMetadata: { promptTokenCount: number; candidatesTokenCount: number } }) => ({
    tokensIn: r.usageMetadata.promptTokenCount,
    tokensOut: r.usageMetadata.candidatesTokenCount,
  }),
}));
vi.mock('./firebase.admin', () => ({
  db: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => undefined }) }) }),
}));
const audits: Array<{ action: string; estCostJpy?: number }> = [];
vi.mock('./audit', () => ({ writeAudit: async (e: { action: string; estCostJpy?: number }) => void audits.push(e) }));

const { readFields } = await import('./reader');

describe('quarantined reader fail-safe', () => {
  it('invalid JSON twice → one guardian_unavailable flag, and a new payee cannot clear', async () => {
    const flags = await readFields({ payeeName: 'スズキ タロウ', memo: '立替' }, { sandboxId: 'sandbox-1', actor: 'reader' });
    expect(generateContent).toHaveBeenCalledTimes(2); // one repair retry
    expect(flags).toEqual([expect.objectContaining({ code: 'guardian_unavailable', severity: 'elevated', source: 'reader' })]);
    expect(audits.at(-1)?.action).toBe('reader.fail_safe');

    const terms = defaultTerms({ uid: 'contact-1', displayName: '山田 美咲', relation: '姉' });
    const base = { terms, settledTodayJpy: 0, now: new Date('2026-10-13T05:00:00Z'), recentLoosening: false, flags };
    expect(evaluateTransfer({ ...base, amountJpy: 12_000, payeeKind: 'new' }).tier).not.toBe('clear');
    // Rule 9: everyday payments to registered payees keep flowing.
    expect(evaluateTransfer({ ...base, amountJpy: 85_000, payeeKind: 'registered' }).tier).toBe('clear');
  });

  it('LLM audit events carry an estimated cost', () => {
    expect(audits.find((a) => a.action === 'reader.read')?.estCostJpy).toBeGreaterThan(0);
  });
});
