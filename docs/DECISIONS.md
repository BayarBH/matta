# DECISIONS

Tradeoffs and why. Newest at the bottom.

## 2026-10-13

- **Schedule slip.** Phase 0A started on 10-13, the planned feature-freeze day. The descope prompt (PROMPTS.md) is pending the owner's approval; must-keeps stay as listed there.
- **Billing.** Project `useful-cathode-450302-f0` linked to the `hackathon` billing account that holds the $300 hackathon credit.
- **TypeScript pinned to ~5.9.** TS 7 (native port) lacks the JS compiler API that Next.js uses for type checking.
- **`packages/core` ships as TS source, no build step.** Next consumes it via `transpilePackages`; the bank runs via `tsx` locally and on Cloud Run. Cost: tsx at runtime (slightly slower cold start). Upgrade: bundle the bank with esbuild if cold starts matter.
- **Token headers.** Service identity (Google ID token from `sa-web`) in `Authorization: Bearer`; end-user identity (Firebase ID token) in `X-User-Token`. Lets the bank verify both on web-on-behalf-of-customer calls; the contact's browser sends only `X-User-Token`.
- **Local S2S bypass by default.** A personal user ADC cannot mint Google ID tokens for an arbitrary audience, so local runs use `S2S_DEV_INSECURE=true` (refused when `NODE_ENV=production`, unit-tested). The real ID-token path is verified on Cloud Run in Phase 0B.
- **Model availability = `models.get`.** On Vertex, `models.list` may return few or no publisher models, so `check:models` treats the list as informational and `models.get` per configured ID as authoritative; `/2\.5/` is refused. `@google/genai` recommends `enterprise: true` over `vertexai: true`; we keep `vertexai: true` as CLAUDE.md specifies (both supported in v2.29).
- **Demo emails on the `.example` TLD** (`customer-1@matta-demo.example` …). Reserved, never deliverable; no email verification is ever needed. Fixed uids equal the account names.

## 2026-10-13 — Local web database is `web-dev`, not `dev`
Firestore database IDs need 4–63 characters, so `dev` is rejected. Local databases: `web-dev` (web) and `bank-dev` (bank), both asia-northeast1. Docs updated.

## 2026-10-13 — Models: MODEL_FAST=gemini-3.5-flash-lite, MODEL_SMART=gemini-3.8-flash
Chosen from what Vertex (location `global`) lists for this project, non-preview only so they outlive the judging window. `gemini-3-flash` does not exist; `gemini-3-pro` passes `models.get` but 404s on `generateContent`, so `check:models` now always runs a 1-token generation ping. A flash model for the guardian keeps conversation latency low for the live demo; revisit a Pro model only if Phase 2 judgment is weak.

## 2026-10-13 — Firebase setup via REST; seed passwords generated locally
Email/password sign-in enabled and a dedicated web app `matta-web` registered through the Identity Toolkit / Firebase Management APIs (no console clicks; reproducible in Phase 0B). Seed passwords were generated with `openssl rand` and live only in the gitignored root `.env.local`; they move to Secret Manager in Phase 0B. Phase 0A verified: 7 users sign in via signInWithPassword, the bank verifies each Firebase token and claims, operator-only `/api/debug/bank` returns the caller (dev-insecure locally), customers get 403.

## 2026-10-13 — Phase 1 bank design
- One `Store` type (get / where / all / set / del / tx) with Firestore and in-memory implementations; tests run with no network. Transaction writes are buffered and committed at the end (Firestore reads-before-writes).
- Hold evaluation: demo-clock advance, `/internal/holds/evaluate` (Cloud Tasks OIDC, sa-bank allowlist), and a 30 s poll in `TASKS_MODE=inline`. In cloud mode one task per held transfer at its real-time `holdUntil`.
- Settlement re-checks the balance and cancels instead of overdrawing.
- A pending loosening whose `fromVersion` is no longer active is rejected (not applied) so it can never undo a later tightening. Customer re-requests if needed.
- W+C routes (lookup, create, get transfer) go through Next API routes; every C/K route is called from the browser directly (CORS = WEB_URL only). The web has no route that cancels, decides or settles.
- Known simplification: the daily auto total counts all settled transfers (stricter than SPEC, never looser).

## 2026-10-13 — Phase 0B deploy design (written, not yet run)
- Images built by Cloud Build from the repo root (`infra/cloudbuild.yaml`, per-app Dockerfile) into Artifact Registry `matta`, then `gcloud run deploy --image`. `--source` can't build a pnpm workspace whose Dockerfile isn't at the root.
- Deterministic Cloud Run URLs (`https://SERVICE-760253059957.asia-northeast1.run.app`) are set before the first deploy, so one pass: web is built with the final `NEXT_PUBLIC_BANK_URL`, bank CORS gets the final `WEB_URL`. Only these URLs are shared (the legacy hash URL is not an allowed CORS origin).
- Both services `--allow-unauthenticated` at the edge; every non-public route checks app-level identity (Firebase ID token / sa-web Google ID token / Cloud Tasks OIDC). Alternative considered: Cloud Run IAM invoker on the bank with web calling via IAM — rejected because the contact's browser must call the bank directly.
- `sa-web` and `sa-bank` get `roles/firebaseauth.viewer`: `verifyIdToken(token, true)` (revocation check) reads the user record.
- Cloud Build runs as the default compute SA, which gets `roles/run.builder` (per Cloud Run docs).
- Firestore separation: `roles/datastore.user` with IAM condition `resource.name=="projects/P/databases/<db>"` (syntax from the Firestore manage-databases docs; the `(default)` form is inferred from the resource-name format). Fallback: drop the condition and record it here.
- Demo passwords live in Secret Manager as the source of truth; no service reads them at runtime, so no accessor bindings yet.
- Bank runs TS via tsx in the container (`--prod` install; tsx is a runtime dependency).
