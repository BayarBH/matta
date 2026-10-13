'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { UserClaims } from '@matta/core';
import { clientAuth } from '@/lib/firebase.client';

const ROLE_JA = { customer: '預金者', contact: '見守り人', operator: 'デモ運営' } as const;

export default function AppPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<UserClaims | null>(null);
  const [debug, setDebug] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(clientAuth(), async (u) => {
        if (!u) return router.replace('/login');
        setUser(u);
        const parsed = UserClaims.safeParse((await u.getIdTokenResult()).claims);
        setClaims(parsed.success ? parsed.data : null);
      }),
    [router],
  );

  async function checkBank() {
    if (!user) return;
    setDebug('確認中…');
    const res = await fetch('/api/debug/bank', { headers: { authorization: `Bearer ${await user.getIdToken()}` } });
    setDebug(JSON.stringify(await res.json(), null, 2));
  }

  if (!user) return <p className="text-sm text-stone-500">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 rounded-lg border border-stone-200 bg-white p-4 text-sm">
        <dt className="text-stone-500">メール</dt>
        <dd>{user.email}</dd>
        <dt className="text-stone-500">役割</dt>
        <dd>{claims ? ROLE_JA[claims.role] : '未設定'}</dd>
        <dt className="text-stone-500">サンドボックス</dt>
        <dd>{claims?.sandboxId ?? '—'}</dd>
      </dl>

      {claims?.role === 'operator' && (
        <div className="space-y-2">
          <button onClick={checkBank} className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100">
            銀行との接続を確認
          </button>
          {debug && <pre className="overflow-x-auto rounded bg-stone-900 p-3 text-xs text-stone-100">{debug}</pre>}
        </div>
      )}

      <button
        onClick={() => signOut(clientAuth())}
        className="text-sm text-stone-600 underline underline-offset-2"
      >
        ログアウト
      </button>
    </div>
  );
}
