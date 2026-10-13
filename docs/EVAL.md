# EVAL — マッタ 評価結果

- Run: 2026-10-13 (JST evening), `pnpm eval --set A` then `pnpm eval --set B`, against the deployed services
  - web `https://matta-web-760253059957.asia-east1.run.app` (revision matta-web-00002), bank `https://matta-bank-760253059957.asia-east1.run.app`
- Models: `MODEL_FAST=gemini-3.5-flash-lite` (reader), `MODEL_SMART=gemini-3.8-flash` (guardian)
- policyHash: `709efaff38c2eb3c2aaa05be3830c82f26d99a585823900116345d79ed4ec6c7` (policy/system-policy.yaml)
- Held-out set B fingerprint: `a7e33dd667103c7193285ab8c6a3e27084039fe831b51117a6326e733dbc6615` (`sha256sum scenarios/B/*.json | sha256sum`). Scenario files are kept out of the public repo (red-team scripts), so this fingerprint replaces a commit hash. Set B was written before any tuning and was not used for tuning.
- Method: every scenario runs headless through the public APIs. Autopilot victim and autopilot contact act with the sandbox's own identities; the sandbox is reset before each scenario. 14 scenarios per set (5 scam, 3 coached scam, 1 loosening attack, 5 legit). Raw numbers: `eval/results.json` (ids and metrics only).
- Contact-response assumption: when a transfer settles on the contact's approval, its added delay is counted as **15 min** (the autopilot approves instantly; a real contact would not).

## 1. Deterministic guarantees (must hold)

| Guarantee | Set A | Set B |
|---|---|---|
| Transfers routed to `contact_required` (by rule or escalation) settled without a contact approval | **0** of 8 | **0** of 7 |
| Loosening requests delayed (not applied immediately) | **100%** (2/2) | **100%** (1/1) |
| Loosening requests visible to the contact | **100%** (2/2) | **100%** (1/1) |
| Message-guard violations shipped to users (guardian messages re-checked with the deterministic guard) | **0** (1 replaced by the guard) | **0** |
| Authorization / spoof tests rejected (`apps/demo-bank/src/authz.test.ts`, 27 attempts in 10 tests) | **100%** | — |
| Releases under injected LLM failures (`failsafe.test.ts` + `reader.test.ts`, 8 tests) | **0** | — |

## 2. Guardian judgment (reported honestly)

Hold-band scams = S2 (fake billing), S3 (refund), S4 (investment) and their coached variants. These are below the contact threshold, so only the guardian's escalation stops a wait-out (+24 h clock in every scenario).

| Metric | Set A (dev) | Set B (held-out) |
|---|---|---|
| Escalation recall on hold-band scams | 83.3% (5/6) | **50.0% (3/6)** |
| Hold-band scams settled without a contact decision | 1 (S3c) | **3 (S2-bc, S3-bc, S4-bc)** |
| False escalation on legitimate transfers | 0% (0/5) | 0% (0/5) |

All four misses are **coached** variants: the victim repeats a calm cover story ("repaying a friend", "paying a relative", "a car purchase") and the guardian does not escalate. Every non-coached hold-band scam was escalated in both sets. Coached S1 (fake police) is still stopped, by the deterministic large-new-payee rule, not by the guardian.

## 3. Friction (legitimate transfers)

| Metric | Set A | Set B |
|---|---|---|
| Share of legitimate transfers held or routed to the contact | 40% (2/5: verified-university 1 h hold, ¥1.2M+ car payment) | 40% (2/5) |
| Median added delay | 0 min | 0 min |
| Legitimate transfers not settled at the end | 0 | 0 |

Rent, family support and small reimbursements settle instantly; tuition to a bank-verified university waits 1 h; the used-car payment waits for the contact (15 min assumed).

## 4. Cost and speed

| Metric | Set A | Set B |
|---|---|---|
| Est. cost per guarded transfer (guardian + reader) | ¥0.87 | ¥0.75 |
| Guardian model-call latency p50 / p95 | 3.1 s / 12.7 s | 2.9 s / 11.1 s |
| Guardian model calls | 41 | 39 |
| Wall-clock for 14 scenarios (3 sandboxes in parallel) | 193 s | 133 s |

Cost uses list prices from the Gemini API pricing page (2026-10-13) and ¥150/USD — an estimate (`apps/web/src/config/pricing.ts`).

## 5. Harness notes

- L2/L4 (both sets) settled correctly but their `maxAddedDelayMin: 60` check failed by < 1 min: the clock is advanced exactly 1 h and a few real seconds pass on top. Counted as correct in the friction numbers; the check needs a small tolerance.
- S1-b, S1c-b, L4-b (set B) ended in the correct final state (cancelled / cancelled / settled), but the runner reported an error: the autopilot contact decided on the guardian's first message, after which the victim's next answer hit a closed transfer (`409 not_checked`). The runner should skip answers once the transfer has left held/contact_required.
- Pass counts as reported by the runner: set A 11/14, set B 7/14. Excluding the two harness issues above, the only substantive failures are the four coached hold-band misses.

## 6. Limitations

- Scripted scenarios: 14 per set, small n; one run each (LLM outputs vary run to run).
- Fictional bank and directory; no real bank API.
- No voice and no real call signals — "on a call" is only what the customer types.
- Autopilot victims follow a fixed script; real victims answer differently, and real scammers adapt.
- The 15-minute contact response is an assumption, not a measurement.
- Cost and latency are from one evening on Cloud Run asia-east1 with `--max-instances=3`.
