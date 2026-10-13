import { LookupBody, LookupResult } from '@matta/core';
import { forwardToBank } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  forwardToBank(req, { roles: ['customer'], path: '/v1/directory/lookup', method: 'POST', body: LookupBody, res: LookupResult });
