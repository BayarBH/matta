import { NextResponse } from 'next/server';
import { SecureHealth } from '@matta/core';
import { verifyRequestUser } from '@/lib/firebase.admin';
import { callBank } from '@/lib/bank';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Operator-only: proves web → bank service identity. */
export async function GET(req: Request) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'operator') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const bank = SecureHealth.parse(await callBank('/v1/health/secure'));
    return NextResponse.json({ bank });
  } catch (e) {
    log('ERROR', 'debug bank call failed', { error: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
