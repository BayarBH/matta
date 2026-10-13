import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SandboxId } from '@matta/core';
import { db, verifyRequestUser } from '@/lib/firebase.admin';
import { BankError, callBank } from '@/lib/bank';
import { env } from '@/lib/env.server';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const Body = z.object({ sandboxId: SandboxId });
/** Web-side collections keyed by sandbox; cleared so a reset leaves no stale conversations or notices. */
const WEB_COLLECTIONS = ['conversations', 'contactNotices', 'scenarioRuns', 'auditEvents'];

/** DEMO_MODE: reset one sandbox in the bank (bank checks O | C of that sandbox), then clear its web data. */
export async function POST(req: Request) {
  if (!env().DEMO_MODE) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const sid = parsed.data.sandboxId;
  if (!(user.role === 'operator' || (user.role === 'customer' && user.sandboxId === sid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    await callBank(`/demo/sandboxes/${sid}/reset`, { method: 'POST', body: {}, userToken: user.token });
  } catch (e) {
    if (e instanceof BankError) return NextResponse.json(e.body, { status: e.status });
    log('ERROR', 'bank reset failed', { sid, error: String(e) });
    return NextResponse.json({ error: 'bank_unavailable' }, { status: 502 });
  }

  let deleted = 0;
  for (const c of WEB_COLLECTIONS) {
    const snap = await db().collection(c).where('sandboxId', '==', sid).get();
    // ponytail: one batch per collection (≤500 docs); demo sandboxes stay far below that.
    const batch = db().batch();
    snap.docs.slice(0, 500).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(snap.size, 500);
  }
  log('INFO', 'sandbox reset', { sid, by: `${user.role}:${user.uid}`, webDocsDeleted: deleted });
  return NextResponse.json({ ok: true, webDocsDeleted: deleted });
}
