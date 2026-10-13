import { NextResponse } from 'next/server';
import { CreateTransferBody, LookupResult, Transfer } from '@matta/core';
import { verifyRequestUser } from '@/lib/firebase.admin';
import { BankError, callBank } from '@/lib/bank';
import { readFields } from '@/lib/reader';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

// The browser can't supply readerFlags; they come only from the quarantined reader below.
const Body = CreateTransferBody.omit({ readerFlags: true });

/** Create a transfer (W+C): look up the holder name, run the quarantined reader, forward with its flags. */
export async function POST(req: Request) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'customer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const body = parsed.data;
  try {
    const { bankCode, branchCode, accountNumber } = body;
    const lookup = LookupResult.parse(
      await callBank('/v1/directory/lookup', { method: 'POST', body: { bankCode, branchCode, accountNumber }, userToken: user.token }),
    );
    if (!lookup.found) return NextResponse.json({ error: 'payee_not_found' }, { status: 404 });
    const readerFlags = await readFields(
      { payeeName: lookup.holderNameKana ?? '', memo: body.memo },
      { sandboxId: user.sandboxId!, actor: `customer:${user.uid}` },
    );
    const t = Transfer.parse(await callBank('/v1/transfers', { method: 'POST', body: { ...body, readerFlags }, userToken: user.token }));
    return NextResponse.json(t);
  } catch (e) {
    if (e instanceof BankError) return NextResponse.json(e.body, { status: e.status });
    log('ERROR', 'create transfer failed', { error: String(e) });
    return NextResponse.json({ error: 'bank_unavailable' }, { status: 502 });
  }
}
