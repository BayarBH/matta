'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'firebase/auth';
import type { Role } from '@matta/core';
import { clientAuth } from '@/lib/firebase.client';

const LINKS: Array<{ href: string; label: string; roles: Role[] }> = [
  { href: '/app', label: '振込', roles: ['customer', 'operator'] },
  { href: '/rules', label: '見守りルール', roles: ['customer', 'contact'] },
  { href: '/contact', label: '見守り人', roles: ['contact'] },
  { href: '/ops', label: '運営', roles: ['operator'] },
  ...(process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
    ? [{ href: '/demo', label: 'デモ', roles: ['customer', 'operator'] as Role[] }]
    : []),
  { href: '/guide', label: 'ガイド', roles: ['customer', 'contact', 'operator'] },
];

export function Nav({ role }: { role: Role }) {
  const path = usePathname();
  return (
    <nav className="mb-5 flex flex-wrap items-center gap-1 border-b border-stone-200 pb-2 text-sm">
      {LINKS.filter((l) => l.roles.includes(role)).map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded px-3 py-1.5 ${path === l.href ? 'bg-teal-700 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
        >
          {l.label}
        </Link>
      ))}
      <button onClick={() => signOut(clientAuth())} className="ml-auto px-2 py-1.5 text-stone-500 underline underline-offset-2">
        ログアウト
      </button>
    </nav>
  );
}
