'use client';
import { useCallback, useEffect, useState } from 'react';
import { ContactInbox, ContactTransferView, formatJst, MandateChange } from '@matta/core';
import { useSession } from '@/lib/session';
import { bankFetch, errorJa, post } from '@/lib/bankClient';
import { FIELD_JA } from '@/lib/reasonCodes';
import { Nav } from '@/components/Nav';
import { TransferFacts } from '@/components/TransferFacts';

/** Trusted contact's inbox. Decisions go from this browser straight to the bank (never through the web server). */
export default function ContactPage() {
  const session = useSession(['contact']);
  const [inbox, setInbox] = useState<ContactInbox | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInbox(await bankFetch('/v1/contact/inbox', {}, ContactInbox));
      setError(null);
    } catch (e) {
      setError(errorJa(e));
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [session, refresh]);

  if (!session) return <p className="text-sm text-stone-500">読み込み中…</p>;
  const count = (inbox?.transfers.length ?? 0) + (inbox?.mandateChanges.length ?? 0);
  return (
    <>
      <Nav role="contact" />
      <div className="mx-auto max-w-lg space-y-5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">見守り人の受信箱</h2>
          {count > 0 && <span className="rounded-full bg-sky-700 px-2 py-0.5 text-xs text-white">{count}</span>}
        </div>
        <p className="text-sm text-stone-600">ご本人が決めたルールにより、あなたの判断を待っている内容です。迷ったときは、まずご本人に電話で確認してください。</p>
        <a href="tel:0000000000" className="inline-block rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100">
          本人に電話する（架空の番号）
        </a>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-stone-700">判断を待っている振込</h3>
          {inbox?.transfers.length === 0 && <p className="text-sm text-stone-500">ありません。</p>}
          {inbox?.transfers.map((t) => (
            <div key={t.id} className="space-y-2">
              {t.earlyApprovalRequestedAt && (
                <p className="text-xs text-sky-800">ご本人から早めの承認の依頼があります（{formatJst(t.earlyApprovalRequestedAt)}）</p>
              )}
              <p className="text-xs text-stone-500">{heldFor(t)}</p>
              <TransferFacts t={t} />
              <Decision
                approveLabel="承認する"
                onDecide={(decision, reasonJa) =>
                  bankFetch(`/v1/transfers/${t.id}/contact-decision`, post({ decision, reasonJa }), ContactTransferView).then(refresh)
                }
              />
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-stone-700">ルールをゆるめる申請</h3>
          {inbox?.mandateChanges.length === 0 && <p className="text-sm text-stone-500">ありません。</p>}
          {inbox?.mandateChanges.map((c) => (
            <div key={c.id} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-medium">ご本人が、見守りルールをゆるめる変更を申請しました。</p>
              <ul className="list-disc pl-5">
                {c.loosened.map((f) => (
                  <li key={f}>{FIELD_JA[f] ?? f}</li>
                ))}
              </ul>
              {c.effectiveAt && <p className="tabular-nums text-stone-700">何もしなければ {formatJst(c.effectiveAt)} に有効になります。</p>}
              <p className="text-stone-600">「設定を変えるように」と誰かに言われていないか、ご本人に確認してください。</p>
              <Decision
                approveLabel="承認する（すぐに有効）"
                onDecide={(decision, reasonJa) =>
                  bankFetch(
                    `/v1/mandate/changes/${c.id}/contact-decision`,
                    post({ decision: decision === 'approve' ? 'cosign' : 'deny', reasonJa }),
                    MandateChange,
                  ).then(refresh)
                }
              />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function heldFor(t: ContactTransferView): string {
  const since = t.contactRequiredSince ?? t.createdAt;
  return `受付 ${formatJst(t.createdAt)}・判断待ち開始 ${formatJst(since)}`;
}

function Decision({ approveLabel, onDecide }: { approveLabel: string; onDecide: (d: 'approve' | 'deny', reasonJa: string) => Promise<unknown> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(d: 'approve' | 'deny') {
    if (!reason.trim()) return setMsg('理由を入力してください。');
    setBusy(true);
    setMsg(null);
    try {
      await onDecide(d, reason.trim());
    } catch (e) {
      setMsg(errorJa(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-3 text-sm">
      <label className="block">
        理由（必須）
        <textarea
          className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => decide('approve')} className="flex-1 rounded bg-teal-700 py-2 text-white hover:bg-teal-800 disabled:opacity-50">
          {approveLabel}
        </button>
        <button disabled={busy} onClick={() => decide('deny')} className="flex-1 rounded border border-stone-400 py-2 hover:bg-stone-100 disabled:opacity-50">
          承認しない
        </button>
      </div>
      {msg && <p role="alert" className="text-red-700">{msg}</p>}
    </div>
  );
}
