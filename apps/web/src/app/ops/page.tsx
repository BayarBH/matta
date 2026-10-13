'use client';
import { useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { bankFetch, errorJa, post } from '@/lib/bankClient';
import { Nav } from '@/components/Nav';
import { OpsHeader } from '@/components/OpsHeader';

const SANDBOXES = ['sandbox-1', 'sandbox-2', 'sandbox-3'];

export default function OpsPage() {
  const session = useSession(['operator']);
  const [msg, setMsg] = useState<string | null>(null);
  if (!session) return null;

  const reset = async (sid: string) => {
    try {
      await bankFetch(`/demo/sandboxes/${sid}/reset`, post(), z.object({ ok: z.literal(true) }));
      setMsg(`${sid} を初期状態に戻しました。`);
    } catch (e) {
      setMsg(errorJa(e));
    }
  };

  return (
    <main className="space-y-5">
      <Nav role={session.claims.role} />
      <h1 className="text-xl font-semibold">運営</h1>
      <OpsHeader />
      <section className="space-y-2">
        <h2 className="font-medium">サンドボックス</h2>
        {msg && <p className="text-sm text-stone-600">{msg}</p>}
        <ul className="space-y-1 text-sm">
          {SANDBOXES.map((sid) => (
            <li key={sid} className="flex items-center justify-between rounded border border-stone-200 bg-white px-3 py-2">
              <span>{sid}</span>
              <button onClick={() => reset(sid)} className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-50">
                リセット
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-1 text-sm">
        <h2 className="font-medium">評価結果</h2>
        <p className="text-stone-500">評価結果（docs/EVAL.md）は Phase 4 で追加します。</p>
      </section>
    </main>
  );
}
