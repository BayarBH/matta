// Node-only helpers (node:crypto, fs). Import from '@matta/core/node' on the server, never in client code.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { SystemPolicy } from './policy';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Stable JSON (sorted keys) so equal objects hash equally. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export const hashObject = (v: unknown) => sha256(canonicalJson(v));

/** Loads policy/system-policy.yaml; policyHash = sha256 of the file text. */
export function loadPolicy(path: string) {
  const text = readFileSync(path, 'utf8');
  return { policy: SystemPolicy.parse(parse(text)), policyHash: sha256(text) };
}
