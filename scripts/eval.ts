// Runs every scenario headless through the public APIs (autopilot victim + contact) and computes SPEC §14 metrics.
// Usage: pnpm eval [--target cloud|local] [--set A|B|all]
// Writes eval/results.json (ids, kinds and metrics only — never scenario text). docs/EVAL.md is written by hand from it.
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { AuditEvent, MandateChange, Scenario, Transfer, messageGuard } from '@matta/core';
import { loadPolicy } from '@matta/core/node';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const target = arg('target', 'cloud');
const setArg = arg('set', 'all');
const NUM = '760253059957';
const WEB = target === 'local' ? 'http://localhost:3000' : `https://matta-web-${NUM}.asia-east1.run.app`;
const BANK = target === 'local' ? 'http://localhost:8081' : `https://matta-bank-${NUM}.asia-east1.run.app`;
const CONTACT_RESPONSE_MIN = 15; // assumption: a contact decides within 15 min of being asked

const root = parseEnv(readFileSync('.env.local', 'utf8'));
const web = parseEnv(readFileSync('apps/web/.env.local', 'utf8'));
const { policy, policyHash } = loadPolicy('policy/system-policy.yaml');

async function signIn(user: string, password: string | undefined): Promise<string> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${web.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${user}@matta-demo.example`, password, returnSecureToken: true }),
  });
  const j = (await r.json()) as { idToken?: string; error?: { message: string } };
  if (!j.idToken) throw new Error(`sign-in ${user}: ${j.error?.message ?? r.status}`);
  return j.idToken;
}

async function call(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(/^https?:\/\/[^/]+/, '')} -> ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const scenarios = (['A', 'B'] as const)
  .filter((s) => setArg === 'all' || setArg === s)
  .flatMap((set) =>
    readdirSync(join('scenarios', set))
      .filter((f) => f.endsWith('.json'))
      .map((f) => Scenario.parse(JSON.parse(readFileSync(join('scenarios', set, f), 'utf8')))),
  );

type Result = {
  id: string;
  set: 'A' | 'B';
  kind: 'scam' | 'legit';
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  error?: string;
  runtimeMs: number;
  transfer?: { status: string; ruleId: string; escalated: boolean; settled: boolean; contactDecision: string | null; addedDelaySimMin: number | null; escalationReasons: string[] };
  change?: { status: string; delayed: boolean; contactNotified: boolean };
  guardian: { calls: number; latenciesMs: number[]; tokensIn: number; tokensOut: number; estCostJpy: number; guardReplaced: number; unguardedShipped: number };
  readerCostJpy: number;
};

const tokens: Record<string, string> = {};
for (const n of [1, 2, 3]) {
  tokens[`customer-${n}`] = await signIn(`customer-${n}`, root.SEED_PASSWORD_CUSTOMER);
  tokens[`contact-${n}`] = await signIn(`contact-${n}`, root.SEED_PASSWORD_CONTACT);
}
const auth = (u: string) => ({ authorization: `Bearer ${tokens[u]}`, 'content-type': 'application/json' });

async function runOne(s: Scenario, n: number): Promise<Result> {
  const sid = `sandbox-${n}`;
  const cust = `customer-${n}`;
  const started = Date.now();
  const res: Result = { id: s.id, set: s.set, kind: s.kind, passed: false, checks: [], runtimeMs: 0, guardian: { calls: 0, latenciesMs: [], tokensIn: 0, tokensOut: 0, estCostJpy: 0, guardReplaced: 0, unguardedShipped: 0 }, readerCostJpy: 0 };
  try {
    await call(`${WEB}/api/demo/reset`, { method: 'POST', headers: auth(cust), body: JSON.stringify({ sandboxId: sid }) });
    const run = (await call(`${WEB}/api/demo/scenarios/${s.id}/run`, {
      method: 'POST',
      headers: auth(cust),
      body: JSON.stringify({ sandboxId: sid, autopilotVictim: true, autopilotContact: true }),
      timeoutMs: 360_000,
    })) as { status: string; transferId: string | null; changeId: string | null; result: { passed: boolean; checks: Result['checks'] } | null; events: { kind: string; textJa: string }[] };
    res.passed = run.status === 'done' && !!run.result?.passed;
    res.checks = run.result?.checks ?? [];
    if (run.status !== 'done') res.error = `run ${run.status}: ${run.events.filter((e) => e.kind === 'system').slice(-1)[0]?.textJa ?? ''}`.slice(0, 200);

    if (run.transferId) {
      const t = Transfer.parse(await call(`${WEB}/api/bank/transfers/${run.transferId}`, { headers: auth(cust) }));
      const approved = t.decision?.decision === 'approve';
      const simDelay = t.settledAt ? (Date.parse(t.settledAt) - Date.parse(t.createdAt)) / 60_000 : null;
      res.transfer = {
        status: t.status,
        ruleId: t.ruleId,
        escalated: !!t.escalatedAt,
        settled: t.status === 'settled',
        contactDecision: t.decision?.decision ?? null,
        addedDelaySimMin: simDelay === null ? null : approved ? CONTACT_RESPONSE_MIN : Math.round(simDelay),
        escalationReasons: t.escalationReasons,
      };
      const audit = (await call(`${WEB}/api/audit/${run.transferId}`, { headers: auth(cust) })) as { events: unknown[] };
      for (const e of audit.events.map((x) => AuditEvent.parse(x))) {
        if (e.action === 'guardian.model_call') {
          res.guardian.calls++;
          if (e.latencyMs !== undefined) res.guardian.latenciesMs.push(e.latencyMs);
          res.guardian.tokensIn += e.tokensIn ?? 0;
          res.guardian.tokensOut += e.tokensOut ?? 0;
          res.guardian.estCostJpy += e.estCostJpy ?? 0;
        }
        if (e.action === 'reader.read') res.readerCostJpy += e.estCostJpy ?? 0;
        if (e.action === 'guard.violation') res.guardian.guardReplaced++;
      }
      // Re-check every guardian message the customer actually saw against the deterministic guard.
      const conv = (await call(`${WEB}/api/guardian/${run.transferId}`, { headers: auth(cust) }).catch(() => null)) as {
        conversation?: { messages: { role: string; textJa: string }[] } | null;
      } | null;
      for (const m of conv?.conversation?.messages ?? []) {
        if (m.role === 'guardian' && !messageGuard(m.textJa, policy).ok) res.guardian.unguardedShipped++;
      }
    }
    if (run.changeId) {
      const c = MandateChange.parse(await call(`${BANK}/v1/mandate/changes/${run.changeId}`, { headers: { 'x-user-token': tokens[cust]! } }));
      const inbox = (await call(`${BANK}/v1/contact/inbox`, { headers: { 'x-user-token': tokens[`contact-${n}`]! } })) as { mandateChanges: { id: string }[] };
      res.change = {
        status: c.status,
        delayed: c.kind !== 'loosen' || (c.status !== 'applied' || c.decidedBy === `contact-${n}`),
        contactNotified: inbox.mandateChanges.some((x) => x.id === c.id) || c.decidedBy === `contact-${n}`,
      };
    }
  } catch (e) {
    res.error = String(e).slice(0, 300);
  }
  res.runtimeMs = Date.now() - started;
  console.log(`${res.passed ? '✅' : '❌'} ${s.id.padEnd(7)} ${res.transfer?.status ?? res.change?.status ?? '-'} ${Math.round(res.runtimeMs / 1000)}s${res.error ? ` — ${res.error}` : ''}${res.checks.filter((c) => !c.ok).map((c) => ` [${c.name}: ${c.detail}]`).join('')}`);
  return res;
}

// One worker per sandbox (max 3 concurrent); each works through its share of the queue.
const queue = [...scenarios];
const results: Result[] = [];
const t0 = Date.now();
await Promise.all(
  [1, 2, 3].map(async (n) => {
    for (let s = queue.shift(); s; s = queue.shift()) results.push(await runOne(s, n));
  }),
);

function vitestCount(pkg: string, files: string): { passed: number; total: number } {
  const out = join('eval', `.vitest-${pkg.replace(/\W/g, '')}.json`);
  try {
    execSync(`pnpm --filter ${pkg} exec vitest run ${files} --reporter=json --outputFile=${join(process.cwd(), out)}`, { stdio: 'ignore' });
  } catch {
    /* failures still write the file */
  }
  const j = JSON.parse(readFileSync(out, 'utf8')) as { numPassedTests: number; numTotalTests: number };
  return { passed: j.numPassedTests, total: j.numTotalTests };
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const quant = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};
const median = (xs: number[]) => quant(xs, 0.5);

function metrics(rs: Result[]) {
  const withT = rs.filter((r) => r.transfer);
  const byRule = withT.filter((r) => ['R-CONTACT-LARGE-NEW', 'R-READER-HIGH', 'R-LOOSEN-OPEN'].includes(r.transfer!.ruleId) || r.transfer!.escalated);
  const holdBand = rs.filter((r) => r.kind === 'scam' && /^S[234]/.test(r.id) && r.transfer);
  const legit = rs.filter((r) => r.kind === 'legit' && r.transfer);
  const changes = rs.filter((r) => r.change);
  const guarded = rs.filter((r) => r.guardian.calls > 0);
  const lat = rs.flatMap((r) => r.guardian.latenciesMs);
  const delays = legit.map((r) => r.transfer!.addedDelaySimMin).filter((d): d is number => d !== null);
  return {
    scenarios: rs.length,
    passed: rs.filter((r) => r.passed).length,
    deterministic: {
      contactRequiredSettledWithoutContact: byRule.filter((r) => r.transfer!.settled && r.transfer!.contactDecision !== 'approve').length,
      contactRequiredTransfers: byRule.length,
      looseningDelayedPct: pct(changes.filter((r) => r.change!.delayed).length, changes.length),
      looseningContactNotifiedPct: pct(changes.filter((r) => r.change!.contactNotified).length, changes.length),
      looseningRequests: changes.length,
      guardViolationsShipped: rs.reduce((s, r) => s + r.guardian.unguardedShipped, 0),
      guardReplacements: rs.reduce((s, r) => s + r.guardian.guardReplaced, 0),
    },
    guardian: {
      holdBandScams: holdBand.length,
      escalationRecallPct: pct(holdBand.filter((r) => r.transfer!.escalated || r.transfer!.status === 'contact_required').length, holdBand.length),
      holdBandScamsSettledWithoutContact: holdBand.filter((r) => r.transfer!.settled && r.transfer!.contactDecision !== 'approve').length,
      falseEscalationRatePct: pct(legit.filter((r) => r.transfer!.escalated).length, legit.length),
      legitTransfers: legit.length,
    },
    friction: {
      legitHeldPct: pct(legit.filter((r) => !r.transfer!.ruleId.startsWith('R-EVERYDAY')).length, legit.length),
      medianAddedDelayMin: median(delays),
      legitNotSettled: legit.filter((r) => !r.transfer!.settled).map((r) => r.id),
    },
    costAndSpeed: {
      guardedTransfers: guarded.length,
      estCostJpyPerGuardedTransfer: guarded.length ? Math.round((guarded.reduce((s, r) => s + r.guardian.estCostJpy + r.readerCostJpy, 0) / guarded.length) * 100) / 100 : null,
      guardianModelCallLatencyMsP50: median(lat),
      guardianModelCallLatencyMsP95: quant(lat, 0.95),
      guardianModelCalls: lat.length,
    },
  };
}

mkdirSync('eval', { recursive: true });
const out = {
  ranAt: new Date().toISOString(),
  target,
  web: WEB,
  models: { fast: root.MODEL_FAST, smart: root.MODEL_SMART },
  policyHash,
  setBFingerprint: 'a7e33dd667103c7193285ab8c6a3e27084039fe831b51117a6326e733dbc6615',
  contactResponseAssumptionMin: CONTACT_RESPONSE_MIN,
  runtimeSec: Math.round((Date.now() - t0) / 1000),
  testSuites: {
    authorization: vitestCount('@matta/demo-bank', 'src/authz.test.ts'),
    failSafe: vitestCount('@matta/web', 'src/lib/guardian/failsafe.test.ts src/lib/reader.test.ts'),
  },
  setA: metrics(results.filter((r) => r.set === 'A')),
  setB: metrics(results.filter((r) => r.set === 'B')),
  results: results.sort((a, b) => a.id.localeCompare(b.id)).map(({ guardian, ...r }) => ({ ...r, guardian: { ...guardian, latenciesMs: undefined, medianLatencyMs: median(guardian.latenciesMs) } })),
};
writeFileSync('eval/results.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ setA: out.setA, setB: out.setB, testSuites: out.testSuites, runtimeSec: out.runtimeSec }, null, 2));
