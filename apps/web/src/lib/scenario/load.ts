import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Scenario } from '@matta/core';

/** scenarios/{A,B}/*.json; SCENARIOS_DIR overrides the repo default (apps/web is the cwd locally). */
const dir = () => process.env.SCENARIOS_DIR ?? resolve(process.cwd(), '../../scenarios');

export function loadScenarios(): Scenario[] {
  return (['A', 'B'] as const).flatMap((set) =>
    readdirSync(join(dir(), set))
      .filter((f) => f.endsWith('.json'))
      .map((f) => Scenario.parse(JSON.parse(readFileSync(join(dir(), set, f), 'utf8')))),
  );
}

export const findScenario = (id: string) => loadScenarios().find((s) => s.id === id);
