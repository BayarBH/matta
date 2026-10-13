import { NextResponse } from 'next/server';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SecureHealth } from '@matta/core';
import { verifyRequestUser } from '@/lib/firebase.admin';
import { callBank } from '@/lib/bank';
import { env } from '@/lib/env.server';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Tries to read the bank's database as this service's identity; it must be denied (IAM separation). */
async function bankDbProbe(): Promise<'denied' | 'READABLE' | string> {
  const app = getApps()[0] ?? initializeApp({ projectId: env().GOOGLE_CLOUD_PROJECT });
  const bankDb = env().NODE_ENV === 'production' ? 'bank' : 'bank-dev';
  try {
    await getFirestore(app, bankDb).collection('accounts').limit(1).get();
    return 'READABLE';
  } catch (e) {
    return /PERMISSION_DENIED|7 /.test(String(e)) ? 'denied' : `error: ${String(e).slice(0, 120)}`;
  }
}

/** Operator-only: proves web → bank service identity, and that the web cannot touch bank data. */
export async function GET(req: Request) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'operator') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const bank = SecureHealth.parse(await callBank('/v1/health/secure'));
    return NextResponse.json({ bank, webReadingBankDb: await bankDbProbe() });
  } catch (e) {
    log('ERROR', 'debug bank call failed', { error: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
