'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Transfer } from '@matta/core';
import { bankFetch, errorJa, post, webFetch } from '@/lib/bankClient';

const Msg = z.object({ role: z.enum(['guardian', 'customer', 'system']), textJa: z.string(), ts: z.string() });
const Conv = z.object({
  status: z.enum(['open', 'closed']),
  messages: z.array(Msg),
  resources: z.array(z.string()),
  failSafe: z.boolean(),
  paused: z.boolean(),
});
type Conv = z.infer<typeof Conv>;

const RESOURCE_9110 = '不安なときは、警察相談専用電話 #9110 にご相談いただけます。';
export const PAUSED_JA = 'AIガーディアンは一時停止中です。保留中のお振込みは、見守り人の確認が必要になります。';

/**
 * AIガーディアン（マッタ）. Visually separate from <TransferFacts/>; it shows only guarded text and never amounts or statuses.
 * Cancel / early-approval are deterministic buttons that call the bank directly.
 */
export function GuardianChat({ t, onChange }: { t: Transfer; onChange: () => void }) {
  const [conv, setConv] = useState<Conv | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const checked = t.status === 'held' || t.status === 'contact_required';

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const r = await webFetch(`/api/guardian/${t.id}`, {}, z.object({ conversation: Conv.nullable(), paused: z.boolean() }));
        if (r.conversation || !checked) return setConv(r.conversation);
        setBusy(true);
        setConv(await webFetch(`/api/guardian/${t.id}/start`, post(), Conv));
        onChange();
      } catch (e) {
        setError(errorJa(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [t.id, checked, onChange]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setConv(await webFetch(`/api/guardian/${t.id}/message`, post({ textJa: text.trim() }), Conv));
      setText('');
      onChange();
    } catch (err) {
      setError(errorJa(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(path: 'cancel' | 'request-early-approval') {
    try {
      await bankFetch(`/v1/transfers/${t.id}/${path}`, post(), Transfer);
      onChange();
    } catch (err) {
      setError(errorJa(err));
    }
  }

  if (!checked && !conv) return null;
  return (
    <section aria-label="AIガーディアン（マッタ）" className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm">
      <header className="flex items-center justify-between">
        <h3 className="font-semibold text-indigo-950">AIガーディアン（マッタ）</h3>
        <span className="text-xs text-indigo-800/70">AIは振込を止められますが、通すことはできません</span>
      </header>
      {conv?.paused && <p className="rounded bg-amber-100 px-3 py-2 text-amber-900">{PAUSED_JA}</p>}
      <ol className="space-y-2">
        {conv?.messages.map((m, i) => (
          <li key={i} className={m.role === 'customer' ? 'flex justify-end' : 'flex'}>
            <p
              className={
                m.role === 'customer'
                  ? 'max-w-[85%] rounded-lg bg-white px-3 py-2 shadow-sm'
                  : m.role === 'system'
                    ? 'max-w-[85%] rounded-lg border border-indigo-200 bg-white/70 px-3 py-2 text-indigo-900'
                    : 'max-w-[85%] rounded-lg bg-indigo-100 px-3 py-2 text-indigo-950'
              }
            >
              {m.textJa}
            </p>
          </li>
        ))}
        {busy && <li className="text-xs text-indigo-800/70">考えています…</li>}
      </ol>
      {conv?.status === 'open' && (
        <form onSubmit={send} className="flex gap-2">
          <input
            className="flex-1 rounded border border-indigo-200 bg-white px-3 py-2"
            maxLength={400}
            placeholder="お答えを入力してください"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <button disabled={busy || !text.trim()} className="rounded bg-indigo-700 px-3 py-2 text-white disabled:opacity-50">
            送信
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {checked && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => act('cancel')} className="rounded border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-100">
            この振込を取り消す
          </button>
          {t.status === 'held' && !t.earlyApprovalRequestedAt && (
            <button onClick={() => act('request-early-approval')} className="rounded border border-teal-700 bg-white px-3 py-1.5 text-teal-800 hover:bg-teal-50">
              見守り人に早めの承認を依頼する
            </button>
          )}
        </div>
      )}
      <p className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-700">{RESOURCE_9110}</p>
    </section>
  );
}
