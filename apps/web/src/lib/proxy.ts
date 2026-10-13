import { NextResponse } from 'next/server';
import type { z } from 'zod';
import type { Role } from '@matta/core';
import { verifyRequestUser } from './firebase.admin';
import { BankError, callBank } from './bank';
import { log } from './log';

/**
 * Forwards one W+C bank call (lookup, create transfer, get transfer) as sa-web with the user's token.
 * Only these read/create routes exist here — never cancel, decide or settle (governance rule 1).
 */
export async function forwardToBank<B extends z.ZodType, R extends z.ZodType>(
  req: Request,
  opts: { roles: Role[]; path: string; method?: 'GET' | 'POST'; body?: B; res: R },
) {
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!opts.roles.includes(user.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: unknown;
  if (opts.body) {
    const parsed = opts.body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    body = parsed.data;
  }
  try {
    const data = await callBank(opts.path, { method: opts.method ?? 'GET', body, userToken: user.token });
    return NextResponse.json(opts.res.parse(data));
  } catch (e) {
    if (e instanceof BankError) return NextResponse.json(e.body, { status: e.status });
    log('ERROR', 'bank forward failed', { path: opts.path, error: String(e) });
    return NextResponse.json({ error: 'bank_unavailable' }, { status: 502 });
  }
}
