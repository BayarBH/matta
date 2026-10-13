'use client';
import { useState } from 'react';
import { z } from 'zod';
import { bankFetch, errorJa, post } from '@/lib/bankClient';

/** DEMO_MODE only: advance the sandbox clock or reset the sandbox (bank enforces DEMO_MODE and sandbox membership). */
export function DemoClock({ sandboxId, onChange }: { sandboxId: string; onChange: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return null;

  async function run(label: string, path: string, body?: unknown) {
    setMsg(`${label}…`);
    try {
      await bankFetch(`/demo/sandboxes/${sandboxId}/${path}`, post(body), z.unknown());
      setMsg(`${label}しました。`);
      onChange();
    } catch (e) {
      setMsg(errorJa(e));
    }
  }

  const btn = 'rounded border border-stone-300 bg-white px-2.5 py-1 hover:bg-stone-100';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3 text-xs">
      <span className="font-medium text-stone-600">デモ時計</span>
      {([1, 24, 72] as const).map((h) => (
        <button key={h} className={btn} onClick={() => run(`${h}時間進め`, 'clock', { hours: h })}>
          +{h}時間
        </button>
      ))}
      <button className={btn} onClick={() => run('リセット', 'reset')}>
        サンドボックスをリセット
      </button>
      {msg && <span className="text-stone-500">{msg}</span>}
    </div>
  );
}
