import { NextResponse } from 'next/server';
import { Transfer } from '@matta/core';
import { verifyRequestUser } from '@/lib/firebase.admin';
import { BankError, callBank } from '@/lib/bank';
import { firestoreGuardianStore } from '@/lib/guardian/state';

export const dynamic = 'force-dynamic';

/** The customer's own conversation (never the model history or the assessment). */
export async function GET(req: Request, ctx: { params: Promise<{ transferId: string }> }) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'customer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { transferId } = await ctx.params;
  try {
    Transfer.parse(await callBank(`/v1/transfers/${transferId}`, { userToken: user.token })); // ownership check by the bank
  } catch (e) {
    if (e instanceof BankError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: 'bank_unavailable' }, { status: 502 });
  }
  const store = firestoreGuardianStore();
  const [conv, breaker] = await Promise.all([store.loadConversation(transferId), store.getBreaker()]);
  if (!conv || conv.customerUid !== user.uid) return NextResponse.json({ conversation: null, paused: breaker.paused });
  const { contentsJson: _c, assessment: _a, ...rest } = conv;
  return NextResponse.json({ conversation: { ...rest, paused: breaker.paused }, paused: breaker.paused });
}
