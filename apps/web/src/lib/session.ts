'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { UserClaims, type Role } from '@matta/core';
import { clientAuth } from './firebase.client';

export type Session = { user: User; claims: UserClaims };

export const homeFor = (role: Role) => (role === 'contact' ? '/contact' : '/app');

/** Signed-in user + claims; redirects to /login when signed out and to the role's home when not allowed here. */
export function useSession(allowed: Role[]): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const key = allowed.join(',');

  useEffect(
    () =>
      onAuthStateChanged(clientAuth(), async (user) => {
        if (!user) return router.replace('/login');
        const parsed = UserClaims.safeParse((await user.getIdTokenResult()).claims);
        if (!parsed.success) return router.replace('/login');
        if (!key.split(',').includes(parsed.data.role)) return router.replace(homeFor(parsed.data.role));
        setSession({ user, claims: parsed.data });
      }),
    [router, key],
  );
  return session;
}
