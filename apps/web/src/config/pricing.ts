/**
 * ESTIMATE ONLY. Per-1M-token list prices (USD, standard paid tier, text) for the configured models.
 * Source: Gemini API pricing page, read 2026-10-13. The Vertex AI pricing page did not render for automated
 * reading; Vertex list prices for these models are normally the same — re-check before quoting in EVAL.md.
 */
export const PRICING = {
  asOf: '2026-10-13',
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  /** USD→JPY, estimate. */
  jpyPerUsd: 150,
  perMillionUsd: {
    'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
    // Introductory price through 2026-12-31 (covers the judging window); $1.50 / $7.50 from 2027-01-01.
    'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  } as Record<string, { input: number; output: number }>,
};

/** Estimated cost in JPY; undefined for a model without a price entry (never guess). */
export function estCostJpy(model: string, tokensIn: number, tokensOut: number): number | undefined {
  const p = PRICING.perMillionUsd[model];
  if (!p) return undefined;
  return ((tokensIn * p.input + tokensOut * p.output) / 1_000_000) * PRICING.jpyPerUsd;
}
