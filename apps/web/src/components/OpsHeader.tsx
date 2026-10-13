'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { errorJa, webFetch } from '@/lib/bankClient';

const OpsMetrics = z.object({
  bank: z.object({
    byStatus: z.record(z.string(), z.number()),
    byRule: z.record(z.string(), z.number()),
    openHolds: z.number(),
    contactRequired: z.number(),
    medianAddedDelayMinLegit: z.number().nullable(),
  }),
  guardian: z.object({
    guardedTransfers: z.number(),
    escalations: z.number(),
    failSafes: z.number(),
    errorRate: z.number().nullable(),
    paused: z.boolean(),
    medianLatencyMs: z.number().nullable(),
    estCostPerGuardedJpy: z.number().nullable(),
  }),
});
type OpsMetrics = z.infer<typeof OpsMetrics>;

const TIER_JA: Record<string, string> = {
  settled: '振込済み',
  held: '保留中',
  contact_required: '承認待ち',
  cancelled: '取消',
  branch_review: '窓口確認',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-stone-200 bg-white px-3 py-2">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Operator-only metrics strip. Refreshes every 10 s. */
export function OpsHeader() {
  const [m, setM] = useState<OpsMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      webFetch('/api/ops/metrics', {}, OpsMetrics)
        .then((r) => (setM(r), setError(null)))
        .catch((e) => setError(errorJa(e)));
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  if (error) return <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>;
  if (!m) return <p className="text-sm text-stone-500">読み込み中…</p>;
  const g = m.guardian;
  return (
    <section aria-label="運営メトリクス" className="space-y-2">
      {g.paused && (
        <p className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">AIガーディアンは一時停止中です。確認が必要な振込はすべて見守り人の承認待ちになります。</p>
      )}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {Object.entries(m.bank.byStatus).map(([k, v]) => (
          <Stat key={k} label={`振込：${TIER_JA[k] ?? k}`} value={`${v}件`} />
        ))}
        <Stat label="保留中" value={`${m.bank.openHolds}件`} />
        <Stat label="見守り人の承認待ち" value={`${m.bank.contactRequired}件`} />
        <Stat
          label="追加された待ち時間（中央値）"
          value={m.bank.medianAddedDelayMinLegit === null ? '—' : `${Math.round(m.bank.medianAddedDelayMinLegit)}分`}
        />
        <Stat label="AIが確認した振込" value={`${g.guardedTransfers}件`} />
        <Stat label="AIによるエスカレーション" value={`${g.escalations}件`} />
        <Stat label="AIエラー率（直近20回）" value={g.errorRate === null ? '—' : `${Math.round(g.errorRate * 100)}%`} />
        <Stat label="AI応答時間（中央値）" value={g.medianLatencyMs === null ? '—' : `${Math.round(g.medianLatencyMs)}ms`} />
        <Stat label="確認1件あたりの推定費用" value={g.estCostPerGuardedJpy === null ? 'Phase 4で算出' : `約${g.estCostPerGuardedJpy.toFixed(2)}円`} />
      </div>
    </section>
  );
}
