'use client';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { formatJst, LookupResult, MeResult, Transfer } from '@matta/core';
import { useSession, type Session } from '@/lib/session';
import { bankFetch, errorJa, post, webFetch } from '@/lib/bankClient';
import { Nav } from '@/components/Nav';
import { TransferFacts, yen } from '@/components/TransferFacts';
import { DemoClock } from '@/components/DemoClock';

const KIND_JA = { new: '新しい振込先', registered: '登録済みの振込先', verified: '銀行確認済みの振込先' } as const;
const input = 'mt-1 w-full rounded border border-stone-300 px-3 py-2 tabular-nums';
const card = 'rounded-lg border border-stone-200 bg-white p-4';

export default function AppPage() {
  const session = useSession(['customer', 'operator']);
  if (!session) return <p className="text-sm text-stone-500">読み込み中…</p>;
  return (
    <>
      <Nav role={session.claims.role} />
      {session.claims.role === 'operator' ? <OperatorDebug session={session} /> : <CustomerHome sandboxId={session.claims.sandboxId} />}
    </>
  );
}

function CustomerHome({ sandboxId }: { sandboxId: string }) {
  const [me, setMe] = useState<MeResult | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, list] = await Promise.all([
        bankFetch('/v1/me', {}, MeResult),
        bankFetch('/v1/transfers', {}, z.object({ transfers: z.array(Transfer) })),
      ]);
      setMe(m);
      setTransfers(list.transfers);
      setError(null);
    } catch (e) {
      setError(errorJa(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-5">
      <section className={`${card} flex flex-wrap items-end justify-between gap-2`}>
        <div>
          <p className="text-sm text-stone-500">{me?.displayName ?? 'お客さま'}　普通預金残高</p>
          <p className="text-3xl font-semibold tabular-nums">{me?.balanceJpy !== undefined ? yen(me.balanceJpy) : '—'}</p>
        </div>
        {me?.now && <p className="text-xs text-stone-500 tabular-nums">現在時刻（デモ）{formatJst(me.now)}</p>}
      </section>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <DemoClock sandboxId={sandboxId} onChange={refresh} />
      <TransferForm onDone={refresh} />
      <section className="space-y-2">
        <h2 className="text-base font-semibold">振込一覧</h2>
        {transfers.length === 0 && <p className="text-sm text-stone-500">まだ振込はありません。</p>}
        {transfers.map((t) => (
          <TransferRow key={t.id} t={t} onChange={refresh} />
        ))}
      </section>
    </div>
  );
}

function TransferForm({ onDone }: { onDone: () => void }) {
  const [acct, setAcct] = useState({ bankCode: '', branchCode: '', accountNumber: '' });
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [result, setResult] = useState<Transfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (k: keyof typeof acct) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setAcct({ ...acct, [k]: e.target.value.replace(/\D/g, '') });
    setLookup(null);
  };

  async function doLookup() {
    setError(null);
    try {
      setLookup(await webFetch('/api/bank/lookup', post(acct), LookupResult));
    } catch (e) {
      setError(errorJa(e));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await webFetch('/api/bank/transfers', post({ ...acct, amountJpy: Number(amount), memo }), Transfer);
      setResult(t);
      setAmount('');
      setMemo('');
      onDone();
    } catch (err) {
      setError(errorJa(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-base font-semibold">振込</h2>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div className="grid grid-cols-[5rem_4rem_1fr_auto] items-end gap-2">
          <label>
            銀行コード
            <input className={input} inputMode="numeric" maxLength={4} required value={acct.bankCode} onChange={setField('bankCode')} />
          </label>
          <label>
            支店
            <input className={input} inputMode="numeric" maxLength={3} required value={acct.branchCode} onChange={setField('branchCode')} />
          </label>
          <label>
            口座番号
            <input className={input} inputMode="numeric" maxLength={7} required value={acct.accountNumber} onChange={setField('accountNumber')} />
          </label>
          <button type="button" onClick={doLookup} className="rounded border border-stone-300 px-3 py-2 hover:bg-stone-100">
            照会
          </button>
        </div>
        {lookup &&
          (lookup.found ? (
            <p className="rounded bg-stone-50 px-3 py-2">
              受取人：<span className="font-medium">{lookup.holderNameKana}</span>
              {lookup.displayName && `（${lookup.displayName}）`}
              {lookup.payeeKind && <span className="ml-2 text-xs text-stone-600">{KIND_JA[lookup.payeeKind]}</span>}
            </p>
          ) : (
            <p className="text-red-700">口座が見つかりませんでした。番号をご確認ください。</p>
          ))}
        <div className="grid grid-cols-2 gap-2">
          <label>
            金額（円）
            <input className={input} inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label>
            メモ（任意・40文字まで）
            <input className={input} maxLength={40} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !lookup?.found || !amount}
          className="rounded bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {busy ? '送信中…' : '振り込む'}
        </button>
      </form>
      {result && <TransferFacts t={result} />}
    </section>
  );
}

function TransferRow({ t, onChange }: { t: Transfer; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(path: 'cancel' | 'request-early-approval', done: string) {
    try {
      await bankFetch(`/v1/transfers/${t.id}/${path}`, post(), Transfer);
      setMsg(done);
      onChange();
    } catch (e) {
      setMsg(errorJa(e));
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm">
        <span className="tabular-nums">
          {formatJst(t.createdAt)}　{t.payee.holderNameKana}
        </span>
        <span className="tabular-nums font-medium">{yen(t.amountJpy)}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-stone-100 p-3">
          <TransferFacts t={t} />
          <div className="flex flex-wrap gap-2 text-sm">
            {(t.status === 'held' || t.status === 'contact_required') && (
              <button onClick={() => act('cancel', '取り消しました。')} className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100">
                取り消す
              </button>
            )}
            {t.status === 'held' && !t.earlyApprovalRequestedAt && (
              <button
                onClick={() => act('request-early-approval', '見守り人にお知らせしました。')}
                className="rounded border border-teal-700 px-3 py-1.5 text-teal-800 hover:bg-teal-50"
              >
                見守り人に早めの承認を依頼する
              </button>
            )}
            {t.earlyApprovalRequestedAt && <span className="py-1.5 text-stone-500">見守り人に早めの承認を依頼済みです。</span>}
          </div>
          {msg && <p className="text-sm text-stone-600">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function OperatorDebug({ session }: { session: Session }) {
  const [debug, setDebug] = useState<string | null>(null);
  async function checkBank() {
    setDebug('確認中…');
    const res = await fetch('/api/debug/bank', { headers: { authorization: `Bearer ${await session.user.getIdToken()}` } });
    setDebug(JSON.stringify(await res.json(), null, 2));
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-stone-600">デモ運営としてログインしています（{session.user.email}）。</p>
      <button onClick={checkBank} className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100">
        銀行との接続を確認
      </button>
      {debug && <pre className="overflow-x-auto rounded bg-stone-900 p-3 text-xs text-stone-100">{debug}</pre>}
    </div>
  );
}
