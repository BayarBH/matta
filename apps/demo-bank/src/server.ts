import { loadPolicy } from '@matta/core/node';
import { loadEnv } from './env';
import { initFirebase } from './firebase';
import { realVerifiers } from './auth';
import { createApp } from './app';
import { evaluateSandbox, type Ctx } from './bank';
import { firestoreStore } from './store';
import { cloudTasksEnqueuer } from './tasks';
import { log } from './log';

const env = loadEnv();
const { auth, db } = initFirebase(env);
const { policyHash } = loadPolicy(env.POLICY_PATH);
const ctx: Ctx = {
  env,
  store: firestoreStore(db),
  policyHash,
  ...(env.TASKS_MODE === 'cloud' ? { enqueueHold: cloudTasksEnqueuer(env) } : {}),
};

if (env.TASKS_MODE === 'inline') {
  // ponytail: polls every sandbox every 30 s; fine for 3 sandboxes, Cloud Tasks replaces it in the cloud.
  setInterval(async () => {
    try {
      for (const d of await ctx.store.all('sandboxes')) await evaluateSandbox(ctx, String(d.id));
    } catch (e) {
      log('ERROR', 'inline hold evaluation failed', { error: String(e) });
    }
  }, 30_000);
}

createApp(ctx, realVerifiers(env, auth)).listen(env.PORT, () => {
  log('INFO', `demo-bank listening on :${env.PORT}`, {
    s2sDevInsecure: env.S2S_DEV_INSECURE,
    nodeEnv: env.NODE_ENV,
    tasksMode: env.TASKS_MODE,
    demoMode: env.DEMO_MODE,
    policyHash,
  });
});
