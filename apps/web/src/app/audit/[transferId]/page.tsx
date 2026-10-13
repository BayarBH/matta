'use client';
import { use, useEffect, useState } from 'react';
import { z } from 'zod';
import { AuditEvent } from '@matta/core';
import { useSession } from '@/lib/session';
import { errorJa, webFetch } from '@/lib/bankClient';
import { Nav } from '@/components/Nav';
import { AuditTimeline, actorJa } from '@/components/AuditTimeline';

const AuditResponse = z.object({ events: z.array(AuditEvent) });

/** Deterministic summary: the web service (which holds the LLM) must never have settled or released anything. */
function summarize(events: AuditEvent[]) {
  const aiReleases = events.filter((e) => e.service === 'web' && /settle|release/.test(e.action)).length;
  const settled = events.find((e) => e.service === 'bank' && e.action === 'transfer.settled' && e.outcome === 'ok');
  const cancelled = events.find((e) => e.service === 'bank' && e.action === 'transfer.cancelled');
  const denied = events.find((e) => e.service === 'bank' && e.action === 'transfer.contact_denied');
  return { aiReleases, settled, cancelled: denied ?? cancelled };
}

export default function AuditPage({ params }: { params: Promise<{ transferId: string }> }) {
  const { transferId } = use(params);
  const session = useSession(['customer', 'operator']);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    webFetch(`/api/audit/${encodeURIComponent(transferId)}`, {}, AuditResponse)
      .then((r) => setEvents(r.events))
      .catch((e) => setError(errorJa(e)));
  }, [session, transferId]);

  if (!session) return null;
  const s = events ? summarize(events) : null;

  return (
    <main className="space-y-4">
      <Nav role={session.claims.role} />
      <h1 className="text-xl font-semibold">ブラックボックス</h1>
      <p className="text-sm text-stone-600">このお振込みについて、アプリと銀行で起きたことをすべて時刻順に記録しています。</p>
      {error && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>}
      {s && (
        <section className="grid gap-2 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-stone-500">AIによる送金の実行</p>
            <p className="text-2xl font-semibold tabular-nums text-teal-900">{s.aiReleases}件</p>
            <p className="text-xs text-stone-500">AIはお金を止められますが、通すことはできません。</p>
          </div>
          <div>
            <p className="text-stone-500">振込を実行した主体</p>
            <p className="font-medium">{s.settled ? `銀行（${actorJa(s.settled.actor)}）` : '—（未実行）'}</p>
          </div>
          <div>
            <p className="text-stone-500">取り消した主体</p>
            <p className="font-medium">{s.cancelled ? actorJa(s.cancelled.actor) : '—'}</p>
          </div>
        </section>
      )}
      {events && <AuditTimeline events={events} />}
    </main>
  );
}
