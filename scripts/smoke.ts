// Cloud-only checks after a deploy. Usage: pnpm smoke [WEB_URL] [BANK_URL]  (or env WEB_URL / BANK_URL)
// Passwords from ./.env.local, Firebase apiKey from apps/web/.env.local. Exits 1 on any ❌.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const root = parseEnv(readFileSync('.env.local', 'utf8'));
const web = parseEnv(readFileSync('apps/web/.env.local', 'utf8'));
const NUM = '760253059957';
const WEB_URL = process.argv[2] ?? process.env.WEB_URL ?? `https://matta-web-${NUM}.asia-northeast1.run.app`;
const BANK_URL = process.argv[3] ?? process.env.BANK_URL ?? `https://matta-bank-${NUM}.asia-northeast1.run.app`;
const API_KEY = web.NEXT_PUBLIC_FIREBASE_API_KEY;

let failed = false;
async function check(name: string, fn: () => Promise<string | true>) {
  try {
    const r = await fn();
    if (r !== true) throw new Error(r);
    console.log(`✅ ${name}`);
  } catch (e) {
    failed = true;
    console.log(`❌ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function signIn(user: string, password: string | undefined): Promise<string> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${user}@matta-demo.example`, password, returnSecureToken: true }),
  });
  const j = (await r.json()) as { idToken?: string; error?: { message: string } };
  if (!j.idToken) throw new Error(`sign-in ${user}: ${j.error?.message ?? r.status}`);
  return j.idToken;
}

const preflight = (origin: string) =>
  fetch(`${BANK_URL}/v1/transfers/x/contact-decision`, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-user-token' },
  });

console.log(`web=${WEB_URL}\nbank=${BANK_URL}`);
const tokens: Record<string, string> = {};

await check('bank /health', async () => ((await fetch(`${BANK_URL}/health`)).ok ? true : 'not ok'));
await check('web /login loads', async () => ((await fetch(`${WEB_URL}/login`)).ok ? true : 'not ok'));
await check('bank /v1/health/secure without token → 401', async () => {
  const s = (await fetch(`${BANK_URL}/v1/health/secure`)).status;
  return s === 401 ? true : `got ${s}`;
});
for (const [u, p] of [
  ['customer-1', root.SEED_PASSWORD_CUSTOMER],
  ['contact-1', root.SEED_PASSWORD_CONTACT],
  ['operator', root.SEED_PASSWORD_OPERATOR],
] as const) {
  await check(`sign in ${u}`, async () => {
    tokens[u] = await signIn(u, p);
    return true;
  });
}
await check('web → bank with a real Google ID token (caller = sa-web)', async () => {
  const r = await fetch(`${WEB_URL}/api/debug/bank`, { headers: { authorization: `Bearer ${tokens.operator}` } });
  const j = (await r.json()) as { bank?: { caller?: { kind: string; email: string } }; error?: string };
  const c = j.bank?.caller;
  return c?.kind === 'service' && c.email.startsWith('sa-web@') ? true : `${r.status} ${JSON.stringify(j)}`;
});
await check('web (sa-web) cannot read the bank database', async () => {
  const r = await fetch(`${WEB_URL}/api/debug/bank`, { headers: { authorization: `Bearer ${tokens.operator}` } });
  const j = (await r.json()) as { webReadingBankDb?: string };
  return j.webReadingBankDb === 'denied' ? true : `webReadingBankDb=${j.webReadingBankDb}`;
});
await check('customer-1 GET bank /v1/me', async () => {
  const r = await fetch(`${BANK_URL}/v1/me`, { headers: { 'x-user-token': tokens['customer-1'] ?? '' } });
  const j = (await r.json()) as { role?: string };
  return j.role === 'customer' ? true : `${r.status} ${JSON.stringify(j)}`;
});
await check('contact-1 GET bank /v1/contact/inbox', async () => {
  const r = await fetch(`${BANK_URL}/v1/contact/inbox`, { headers: { 'x-user-token': tokens['contact-1'] ?? '' } });
  return r.ok ? true : `${r.status}`;
});
await check('CORS preflight from WEB_URL to contact-decision allowed', async () => {
  const o = (await preflight(WEB_URL)).headers.get('access-control-allow-origin');
  return o === WEB_URL ? true : `allow-origin=${o}`;
});
await check('CORS preflight from another origin not allowed', async () => {
  const o = (await preflight('https://evil.example')).headers.get('access-control-allow-origin');
  return o === null || o !== 'https://evil.example' ? true : `allow-origin=${o}`;
});

process.exit(failed ? 1 : 0);
