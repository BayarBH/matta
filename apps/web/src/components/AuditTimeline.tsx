import { formatJst, type AuditEvent } from '@matta/core';

/** Deterministic rendering of audit events; no LLM text except guarded detailsJa written by the services. */
const ACTOR_JA: Record<string, string> = {
  guardian: 'AIガーディアン',
  reader: '読み取りAI',
  customer: '預金者',
  contact: '見守り人',
  operator: 'デモ運営',
  system: 'システム',
  service: 'サービス間通信',
  autopilot: '自動シミュレーション',
  anonymous: '不明な呼び出し',
};

export const actorJa = (actor: string) => {
  const [kind, rest] = actor.split(/:(.*)/);
  const label = ACTOR_JA[kind ?? ''] ?? actor;
  return kind === 'autopilot' && rest ? `${label}（${ACTOR_JA[rest] ?? rest}）` : label;
};

const OUTCOME_STYLE: Record<AuditEvent['outcome'], string> = {
  ok: 'border-stone-200 bg-white',
  pending: 'border-sky-200 bg-sky-50',
  rejected: 'border-amber-300 bg-amber-50',
  error: 'border-rose-300 bg-rose-50',
};

const OUTCOME_JA: Record<AuditEvent['outcome'], string> = { ok: '完了', pending: '保留', rejected: '拒否', error: 'エラー' };

export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <p className="text-sm text-stone-500">記録はまだありません。</p>;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className={`rounded-lg border p-3 text-sm ${OUTCOME_STYLE[e.outcome]}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span className="tabular-nums">{formatJst(e.ts)}</span>
            {e.simTs && <span className="tabular-nums">（デモ時計 {formatJst(e.simTs)}）</span>}
            <span className={`rounded px-1.5 py-0.5 font-medium ${e.service === 'bank' ? 'bg-teal-100 text-teal-900' : 'bg-violet-100 text-violet-900'}`}>
              {e.service === 'bank' ? '銀行' : 'アプリ'}
            </span>
            <span className="font-medium text-stone-700">{actorJa(e.actor)}</span>
            <code className="text-stone-500">{e.action}</code>
            <span className="ml-auto">{OUTCOME_JA[e.outcome]}</span>
          </div>
          <p className="mt-1 text-stone-800">{e.detailsJa}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-500">
            {e.ruleId && <span>ルール {e.ruleId}</span>}
            {e.mandateHash && <span>契約 {e.mandateHash.slice(0, 8)}</span>}
            {e.policyHash && <span>ポリシー {e.policyHash.slice(0, 8)}</span>}
            {e.model && <span>モデル {e.model}</span>}
            {(e.tokensIn !== undefined || e.tokensOut !== undefined) && (
              <span>
                トークン {e.tokensIn ?? 0}/{e.tokensOut ?? 0}
              </span>
            )}
            {e.latencyMs !== undefined && <span>{e.latencyMs}ms</span>}
            {e.estCostJpy !== undefined && <span>約{e.estCostJpy.toFixed(2)}円</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}
