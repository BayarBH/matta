import { NextResponse } from 'next/server';
import { demoUser } from '@/lib/scenario/auth';
import { getRun } from '@/lib/scenario/runner';

export const dynamic = 'force-dynamic';

/** Run state for the /demo console (polled). Contacts of the sandbox may watch. */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const run = await getRun((await ctx.params).runId);
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const user = await demoUser(req, run.sandboxId, ['customer', 'contact']);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(run);
}
