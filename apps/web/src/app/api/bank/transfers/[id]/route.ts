import type { NextRequest } from 'next/server';
import { Transfer } from '@matta/core';
import { forwardToBank } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: RouteContext<'/api/bank/transfers/[id]'>) {
  const { id } = await ctx.params;
  return forwardToBank(req, { roles: ['customer'], path: `/v1/transfers/${encodeURIComponent(id)}`, res: Transfer });
}
