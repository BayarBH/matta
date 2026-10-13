import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuditEvent } from '@matta/core';
import { db, verifyRequestUser } from '@/lib/firebase.admin';
import { BankError, callBank } from '@/lib/bank';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const BankOpsMetrics = z.object({
  byStatus: z.record(z.string(), z.number()),
  byRule: z.record(z.string(), z.number()),
  openHolds: z.number(),
  contactRequired: z.number(),
  medianAddedDelayMinLegit: z.number().nullable(),
});

/** Lenient read of the guardian's own docs (owned and written by the guardian module). */
const Conversation = z.object({ escalated: z.boolean().optional(), failSafe: z.boolean().optional() }).passthrough();
const GuardianConfig = z.object({ paused: z.boolean().default(false), recent: z.array(z.boolean()).default([]) }).passthrough();

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Operator-only ops header numbers: bank tiers (via the bank) + guardian health (web Firestore). */
export async function GET(req: Request) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'operator') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const bank = BankOpsMetrics.parse(await callBank('/v1/ops/metrics', { userToken: user.token }));
    // ponytail: full collection scans; fine at demo scale (3 sandboxes), aggregate counters if it grows.
    const [convSnap, auditSnap, cfgDoc] = await Promise.all([
      db().collection('conversations').get(),
      db().collection('auditEvents').where('actor', 'in', ['guardian', 'reader']).get(),
      db().collection('config').doc('guardian').get(),
    ]);
    const convs = convSnap.docs.map((d) => Conversation.parse(d.data()));
    const llmEvents = auditSnap.docs.map((d) => AuditEvent.parse(d.data()));
    const guardianEvents = llmEvents.filter((e) => e.actor === 'guardian');
    const cfg = GuardianConfig.parse(cfgDoc.data() ?? {});
    const recent = cfg.recent.slice(-20); // true = the call errored
    // Cost per guarded transfer = guardian + reader LLM spend / guarded transfers (estimate, config/pricing.ts).
    const costs = llmEvents.map((e) => e.estCostJpy).filter((x): x is number => x !== undefined);

    return NextResponse.json({
      bank,
      guardian: {
        guardedTransfers: convs.length,
        escalations: convs.filter((c) => c.escalated).length,
        failSafes: convs.filter((c) => c.failSafe).length,
        errorRate: recent.length ? recent.filter(Boolean).length / recent.length : null,
        paused: cfg.paused,
        medianLatencyMs: median(guardianEvents.map((e) => e.latencyMs).filter((x): x is number => x !== undefined)),
        estCostPerGuardedJpy: costs.length && convs.length ? costs.reduce((a, b) => a + b, 0) / convs.length : null,
      },
    });
  } catch (e) {
    if (e instanceof BankError) return NextResponse.json(e.body, { status: e.status });
    log('ERROR', 'ops metrics failed', { error: String(e) });
    return NextResponse.json({ error: 'metrics_unavailable' }, { status: 502 });
  }
}
