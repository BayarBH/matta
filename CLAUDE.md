# CLAUDE.md — MATTA（マッタ）

## What we are building
**マッタ — 送金に「待った」をかける見守りエージェント**
An AI guardian for internet-banking transfers. The account holder signs a contract of rules while calm (a *Ulysses contract*). Everyday payments flow untouched. Risky transfers are held, discussed the way a good bank teller would, and released only by deterministic rules or by a trusted person chosen in advance — never by the AI.
Entry for the Zenn × Google Cloud "Agentic AI Hackathon" vol.5, whose theme is agents that act autonomously *and* stay governable, observable and secure.

- Pitch: **「冷静なあなたが決めたルールで、焦っているあなたを守る。」** Sub-line: 「ネットバンキングに、窓口の“ひと声”を。」
- Core principle: **AIは止められるが、通せない。** The AI can stop money; it can never release it. Deterministic rules come first; the AI adds judgment only in the direction of safety.
- North star: no scam money leaves without a human decision, and legitimate transfers barely notice the guardian.
- Source of truth: `docs/SPEC.md`. Phase plan: `docs/PROMPTS.md`. Log every non-trivial tradeoff in `docs/DECISIONS.md`. Results in `docs/EVAL.md`.

## Hard constraints
- Deadline **2026-10-15 23:59 JST**. Feature freeze at the end of **10-13**. 10-14 packaging. 10-15 buffer; submit before noon.
- Runtime: **Cloud Run** only, region `asia-northeast1`, two services.
- AI: **Gemini on Gemini Enterprise Agent Platform (formerly Vertex AI)** via `@google/genai` (`vertexai: true`, Application Default Credentials). No API keys in code.
- Model IDs come only from env: `MODEL_FAST`, `MODEL_SMART`. **Never use Gemini 2.5 models at runtime** — they retire on Google Cloud inside the judging window. `pnpm check:models` must pass before every deploy.
- Judges log in with **pre-provisioned email + password test accounts** (Firebase Auth). No social login, no email/SMS verification, no magic links. Everything a judge needs — including the trusted contact's approval — happens inside the app.
- The deployment must keep working until **2026-12-01**. After submission `main` is frozen; continue on `dev`.
- Fresh repo; everything is written during the hackathon. No secrets in git (`.env.local` locally, Secret Manager on Cloud Run).
- Cost caps: `--max-instances=3`, guardian turn limits, cached reader outputs.

## Architecture at a glance
- `apps/web` — Next.js (App Router, TS strict, Tailwind) on Cloud Run. Customer banking app with the guardian agent, rules (mandate) page, trusted-contact inbox, red-team demo console, audit black box, operator metrics. **Holds the LLM. Cannot release money.**
- `apps/demo-bank` — Express on Cloud Run. Fictional bank core 「デモ銀行（架空）」: accounts, payee directory lookup, ledger, transfers with holds, the signed mandate, deterministic release checks, contact decisions, demo clock. **No LLM. The only place money moves.**
- `packages/core` — pure TypeScript, no I/O: zod schemas, mandate model + tighten/loosen classifier, transfer evaluation, release conditions, reason codes, keyword pre-check, message guard. Used by both services. Fully unit-tested.
- Firestore: web data in the `(default)` database; bank data in a separate `bank` database that only `sa-bank` can access (IAM condition; fallback documented in DECISIONS). Firebase Auth. Cloud Tasks (hold-expiry evaluation). Cloud Logging (structured JSON logs).
- `policy/system-policy.yaml` — operator policy: reason codes, escalation thresholds, guardian limits, message guard. Each user's mandate lives in the bank. Every decision records `ruleId` + `mandateHash` + `policyHash`.

## Local-first development
- Build and debug locally. Deploy the walking skeleton once (Phase 0B), then at the end of every day.
- Locally, use the real Google Cloud project for Gemini (ADC via `gcloud auth application-default login`) and Firebase Auth, with separate Firestore databases `dev` (web) and `bank-dev` (bank) — or the emulator — so production data stays clean. Each service reads its database from `FIRESTORE_DATABASE_ID`.
- Local substitutes, switched by env: `TASKS_MODE=inline` (evaluate holds in-process instead of Cloud Tasks), `S2S_DEV_INSECURE=true` (skip Google ID-token checks between services; refused when `NODE_ENV=production`), `DEMO_MODE=true` (demo clock, sandbox reset, red-team console).
- Cloud-only checks — must pass on Cloud Run, never assume them from local runs: web→bank Google ID tokens, Cloud Tasks OIDC delivery, runtime env and secrets, CORS from the contact's browser to the bank, login on the public URL, IAM separation of the `bank` database.

