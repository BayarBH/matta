import { NextResponse } from 'next/server';
import { verifyRequestUser } from '../firebase.admin';
import { BankError } from '../bank';
import { log } from '../log';
import { ConversationClosed, runStep } from './loop';
import { realDeps } from './deps.server';

/** Shared handler for start / message: customer only; the bank's GET /v1/transfers/:id enforces ownership. */
export async function guardianStep(req: Request, transferId: string, customerText?: string) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'customer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const conv = await runStep(realDeps(), { uid: user.uid, sandboxId: user.sandboxId!, token: user.token }, transferId, customerText);
    return NextResponse.json(conv);
  } catch (e) {
    if (e instanceof ConversationClosed) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof BankError) return NextResponse.json(e.body, { status: e.status });
    log('ERROR', 'guardian step failed', { transferId, error: String(e) });
    return NextResponse.json({ error: 'guardian_error' }, { status: 502 });
  }
}
