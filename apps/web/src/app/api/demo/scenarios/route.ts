import { NextResponse } from 'next/server';
import { env } from '@/lib/env.server';
import { verifyRequestUser } from '@/lib/firebase.admin';
import { loadScenarios } from '@/lib/scenario/load';

export const dynamic = 'force-dynamic';

/** Scenario list for the /demo console (titles only; scripts stay server-side). */
export async function GET(req: Request) {
  if (!env().DEMO_MODE) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const user = await verifyRequestUser(req);
  if (!user || user.role === 'contact') return NextResponse.json({ error: 'forbidden' }, { status: user ? 403 : 401 });
  return NextResponse.json({ scenarios: loadScenarios().map(({ id, set, kind, titleJa }) => ({ id, set, kind, titleJa })) });
}
