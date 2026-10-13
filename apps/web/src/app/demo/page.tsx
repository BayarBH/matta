'use client';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Transfer } from '@matta/core';
import { useSession } from '@/lib/session';
import { ApiError, bankFetch, errorJa, post, webFetch } from '@/lib/bankClient';
import { Nav } from '@/components/Nav';
import { TransferFacts } from '@/components/TransferFacts';
import { resetSandbox } from '@/components/DemoClock';

/** Curated scenarios exposed in the console (SPEC §10). Extend as the scenario runner adds them. */
const SCENARIOS = [{ id: 'S1', titleJa: 'S1 ニセ警察（指示を受けながらの振込）' }];
const SANDBOXES = ['sandbox-1', 'sandbox-2', 'sandbox-3'];

const RunEvent = z.object({ ts: z.string(), kind: z.enum(['caller', 'victim', 'contact', 'system']), textJa: z.string() });
const Run = z.object({ id: z.string(), sandboxId: z.string(), scenarioId: z.string(), status: z.string(), events: z.array(RunEvent) });
type Run = z.infer<typeof Run>;

const panel = 'flex min-h-[28rem] flex-col rounded-xl border bg-white';
const panelHead = 'border-b px-4 py-2 text-sm font-semibold';
const btn = 'rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50';

export default function DemoPage() {
  const session = useSession(['customer', 'operator']);
  const isOperator = session?.claims.role === 'operator';
  const [opSid, setOpSid] = useState(SANDBOXES[0]!);
  const sid = session && session.claims.role === 'customer' ? session.claims.sandboxId : opSid;

  const [scenario, setScenario] = useState(SCENARIOS[0]!.id);
  const [victimAuto, setVictimAuto] = useState(false);
  const [contactAuto, setContactAuto] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bumps live panels after clock/reset

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await webFetch(`/api/demo/runs/${runId}`, {}, Run);
        if (alive) setRun(r);
      } catch (e) {
        if (alive && e instanceof ApiError && e.status === 404) setMsg('シナリオ実行の記録が見つかりません。');
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runId]);

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return <p className="text-sm text-stone-500">デモモードではありません。</p>;
  if (!session) return <p className="text-sm text-stone-500">読み込み中…</p>;

  async function start() {
    setMsg('シナリオを開始しています…');
    setRun(null);
    try {
      const r = await webFetch(
        `/api/demo/scenarios/${scenario}/run`,
        post({ sandboxId: sid, autopilotVictim: victimAuto, autopilotContact: contactAuto }),
        z.object({ runId: z.string() }),
      );
      setRunId(r.runId);
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 404 ? 'シナリオ実行機能はまだ準備中です。' : errorJa(e));
    }
  }

  async function clock(hours: 1 | 24 | 72) {
    try {
      await bankFetch(`/demo/sandboxes/${sid}/clock`, post({ hours }), z.object({ now: z.string() }));
      setMsg(`時計を${hours}時間進めました。`);
      setTick((t) => t + 1);
    } catch (e) {
      setMsg(errorJa(e));
    }
  }

  async function reset() {
    try {
      await resetSandbox(sid);
      setRunId(null);
      setRun(null);
      setMsg(`${sid} を初期状態に戻しました。`);
      setTick((t) => t + 1);
    } catch (e) {
      setMsg(errorJa(e));
    }
  }

  return (
    // Break out of the layout's narrow column: the console needs three panels side by side.
    <div className="relative left-1/2 w-[calc(100vw-2rem)] max-w-7xl -translate-x-1/2 space-y-4">
      <Nav role={session.claims.role} />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">デモコンソール</h1>
        <p className="text-sm text-stone-600">
          レッドチーム・シミュレーションはすべて架空です。電話の内容は、警察が公開している手口を言い換えた台本です。
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm">
        {isOperator && (
          <select value={opSid} onChange={(e) => setOpSid(e.target.value)} className="rounded border border-stone-300 px-2 py-1.5" aria-label="サンドボックス">
            {SANDBOXES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} className="rounded border border-stone-300 px-2 py-1.5" aria-label="シナリオ">
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.titleJa}
            </option>
          ))}
        </select>
        <button onClick={start} className="rounded bg-teal-700 px-3 py-1.5 text-white hover:bg-teal-800">
          シナリオ開始
        </button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={victimAuto} onChange={(e) => setVictimAuto(e.target.checked)} />
          預金者：自動シミュレーション
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={contactAuto} onChange={(e) => setContactAuto(e.target.checked)} />
          見守り人：自動シミュレーション
        </label>
        <span className="mx-1 h-5 w-px bg-stone-200" />
        {([1, 24, 72] as const).map((h) => (
          <button key={h} onClick={() => clock(h)} className={btn}>
            +{h}時間
          </button>
        ))}
        <button onClick={reset} className={btn}>
          サンドボックスをリセット
        </button>
        {msg && <span className="text-stone-600">{msg}</span>}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <CallPanel run={run} />
        <section className={`${panel} border-stone-200`}>
          <h2 className={panelHead}>預金者のアプリ（{sid}）</h2>
          {isOperator ? (
            <p className="p-4 text-sm text-stone-500">預金者の画面は、2つ目のウィンドウで customer-{sid.slice(-1)} としてログインするとご覧いただけます。</p>
          ) : (
            <iframe key={tick} src="/app" title="預金者のアプリ" className="h-[40rem] w-full flex-1 rounded-b-xl" />
          )}
        </section>
        <ContactMirror enabled={!isOperator} tick={tick} sid={sid} />
      </div>
    </div>
  );
}

