# infra

Run from the repo root in Git Bash (Windows) or any bash. Every command is echoed before it runs.

1. `bash infra/setup.sh` — once (idempotent): APIs, `sa-web` / `sa-bank` and their roles (Firestore access split by IAM condition), Firestore `(default)` + `bank`, Cloud Tasks queue `hold-evaluation`, Artifact Registry `matta`, demo-password secrets.
2. `pnpm deploy:all` (= `bash infra/deploy.sh`) — `pnpm check:models`, Cloud Build images for bank and web, `gcloud run deploy` for `matta-bank` then `matta-web` (asia-northeast1, `--max-instances=3`, `--allow-unauthenticated`; app-level auth on every non-public route).
3. `pnpm smoke` — cloud-only checks (real Google ID token web→bank, logins, CORS).

## URLs
Deterministic Cloud Run URLs are used everywhere (env, CORS, NEXT_PUBLIC_BANK_URL):
- web: `https://matta-web-760253059957.asia-northeast1.run.app`
- bank: `https://matta-bank-760253059957.asia-northeast1.run.app`

Share only these. The legacy hash-style URL a service also answers on is not the CORS origin the bank allows.

## Seeding production
Firebase Auth users are project-wide, so the users seeded locally already exist. Seed the bank database:

```bash
FIRESTORE_DATABASE_ID=bank pnpm seed
```

Node's `--env-file` never overrides variables already set, so the `FIRESTORE_DATABASE_ID=bank` prefix wins over `bank-dev` in `apps/demo-bank/.env.local`. It runs with your ADC (project owner); `sa-bank`'s IAM condition doesn't apply to you. Re-running is safe (each sandbox is wiped and reseeded); in the app, `POST /demo/sandboxes/:sid/reset` does the same for one sandbox.

## Firebase Auth domains
Expected: email/password sign-in is not gated by Firebase's authorized domains (the docs mention that list only for redirect/popup and email-link flows). Not confirmed by an explicit docs sentence; verify by logging in on the public web URL in an incognito window. If it fails with `auth/unauthorized-domain`, add `matta-web-760253059957.asia-northeast1.run.app` under Authentication → Settings → Authorized domains.

## Cloud Tasks check (manual, not in smoke)
Create a held transfer on the deployed app (e.g. ¥520,000 to the verified university 9991-202-4000001: 1 h hold), then in Cloud Logging filter `resource.labels.service_name="matta-bank" jsonPayload.message:"holds"` — the evaluate call must show the verified sa-bank caller. An unauthenticated `curl -X POST $BANK_URL/internal/holds/evaluate` must return 401.
