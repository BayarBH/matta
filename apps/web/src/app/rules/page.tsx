'use client';
import { useCallback, useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { formatJpyJa, formatJst, MandateChange, MandateView, type MandateTerms } from '@matta/core';
import { useSession, type Session } from '@/lib/session';
import { bankFetch, errorJa, post } from '@/lib/bankClient';
import { FIELD_JA } from '@/lib/reasonCodes';
import { Nav } from '@/components/Nav';

const card = 'rounded-lg border border-stone-200 bg-white p-4';
const input = 'mt-1 w-full rounded border border-stone-300 px-2 py-1.5 tabular-nums';

export default function RulesPage() {
  const session = useSession(['customer', 'contact']);
  const [view, setView] = useState<MandateView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await bankFetch('/v1/mandate', {}, MandateView));
    } catch (e) {
      setError(errorJa(e));
    }
  }, []);
  useEffect(() => {
    if (session) void refresh();
  }, [session, refresh]);

  if (!session) return <p className="text-sm text-stone-500">読み込み中…</p>;
  const isCustomer = session.claims.role === 'customer';
  return (
    <>
      <Nav role={session.claims.role} />
      <div className="space-y-5">
        <p className="rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-900">
          このルールは、落ち着いている今のあなたが、焦っているかもしれない未来のあなたのために決めるものです。
        </p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {view && (
          <>
            <ActiveRules view={view} />
            <Pending pending={view.pending} canWithdraw={isCustomer} onChange={refresh} />
            {isCustomer && <ChangeForm key={view.active.hash} session={session} initial={view.active} onDone={refresh} />}
          </>
        )}
      </div>
    </>
  );
}

function rows(t: MandateTerms): Array<[string, string]> {
  const q = t.holds.quietHours;
  return [
    [FIELD_JA['everyday.registeredPayeeAutoMaxJpy']!, formatJpyJa(t.everyday.registeredPayeeAutoMaxJpy)],
    [FIELD_JA['everyday.newPayeeAutoMaxJpy']!, formatJpyJa(t.everyday.newPayeeAutoMaxJpy)],
    [FIELD_JA['everyday.dailyAutoTotalMaxJpy']!, formatJpyJa(t.everyday.dailyAutoTotalMaxJpy)],
    [FIELD_JA['contactRequired.newPayeeOverJpy']!, `${formatJpyJa(t.contactRequired.newPayeeOverJpy)}超`],
    [FIELD_JA['holds.holdHours']!, `${t.holds.holdHours}時間`],
    [FIELD_JA['holds.verifiedPayeeHoldHours']!, `${t.holds.verifiedPayeeHoldHours}時間`],
    [FIELD_JA['holds.quietHours']!, q ? `${q.start}〜${q.end}（新しい振込先へはすぐに振り込みません）` : 'なし'],
    [FIELD_JA['holds.contactDecisionWindowHours']!, `${t.holds.contactDecisionWindowHours}時間（過ぎると窓口での本人確認）`],
    [FIELD_JA['changes.loosenCoolingOffHours']!, `${t.changes.loosenCoolingOffHours}時間`],
    [FIELD_JA['changes.contactMayCosignLoosening']!, t.changes.contactMayCosignLoosening ? 'はい' : 'いいえ'],
    [FIELD_JA.contacts!, t.contacts.map((c) => `${c.displayName}（${c.relation}）`).join('、')],
  ];
}