function CallPanel({ run }: { run: Run | null }) {
  return (
    <section className={`${panel} border-rose-200`}>
      <h2 className={`${panelHead} border-rose-100 bg-rose-50 text-rose-950`}>通話中（レッドチーム・シミュレーション／架空）</h2>
      <p className="px-4 pt-2 text-xs text-stone-500">発信元：＋国際番号（架空）</p>
      <ol className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
        {!run && <li className="text-stone-500">シナリオを開始すると、架空の電話の内容がここに表示されます。</li>}
        {run?.events.map((e, i) => (
          <li key={i} className={e.kind === 'victim' ? 'flex justify-end' : e.kind === 'caller' ? 'flex' : 'flex justify-center'}>
            <p
              className={
                e.kind === 'caller'
                  ? 'max-w-[85%] rounded-2xl rounded-tl-sm bg-rose-100 px-3 py-2 text-rose-950'
                  : e.kind === 'victim'
                    ? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-stone-100 px-3 py-2'
                    : 'max-w-[90%] text-center text-xs text-stone-500'
              }
            >
              {e.kind === 'caller' && <span className="mb-0.5 block text-[10px] text-rose-800/70">電話の相手（架空）</span>}
              {e.kind === 'contact' && '見守り人：'}
              {e.textJa}
            </p>
          </li>
        ))}
      </ol>
      {run && <p className="border-t px-4 py-2 text-xs text-stone-500">状態：{run.status}</p>}
    </section>
  );
}

/** Read-only mirror of what the contact sees, built from the customer's own transfers (the contact inbox needs the contact's login). */
function ContactMirror({ enabled, tick, sid }: { enabled: boolean; tick: number; sid: string }) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const refresh = useCallback(async () => {
    const r = await bankFetch('/v1/transfers', {}, z.object({ transfers: z.array(Transfer) })).catch(() => null);
    if (r) setTransfers(r.transfers.filter((t) => t.status === 'contact_required' || t.status === 'held' || t.decision));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [enabled, refresh, tick]);

  return (
    <section className={`${panel} border-teal-200`}>
      <h2 className={`${panelHead} border-teal-100 bg-teal-50 text-teal-950`}>見守り人の画面（ライブ表示）</h2>
      <p className="px-4 pt-2 text-xs text-stone-500">
        承認・不承認は、2つ目のウィンドウで contact-{sid.slice(-1)} としてログインするか、「見守り人：自動シミュレーション」で行います。
      </p>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!enabled && <p className="text-sm text-stone-500">見守り人の画面は contact-{sid.slice(-1)} のログインでご覧いただけます。</p>}
        {enabled && transfers.length === 0 && <p className="text-sm text-stone-500">確認を待っている振込はありません。</p>}
        {transfers.map((t) => (
          <div key={t.id} className="space-y-1">
            <TransferFacts t={t} />
            {t.decision && (
              <p className="rounded bg-stone-50 px-3 py-2 text-sm">
                見守り人の判断：{t.decision.decision === 'approve' ? '承認' : '承認しない'}（{t.decision.reasonJa}）
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
