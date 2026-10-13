import { CreateTransferBody, Transfer } from '@matta/core';
import { forwardToBank } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

// readerFlags come from the quarantined reader in Phase 2; the browser can't supply them.
const Body = CreateTransferBody.omit({ readerFlags: true }).transform((b) => ({ ...b, readerFlags: [] }));

export const POST = (req: Request) =>
  forwardToBank(req, { roles: ['customer'], path: '/v1/transfers', method: 'POST', body: Body, res: Transfer });