function ActiveRules({ view }: { view: MandateView }) {
  const a = view.active;
  return (
    <section className={card}>
      <h2 className="text-base font-semibold">現在のルール</h2>
      <p className="mt-1 text-xs text-stone-500 tabular-nums">
        第{a.version}版・署名 {formatJst(a.signedAt)}・ハッシュ {a.hash.slice(0, 8)}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-[18rem_1fr]">
        {rows(a).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-stone-500">{k}</dt>
            <dd className="mb-1 sm:mb-0">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const CHANGE_STATUS_JA = { applied: '有効', pending: '保留中', rejected: '見守り人が承認しませんでした', withdrawn: '取り下げ済み' } as const;

function Pending({ pending, canWithdraw, onChange }: { pending: MandateChange[]; canWithdraw: boolean; onChange: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (pending.length === 0) return null;
  async function withdraw(id: string) {
    try {
      await bankFetch(`/v1/mandate/changes/${id}/withdraw`, post(), MandateChange);
      setMsg('取り下げました。');
      onChange();
    } catch (e) {
      setMsg(errorJa(e));
    }
  }
  return (
    <section className={`${card} space-y-2`}>
      <h2 className="text-base font-semibold">申請中の変更</h2>
      {pending.some((c) => c.status === 'pending') && (
        <p className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2.5 font-medium text-amber-950">
          ルールをゆるめる変更は、冷却期間が過ぎるまで有効になりません（見守り人が承認した場合はすぐに有効）。見守り人にお知らせしました。
        </p>
      )}
      {pending.map((c) => (
        <div key={c.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p>
            {CHANGE_STATUS_JA[c.status]}
            {c.effectiveAt && <span className="tabular-nums">・{formatJst(c.effectiveAt)} に有効になります</span>}
          </p>
          <p className="mt-1 text-stone-600">ゆるめる項目：{c.loosened.map((f) => FIELD_JA[f] ?? f).join('、')}</p>
          {canWithdraw && c.status === 'pending' && (
            <button onClick={() => withdraw(c.id)} className="mt-2 rounded border border-stone-300 bg-white px-3 py-1 hover:bg-stone-100">
              取り下げる
            </button>
          )}
        </div>
      ))}
      {msg && <p className="text-sm text-stone-600">{msg}</p>}
    </section>
  );
}

function ChangeForm({ session, initial, onDone }: { session: Session; initial: MandateTerms; onDone: () => void }) {
  const [t, setT] = useState<MandateTerms>(() => ({
    everyday: { ...initial.everyday },
    contactRequired: { ...initial.contactRequired },
    holds: { ...initial.holds },
    contacts: initial.contacts.map((c) => ({ ...c })),
    changes: { ...initial.changes },
  }));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const num = <G extends 'everyday' | 'contactRequired' | 'holds' | 'changes'>(group: G, key: keyof MandateTerms[G] & string, unit: string) => (
    <label className="text-sm">
      {FIELD_JA[`${group}.${key}`]}（{unit}）
      <input
        className={input}
        inputMode="numeric"
        value={String(t[group][key])}
        onChange={(e) => setT({ ...t, [group]: { ...t[group], [key]: Number(e.target.value.replace(/\D/g, '')) } })}
      />
    </label>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const user = session.user;
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password));
      const change = await bankFetch('/v1/mandate/changes', post({ terms: t }), MandateChange, { forceRefresh: true });
      setMsg(
        change.kind === 'loosen'
          ? 'ルールをゆるめる変更は72時間後に有効になります（見守り人が承認した場合はすぐに有効）。見守り人にお知らせしました。'
          : change.kind === 'tighten'
            ? 'すぐに有効になりました。'
            : '変更はありませんでした。',
      );
      setPassword('');
      onDone();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setMsg(code?.startsWith('auth/') ? 'パスワードが正しくありません。もう一度入力してください。' : errorJa(err));
    } finally {
      setBusy(false);
    }
  }

  const q = t.holds.quietHours;
  const setQuiet = (v: MandateTerms['holds']['quietHours']) => setT({ ...t, holds: { ...t.holds, quietHours: v } });
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-base font-semibold">ルールを変更する</h2>
      <p className="text-sm text-stone-600">
        きびしくする変更はすぐに有効です。ゆるめる変更と見守り人の変更は、一定時間後か見守り人の承認で有効になります。
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {num('everyday', 'registeredPayeeAutoMaxJpy', '円')}
          {num('everyday', 'newPayeeAutoMaxJpy', '円')}
          {num('everyday', 'dailyAutoTotalMaxJpy', '円')}
          {num('contactRequired', 'newPayeeOverJpy', '円')}
          {num('holds', 'holdHours', '時間')}
          {num('holds', 'verifiedPayeeHoldHours', '時間')}
          {num('holds', 'contactDecisionWindowHours', '時間')}
          {num('changes', 'loosenCoolingOffHours', '時間')}
        </div>
        <fieldset className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={q !== null} onChange={(e) => setQuiet(e.target.checked ? { start: '22:00', end: '06:00' } : null)} />
            {FIELD_JA['holds.quietHours']}を設定する
          </label>
          {q && (
            <div className="flex items-center gap-2">
              <input type="time" className="rounded border border-stone-300 px-2 py-1" value={q.start} onChange={(e) => setQuiet({ ...q, start: e.target.value })} />
              〜
              <input type="time" className="rounded border border-stone-300 px-2 py-1" value={q.end} onChange={(e) => setQuiet({ ...q, end: e.target.value })} />
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={t.changes.contactMayCosignLoosening}
              onChange={(e) => setT({ ...t, changes: { ...t.changes, contactMayCosignLoosening: e.target.checked } })}
            />
            {FIELD_JA['changes.contactMayCosignLoosening']}
          </label>
        </fieldset>
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">見守り人</legend>
          {t.contacts.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_8rem_auto] items-end gap-2">
              {(['displayName', 'relation', 'uid'] as const).map((k) => (
                <label key={k}>
                  {{ displayName: 'お名前', relation: '続柄', uid: 'ID' }[k]}
                  <input
                    className={input}
                    required
                    value={c[k]}
                    onChange={(e) => setT({ ...t, contacts: t.contacts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })}
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={t.contacts.length === 1}
                onClick={() => setT({ ...t, contacts: t.contacts.filter((_, j) => j !== i) })}
                className="rounded border border-stone-300 px-2 py-1.5 disabled:opacity-40"
              >
                削除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setT({ ...t, contacts: [...t.contacts, { uid: '', displayName: '', relation: '' }] })}
            className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-100"
          >
            見守り人を追加
          </button>
        </fieldset>
        <label className="block text-sm">
          確認のため、パスワードをもう一度入力してください
          <input type="password" required autoComplete="current-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {msg && <p role="status" className="rounded bg-stone-50 px-3 py-2 text-sm">{msg}</p>}
        <button type="submit" disabled={busy} className="rounded bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50">
          {busy ? '送信中…' : 'この内容で署名する'}
        </button>
      </form>
    </section>
  );
}
