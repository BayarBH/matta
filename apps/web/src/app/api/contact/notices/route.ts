import { NextResponse } from 'next/server';
import { verifyRequestUser } from '@/lib/firebase.admin';
import { firestoreGuardianStore } from '@/lib/guardian/state';

export const dynamic = 'force-dynamic';

/** Contact's own sandbox notices: guarded summary + reason codes only. */
export async function GET(req: Request) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'contact') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ notices: await firestoreGuardianStore().noticesForSandbox(user.sandboxId!) });
}
