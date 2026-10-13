import { resolve } from 'node:path';
import { loadPolicy } from '@matta/core/node';

let cached: ReturnType<typeof loadPolicy> | undefined;

/** system-policy.yaml + its hash. POLICY_PATH overrides the repo default (apps/web is the cwd locally). */
export const policy = () => (cached ??= loadPolicy(process.env.POLICY_PATH ?? resolve(process.cwd(), '../../policy/system-policy.yaml')));
