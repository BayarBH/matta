import { NextResponse } from 'next/server';
import { env } from '../env.server';
import { verifyRequestUser, type RequestUser } from '../firebase.admin';

/**
 * DEMO_MODE only. The operator, or a member of `sandboxId` (customers start runs; contacts may watch).
 * Returns the user or an error response.
 */
export async function demoUser(
  req: Request,
  sandboxId: string,
  roles: Array<'customer' | 'contact'> = ['customer'],
): Promise<RequestUser | NextResponse> {
  if (!env().DEMO_MODE) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const user = await verifyRequestUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role === 'operator') return user;
  if (!roles.includes(user.role) || user.sandboxId !== sandboxId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return user;
}
