import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SandboxId } from '@matta/core';
import { demoUser } from '@/lib/scenario/auth';
import { findScenario } from '@/lib/scenario/load';
import { startRun } from '@/lib/scenario/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({ sandboxId: SandboxId, autopilotVictim: z.boolean(), autopilotContact: z.boolean(), runId: z.string().uuid().optional() });

/** Start a scenario run. With the victim autopilot on, the response returns when the run has finished. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const user = await demoUser(req, body.data.sandboxId);
  if (user instanceof NextResponse) return user;
  const scenario = findScenario((await ctx.params).id);
  if (!scenario) return NextResponse.json({ error: 'scenario_not_found' }, { status: 404 });
  const { sandboxId, runId, ...opts } = body.data;
  // The console mints runId so it can poll the run while this request is still executing.
  const state = await startRun(scenario, sandboxId, opts, runId);
  return NextResponse.json({ runId: state.id, ...state });
}
