import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Trigger } from '@matta/core';
import { demoUser } from '@/lib/scenario/auth';
import { findScenario } from '@/lib/scenario/load';
import { fireTrigger, getRun } from '@/lib/scenario/runner';

export const dynamic = 'force-dynamic';

const Body = z.object({ trigger: Trigger, transferId: z.string().optional(), changeId: z.string().optional() });

/** Manual runs: the console reports an event from the human-driven windows; caller lines / contact autopilot react. */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const run = await getRun((await ctx.params).runId);
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const user = await demoUser(req, run.sandboxId);
  if (user instanceof NextResponse) return user;
  const scenario = findScenario(run.scenarioId);
  if (!scenario) return NextResponse.json({ error: 'scenario_not_found' }, { status: 404 });
  const { trigger, ...ids } = body.data;
  return NextResponse.json(await fireTrigger(scenario, run, trigger, ids));
}
