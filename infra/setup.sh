#!/usr/bin/env bash
# One-time, idempotent GCP setup for MATTA (SPEC §15). Echoes every command it runs.
# Usage: bash infra/setup.sh            (PROJECT / REGION overridable by env)
set -euo pipefail

PROJECT="${PROJECT:-useful-cathode-450302-f0}"
REGION="${REGION:-asia-northeast1}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA_WEB="sa-web@${PROJECT}.iam.gserviceaccount.com"
SA_BANK="sa-bank@${PROJECT}.iam.gserviceaccount.com"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
TASKS_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run() { echo "+ $*"; "$@"; }
exists() { "$@" >/dev/null 2>&1; }

echo "== APIs"
run gcloud services enable --project "$PROJECT" \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com aiplatform.googleapis.com \
  firestore.googleapis.com cloudtasks.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  secretmanager.googleapis.com logging.googleapis.com identitytoolkit.googleapis.com

echo "== Service accounts"
for name in sa-web sa-bank; do
  exists gcloud iam service-accounts describe "${name}@${PROJECT}.iam.gserviceaccount.com" --project "$PROJECT" ||
    run gcloud iam service-accounts create "$name" --project "$PROJECT" --display-name "MATTA ${name}"
done

bind() { # bind <member> <role> [condition]
  local args=(gcloud projects add-iam-policy-binding "$PROJECT" --member="$1" --role="$2" --quiet --format=none)
  if [[ -n "${3:-}" ]]; then args+=(--condition="$3"); else args+=(--condition=None); fi
  run "${args[@]}"
}

echo "== Project roles"
# Firestore: each service may touch only its own database (IAM condition on the database resource name).
# Fallback if conditions are blocked: drop the condition arg (convention-only separation) and record it in DECISIONS.
bind "serviceAccount:${SA_WEB}" roles/datastore.user \
  "expression=resource.name==\"projects/${PROJECT}/databases/(default)\",title=web-default-db-only"
bind "serviceAccount:${SA_BANK}" roles/datastore.user \
  "expression=resource.name==\"projects/${PROJECT}/databases/bank\",title=bank-db-only"
bind "serviceAccount:${SA_WEB}" roles/aiplatform.user
bind "serviceAccount:${SA_BANK}" roles/cloudtasks.enqueuer
# verifyIdToken(token, checkRevoked=true) reads the user record → needs Firebase Auth read access.
bind "serviceAccount:${SA_WEB}" roles/firebaseauth.viewer
bind "serviceAccount:${SA_BANK}" roles/firebaseauth.viewer
bind "serviceAccount:${SA_WEB}" roles/logging.logWriter
bind "serviceAccount:${SA_BANK}" roles/logging.logWriter
# Cloud Build (gcloud builds submit) runs as the default compute SA in new projects.
bind "serviceAccount:${BUILD_SA}" roles/run.builder

echo "== Service-account-level roles"
# sa-web mints custom tokens for demo autopilots (Phase 3).
run gcloud iam service-accounts add-iam-policy-binding "$SA_WEB" --project "$PROJECT" --quiet --format=none \
  --member="serviceAccount:${SA_WEB}" --role=roles/iam.serviceAccountTokenCreator
# sa-bank creates tasks that carry an OIDC token as itself (actAs).
run gcloud iam service-accounts add-iam-policy-binding "$SA_BANK" --project "$PROJECT" --quiet --format=none \
  --member="serviceAccount:${SA_BANK}" --role=roles/iam.serviceAccountUser
# Cloud Tasks service agent signs those OIDC tokens (automatic in new projects; explicit is harmless).
run gcloud beta services identity create --service=cloudtasks.googleapis.com --project "$PROJECT" --format=none
run gcloud iam service-accounts add-iam-policy-binding "$SA_BANK" --project "$PROJECT" --quiet --format=none \
  --member="serviceAccount:${TASKS_AGENT}" --role=roles/iam.serviceAccountTokenCreator

echo "== Firestore databases"
for db in '(default)' bank; do
  exists gcloud firestore databases describe --database="$db" --project "$PROJECT" ||
    run gcloud firestore databases create --database="$db" --location="$REGION" --type=firestore-native --project "$PROJECT"
done

echo "== Cloud Tasks queue"
exists gcloud tasks queues describe hold-evaluation --location="$REGION" --project "$PROJECT" ||
  run gcloud tasks queues create hold-evaluation --location="$REGION" --project "$PROJECT"

echo "== Artifact Registry"
exists gcloud artifacts repositories describe matta --location="$REGION" --project "$PROJECT" ||
  run gcloud artifacts repositories create matta --repository-format=docker --location="$REGION" --project "$PROJECT"

echo "== Secrets (demo passwords; values from ./.env.local, never echoed)"
# No service reads these at runtime yet; they are the source of truth for the submission form and smoke tests.
# Grant secretAccessor per secret when a service starts reading one.
for key in SEED_PASSWORD_CUSTOMER SEED_PASSWORD_CONTACT SEED_PASSWORD_OPERATOR; do
  name="$(echo "$key" | tr '[:upper:]_' '[:lower:]-')"
  exists gcloud secrets describe "$name" --project "$PROJECT" ||
    run gcloud secrets create "$name" --replication-policy=automatic --project "$PROJECT"
  if [[ -z "$(gcloud secrets versions list "$name" --project "$PROJECT" --format='value(name)' --limit=1)" ]]; then
    value="$(grep -E "^${key}=" "$ROOT/.env.local" | head -1 | cut -d= -f2-)"
    [[ -n "$value" ]] || { echo "missing ${key} in .env.local" >&2; exit 1; }
    echo "+ gcloud secrets versions add $name --data-file=- (value hidden)"
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project "$PROJECT" --format=none
  fi
done

echo "== Done. Next: bash infra/deploy.sh"
