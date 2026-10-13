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
