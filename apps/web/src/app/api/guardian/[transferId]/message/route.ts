import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardianStep } from '@/lib/guardian/route.server';

export const dynamic = 'force-dynamic';

const Body = z.object({ textJa: z.string().trim().min(1).max(400) });

export async function POST(req: Request, ctx: { params: Promise<{ transferId: string }> }) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  return guardianStep(req, (await ctx.params).transferId, body.data.textJa);
}
