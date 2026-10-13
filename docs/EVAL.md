# EVAL — マッタ 評価結果

- Final run: 2026-10-13 (JST evening), `pnpm eval --target cloud --set all`, code at commit `450793c` (guardian tuned on set A only), against the deployed services
  - web `https://matta-web-760253059957.asia-east1.run.app`, bank `https://matta-bank-760253059957.asia-east1.run.app`
- Models: `MODEL_FAST=gemini-3.5-flash-lite` (reader), `MODEL_SMART=gemini-3.8-flash` (guardian)
- policyHash: `709efaff38c2eb3c2aaa05be3830c82f26d99a585823900116345d79ed4ec6c7` (policy/system-policy.yaml, unchanged by tuning)
- Held-out set B fingerprint: `a7e33dd667103c7193285ab8c6a3e27084039fe831b51117a6326e733dbc6615` (`sha256sum scenarios/B/*.json | sha256sum`). Scenario files are kept out of the public repo (red-team scripts), so this fingerprint replaces a commit hash. Set B was written before any tuning; tuning looked only at set A. Set B was run once before tuning (baseline below) and once after.
- Method: every scenario runs headless through the public APIs. Autopilot victim and autopilot contact act with the sandbox's own identities; the sandbox is reset before each scenario. 14 scenarios per set (5 scam, 3 coached scam, 1 loosening attack, 5 legit). Raw numbers: `eval/results.json` (final) and `eval/baseline/` (pre-tuning); ids and metrics only.
- Contact-response assumption: when a transfer settles on the contact's approval, its added delay is counted as **15 min** (the autopilot approves instantly; a real contact would not).

## 1. Deterministic guarantees (must hold)

| Guarantee | Set A | Set B |
|---|---|---|
| Transfers routed to `contact_required` (by rule or escalation) settled without a contact approval | **0** of 8 | **0** of 9 |
| Loosening requests delayed (not applied immediately) | **100%** (2/2) | **100%** (1/1) |
| Loosening requests visible to the contact | **100%** (2/2) | **100%** (1/1) |
| Message-guard violations shipped to users (guardian messages re-checked with the deterministic guard) | **0** (2 replaced by the guard) | **0** (1 replaced) |
| Authorization / spoof tests rejected (`apps/demo-bank/src/authz.test.ts`, 27 attempts in 10 tests) | **100%** | — |
| Releases under injected LLM failures (`failsafe.test.ts` + `reader.test.ts`, 8 tests) | **0** | — |

These held in every run, before and after tuning.

## 2. Guardian judgment (reported honestly)

Hold-band scams = S2 (fake billing), S3 (refund), S4 (investment) and their coached variants. They are below the contact threshold, so only the guardian's escalation stops a wait-out (+24 h clock in every scenario).

| Metric | Set A (dev, tuned) | **Set B (held-out, tuned)** | Set B baseline (before tuning) |
|---|---|---|---|
| Escalation recall on hold-band scams | 83.3% (5/6) | **83.3% (5/6)** | 50.0% (3/6) |
| Hold-band scams settled without a contact decision | 1 (S4c) | **1 (S4-bc)** | 3 (S2-bc, S3-bc, S4-bc) |
| False escalation on legitimate transfers | 0% (0/5) | **0% (0/5)** | 0% (0/5) |
| Scenarios passing all checks | 13/14 | **13/14** | 7/14 (incl. harness issues) |

What changed (tuned on set A only, where coached S3c had been missed):
- a deterministic gate: on a held transfer the guardian may not end the conversation until it has escalated or asked at least 3 of 4 teller checks (purpose, how the payee was learned, whether on a call, whether told to keep it secret or what to say);
- prompt guidance that a brief, generic purpose for a new payee is an `inconsistent_story` / `coached_answers` signal;
- lower model thinking and one retry on timeout (p95 latency had reached the 20 s timeout).

Remaining miss: the coached **investment** variant (S4c / S4-bc) still settled in this run in both sets; S4c had passed in the local tuning run, so this is run-to-run variance on a borderline case. Coached fake-police S1 is stopped by the deterministic large-new-payee rule regardless of the guardian.

## 3. Friction (legitimate transfers)

| Metric | Set A | Set B |
|---|---|---|
| Share of legitimate transfers held or routed to the contact | 40% (2/5: verified-university 1 h hold, ¥1.2M+ car payment) | 40% (2/5) |
| Median added delay | 0 min | 0 min |
| Legitimate transfers not settled at the end | 0 | 0 |

Rent, family support and small reimbursements settle instantly; tuition to a bank-verified university waits 1 h; the used-car payment waits for the contact (15 min assumed).

## 4. Cost and speed (final run)

| Metric | Set A | Set B | Set B baseline |
|---|---|---|---|
| Est. cost per guarded transfer (guardian + reader) | ¥1.34 | ¥0.76 | ¥0.75 |
| Guardian model-call latency p50 / p95 | 2.2 s / 6.3 s | 1.8 s / 10.0 s | 2.9 s / 11.1 s |
| Guardian model calls | 62 | 40 | 39 |
| Wall-clock for both sets (3 sandboxes in parallel) | 267 s total | | |

Cost uses list prices from the Gemini API pricing page (2026-10-13) and ¥150/USD — an estimate (`apps/web/src/config/pricing.ts`).

## 5. Limitations

- Scripted scenarios: 14 per set, small n; one run per set (LLM outputs vary run to run — the S4c result flipped between the local and cloud runs).
- Fictional bank and directory; no real bank API.
- No voice and no real call signals — "on a call" is only what the customer types.
- Autopilot victims follow a fixed script; real victims answer differently, and real scammers adapt.
- No legitimate scenario has a held new individual payee, so false escalation in that band is not measured.
- The 15-minute contact response is an assumption, not a measurement.
- Cost and latency are from one evening on Cloud Run asia-east1 with `--max-instances=3`.
