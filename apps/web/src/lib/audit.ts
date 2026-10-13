import { randomUUID } from 'node:crypto';
import { AuditEvent } from '@matta/core';
import { db } from './firebase.admin';
import { log } from './log';

/** Writes a web-side AuditEvent to `auditEvents` (web Firestore DB). Server only. */
export async function writeAudit(e: Omit<AuditEvent, 'id' | 'ts' | 'service'>): Promise<void> {
  const ev = AuditEvent.parse({ ...e, id: randomUUID(), ts: new Date().toISOString(), service: 'web' });
  log('INFO', `audit ${ev.action}`, { audit: ev });
  // Firestore rejects `undefined` fields (e.g. estCostJpy for an unpriced model): drop them.
  await db().collection('auditEvents').doc(ev.id).set(JSON.parse(JSON.stringify(ev)));
}
