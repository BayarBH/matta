'use client';
import { z } from 'zod';
import { getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const ClientConfig = z.object({
  apiKey: z.string().min(1),
  authDomain: z.string().min(1),
  projectId: z.string().min(1),
  appId: z.string().min(1),
});

/** NEXT_PUBLIC_* must be referenced literally so Next inlines them. */
export function clientAuth(): Auth {
  const app =
    getApps()[0] ??
    initializeApp(
      ClientConfig.parse({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      }),
    );
  return getAuth(app);
}
