// Validates scenarios/{A,B}/*.json: schema + content rules (fictional names, no realistic phone numbers).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Scenario, scenarioContentProblems } from '@matta/core';

let failed = false;
const ids = new Set<string>();
for (const set of ['A', 'B'] as const) {
  const dir = join('scenarios', set);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const path = join(dir, f);
    const r = Scenario.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    const problems = r.success ? scenarioContentProblems(r.data) : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    if (r.success) {
      if (r.data.set !== set) problems.push(`set "${r.data.set}" but file is in ${set}/`);
      if (ids.has(r.data.id)) problems.push(`duplicate id ${r.data.id}`);
      ids.add(r.data.id);
    }
    failed ||= problems.length > 0;
    console.log(`${problems.length ? '❌' : '✅'} ${path}${problems.map((p) => `\n   - ${p}`).join('')}`);
  }
}
process.exit(failed ? 1 : 0);
