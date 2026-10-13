import { loadEnv } from './env';
import { initFirebase } from './firebase';
import { realVerifiers } from './auth';
import { createApp } from './app';
import { log } from './log';

const env = loadEnv();
const { auth } = initFirebase(env);
createApp(env, realVerifiers(env, auth)).listen(env.PORT, () => {
  log('INFO', `demo-bank listening on :${env.PORT}`, { s2sDevInsecure: env.S2S_DEV_INSECURE, nodeEnv: env.NODE_ENV });
});
