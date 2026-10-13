import { z } from 'zod';
import { Assessment, ReasonCode } from '@matta/core';
import { db } from '../firebase.admin';

export const Message = z.object({ role: z.enum(['guardian', 'customer', 'system']), textJa: z.string(), ts: z.string() });
export type Message = z.infer<typeof Message>;

export const Resource = z.enum(['police_9110', 'bank_official']);

/** The four teller checks (SPEC §6 examples); counted by code to gate end_conversation on held transfers. */
export const TellerCheck = z.enum(['purpose', 'payee_source', 'on_call', 'secrecy_or_script']);
export type TellerCheck = z.infer<typeof TellerCheck>;
export const MIN_TELLER_CHECKS = 3;

/** `conversations/{transferId}`. `contentsJson` is the Gemini history (kept opaque: it carries thought signatures). */
export const Conversation = z.object({
  transferId: z.string(),
  sandboxId: z.string(),
  customerUid: z.string(),
  status: z.enum(['open', 'closed']),
  messages: z.array(Message),
  turnsUsed: z.number().int(),
  assessment: Assessment.optional(),
  escalated: z.boolean(),
  failSafe: z.boolean(),
  resources: z.array(Resource).default([]),
  checks: z.array(TellerCheck).default([]),
  contentsJson: z.string().default('[]'),
});
export type Conversation = z.infer<typeof Conversation>;

/** What the browser gets: no model history. */
export const ConversationView = Conversation.omit({ contentsJson: true, assessment: true }).extend({ paused: z.boolean() });
export type ConversationView = z.infer<typeof ConversationView>;

/** `contactNotices/{id}` — read by /contact. */
export const ContactNotice = z.object({
  id: z.string(),
  sandboxId: z.string(),
  transferId: z.string(),
  summaryJa: z.string(),
  reasonCodes: z.array(ReasonCode),
  createdAt: z.string(),
});
export type ContactNotice = z.infer<typeof ContactNotice>;

/** `config/guardian` — circuit breaker. `recent` = last 20 model calls, true = the call ERRORED (read by /api/ops). */
export const Breaker = z.object({ paused: z.boolean(), pausedAt: z.string().nullable().default(null), recent: z.array(z.boolean()) });
export type Breaker = z.infer<typeof Breaker>;

export type GuardianStore = {
  loadConversation(transferId: string): Promise<Conversation | null>;
  saveConversation(c: Conversation): Promise<void>;
  /** Insert or replace a notice by id. */
  putNotice(n: ContactNotice): Promise<void>;
  noticesForSandbox(sandboxId: string): Promise<ContactNotice[]>;
  getBreaker(): Promise<Breaker>;
  setBreaker(b: Breaker): Promise<void>;
};

export function firestoreGuardianStore(): GuardianStore {
  const d = () => db();
  return {
    async loadConversation(id) {
      const s = await d().collection('conversations').doc(id).get();
      return s.exists ? Conversation.parse(s.data()) : null;
    },
    async saveConversation(c) {
      await d().collection('conversations').doc(c.transferId).set(JSON.parse(JSON.stringify(c)));
    },
    async putNotice(n) {
      await d().collection('contactNotices').doc(n.id).set(n);
    },
    async noticesForSandbox(sid) {
      const q = await d().collection('contactNotices').where('sandboxId', '==', sid).get();
      return q.docs.map((x) => ContactNotice.parse(x.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getBreaker() {
      const s = await d().collection('config').doc('guardian').get();
      return s.exists ? Breaker.parse(s.data()) : { paused: false, pausedAt: null, recent: [] };
    },
    async setBreaker(b) {
      await d().collection('config').doc('guardian').set(b);
    },
  };
}
