import { guardianStep } from '@/lib/guardian/route.server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ transferId: string }> }) {
  return guardianStep(req, (await ctx.params).transferId);
}
