import { CloudTasksClient } from '@google-cloud/tasks';
import type { BankEnv } from './env';
import type { StoredTransfer } from './bank';
import { log } from './log';

/** Cloud mode: one HTTP task per held transfer, delivered at holdUntil (real time) with an OIDC token as sa-bank. */
export function cloudTasksEnqueuer(env: BankEnv) {
  const client = new CloudTasksClient();
  return async (t: StoredTransfer, clockOffsetMs: number) => {
    const dueMs = new Date(t.holdUntil!).getTime() - clockOffsetMs;
    const [task] = await client.createTask({
      parent: env.TASKS_QUEUE!,
      task: {
        scheduleTime: { seconds: Math.ceil(Math.max(dueMs, Date.now()) / 1000) },
        httpRequest: {
          url: new URL('/internal/holds/evaluate', env.BANK_URL).toString(),
          httpMethod: 'POST',
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify({ sandboxId: t.sandboxId })),
          oidcToken: { serviceAccountEmail: env.TASKS_SA_EMAIL!, audience: env.BANK_URL },
        },
      },
    });
    log('INFO', 'hold evaluation enqueued', { transferId: t.id, task: task.name });
  };
}
