import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuditEvent } from '@matta/core';
import { db, verifyRequestUser } from '@/lib/firebase.admin';
import { BankError, callBank } from '@/lib/bank';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Black box: bank + web audit events for one transfer, merged in time order. Customer (own sandbox) or operator. */
export async function GET(req: Request, { params }: { params: Promise<{ transferId: string }> }) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'customer' && user.role !== 'operator') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { transferId } = await params;

  try {
    // The bank enforces the customer's sandbox on its own events.
    const bank = z
      .object({ events: z.array(AuditEvent) })
      .parse(await callBank(`/v1/audit?transferId=${encodeURIComponent(transferId)}`, { userToken: user.token })).events;
    const snap = await db().collection('auditEvents').where('targetId', '==', transferId).get();
    let web = snap.docs.map((d) => AuditEvent.parse(d.data()));
    if (user.role === 'customer') web = web.filter((e) => e.sandboxId === user.sandboxId);
    const events = [...bank, ...web].sort((a, b) => a.ts.localeCompare(b.ts));
    return NextResponse.json({ events });
  } catch (e) {
    if (e instanceof BankError) return NextResponse.json(e.body, { status: e.status });
    log('ERROR', 'audit fetch failed', { transferId, error: String(e) });
    return NextResponse.json({ error: 'audit_unavailable' }, { status: 502 });
  }
}