## Governance rules (non-negotiable — tests enforce them)
1. **Money moves only inside demo-bank.** The web service (which holds the LLM) has no endpoint, credential or code path that releases or settles a transfer.
2. **Monotonic safety.** The guardian may only tighten: ask, explain, keep holding, escalate to `contact_required`, notify. No LLM output can shorten a hold, lower a requirement or release anything. The bank exposes `escalate`, never a reverse.
3. **The mandate is the user's own contract.** Signed with recent re-authentication; versioned and hashed in the bank. Tightening applies immediately. Loosening — raising limits, shortening holds, removing quiet hours, and **any contact change** (a new contact gains approval power; removing one cuts off the person who would notice) — applies only after the cooling-off period or with an existing contact's co-sign. Contacts are notified of every loosening request, and open requests push non-everyday transfers to `contact_required`.
4. **Least-privilege contacts.** A trusted contact can approve or deny held transfers and loosening requests in their own sandbox only, sees only the facts needed, and cannot initiate transfers, see balances or edit the mandate.
5. **Untrusted fields stay data.** Payee holder names, memos and red-team text are read by a quarantined reader (no tools) into zod JSON and never followed as instructions. The customer's chat messages carry no authority to loosen anything.
6. **Trusted surface.** Amounts, payees, hold status, release conditions and rule texts are rendered by deterministic components from bank data — never by LLM text.
7. **Identity-bound decisions.** The bank verifies the Firebase ID token, role and sandbox membership on every customer/contact action; a Google ID token from an allowlisted service account (`sa-web`) on every service call; Cloud Tasks OIDC on internal endpoints. Bypass only when `NODE_ENV !== 'production' && S2S_DEV_INSECURE === 'true'`.
8. **Everything is audited.** Every step writes an `AuditEvent` (actor, action, target, ruleId, mandateHash, policyHash, model, tokens, est. cost, latency, outcome) in the service where it happened.
9. **Fail safe.** LLM error, timeout or invalid output on a checked transfer → `contact_required`; nothing releases. Everyday transfers keep flowing via deterministic rules. A circuit breaker pauses the guardian when the error rate is high; holds stay in place.
10. **Never paternalistic, never accusatory.** Everyday payments are frictionless. The guardian speaks calmly in です・ます, explains the user's own rules, never declares "this is a scam", never asks for PINs, passwords or codes, never hints how to get around the rules, and only points to #9110 or the bank's official (fictional) contact.
11. **Demo honesty and safety.** Fictional bank 「デモ銀行（架空）」, fictional police 「青嶺県警察（架空）」, fictional people; permanent banner 「架空のデモです。実在の銀行・警察とは関係ありません。」 No real bank branding or look-alike UI. Red-team scenarios are curated branching scripts paraphrasing police-published scam patterns — no free-form scam generation; red-team scripts never appear in public materials.

## Commands (keep these working)
`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm check:models` · `pnpm seed` · `pnpm scenarios:validate` · `pnpm eval` · `pnpm deploy:all` · `pnpm smoke`

## Conventions
- TypeScript strict. zod at every boundary: HTTP bodies, Firestore reads, LLM outputs, inter-service payloads.
- Pure logic lives in `packages/core`; I/O stays at the edges. Small modules.
- UI copy in Japanese: calm, factual, short, です・ます; no fear-mongering. Code, comments and commits in English. Conventional commits; commit after every green step.
- If an SDK API is uncertain (`@google/genai`, Firebase, Cloud Tasks, Firestore multiple databases, IAM conditions), read the installed type definitions or official docs first. Never guess signatures.
- Choose the simplest implementation that serves the 3-minute demo; write the tradeoff into `docs/DECISIONS.md`.
- Stay inside the current phase of `docs/PROMPTS.md`. Don't build ahead.

## Ask me before
Deleting or recreating cloud resources · changing IAM outside `infra/setup.sh` · adding paid services · force-pushing or rewriting git history · changing `system-policy.yaml` or mandate defaults after the freeze · running `infra/*.sh` for the first time · writing red-team scripts beyond the scenarios listed in SPEC §10.

## Non-goals
Real bank connections · phone-call interception or recording · voice cloning · real SMS/email notifications · free-form scam generation · real police integration · KYC · native apps · multi-tenant admin.

## Definition of done (submission)
- The deployed URL works for every test account pair in a fresh incognito window.
- S1 (fake police, coached): no money leaves; the contact sees the reasons; the "turn off the protection" attempt stays pending; the contact's denial cancels the transfer.
- S2 (fake billing, hold band): the guardian escalates, so waiting out the hold does not release the money.
- L1 settles instantly; L4 settles right after the contact approves.
- The black box shows every step across both services; spoof attempts are rejected and visible.
- `docs/EVAL.md` reports held-out numbers with limitations.
- README (Japanese), architecture PNG, 3-minute demo script and submission text are done. `pnpm check:models` passes.
