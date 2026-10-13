import { GoogleAuth } from 'google-auth-library';
import { s2sBypassAllowed } from '@matta/core';
import { env } from './env.server';
import { log } from './log';

const googleAuth = new GoogleAuth();

/** Non-2xx from the bank; status and body are passed through to the browser as-is. */
export class BankError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`bank -> ${status}`);
  }
}

/** Google ID token for the bank (audience = BANK_URL), or none under the dev bypass. */
async function serviceToken(): Promise<string | undefined> {
  const e = env();
  if (s2sBypassAllowed(e.NODE_ENV, e.S2S_DEV_INSECURE)) return undefined;
  const client = await googleAuth.getIdTokenClient(e.BANK_URL);
  return client.idTokenProvider.fetchIdToken(e.BANK_URL);
}

/** Calls the bank as sa-web; the customer/contact Firebase ID token rides in `X-User-Token`. Returns unparsed JSON — parse with zod at the call site. */
export async function callBank(
  path: string,
  opts: { method?: string; body?: unknown; userToken?: string } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {};
  const token = await serviceToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.userToken) headers['x-user-token'] = opts.userToken;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(new URL(path, env().BANK_URL), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
  });
  if (!res.ok) {
    log('WARNING', 'bank call failed', { path, status: res.status });
    throw new BankError(res.status, await res.json().catch(() => ({ error: 'bank_error' })));
  }
  return res.json();
}
