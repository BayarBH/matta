#!/usr/bin/env bash
# Build both images with Cloud Build and deploy to Cloud Run (bank first, then web). Echoes every command.
# Usage: bash infra/deploy.sh   (or pnpm deploy:all). Requires infra/setup.sh to have run once.
set -euo pipefail

PROJECT="${PROJECT:-useful-cathode-450302-f0}"
REGION="${REGION:-asia-northeast1}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${REGION}-docker.pkg.dev/${PROJECT}/matta"
TAG="$(git -C "$ROOT" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
SA_WEB="sa-web@${PROJECT}.iam.gserviceaccount.com"
SA_BANK="sa-bank@${PROJECT}.iam.gserviceaccount.com"
# Deterministic Cloud Run URLs (https://SERVICE-PROJECT_NUMBER.REGION.run.app) are known before the first
# deploy, so one pass suffices: the web image is built with the final bank URL and CORS gets the final web URL.
BANK_URL="https://matta-bank-${PROJECT_NUMBER}.${REGION}.run.app"
WEB_URL="https://matta-web-${PROJECT_NUMBER}.${REGION}.run.app"

run() { echo "+ $*"; "$@"; }
# First deploys to a new region can fail with a transient "Project failed to initialize ... quota exceeded".
retry() { local i; for i in 1 2 3 4; do echo "+ (try $i) $*"; "$@" && return 0; sleep 60; done; return 1; }
getv() { grep -E "^$1=" "$2" | head -1 | cut -d= -f2-; } # getv KEY FILE

MODEL_FAST="$(getv MODEL_FAST "$ROOT/.env.local")"
MODEL_SMART="$(getv MODEL_SMART "$ROOT/.env.local")"
WEB_ENV_FILE="$ROOT/apps/web/.env.local"

cd "$ROOT"
echo "== Model check (must pass before every deploy)"
run pnpm check:models

echo "== Bank"
# Set BANK_IMAGE / WEB_IMAGE to reuse an already-built image and skip its build.
if [[ -n "${BANK_IMAGE:-}" ]]; then echo "reusing $BANK_IMAGE"; else
BANK_IMAGE="${REPO}/bank:${TAG}"
run gcloud builds submit . --project "$PROJECT" --region "$REGION" --config infra/cloudbuild.yaml \
  --substitutions="_DOCKERFILE=apps/demo-bank/Dockerfile,_IMAGE=${BANK_IMAGE}"
fi
retry gcloud run deploy matta-bank --project "$PROJECT" --region "$REGION" --image "$BANK_IMAGE" \
  --service-account "$SA_BANK" --allow-unauthenticated --max-instances=3 \
  --set-env-vars="^;^NODE_ENV=production;GOOGLE_CLOUD_PROJECT=${PROJECT};FIRESTORE_DATABASE_ID=bank;BANK_URL=${BANK_URL};WEB_URL=${WEB_URL};S2S_ALLOWED_SA=${SA_WEB};S2S_DEV_INSECURE=false;TASKS_MODE=cloud;TASKS_QUEUE=projects/${PROJECT}/locations/${REGION}/queues/hold-evaluation;TASKS_SA_EMAIL=${SA_BANK};TASKS_ALLOWED_SA=${SA_BANK};DEMO_MODE=true;POLICY_PATH=/app/policy/system-policy.yaml"

echo "== Web"
WEB_IMAGE="${REPO}/web:${TAG}"
run gcloud builds submit . --project "$PROJECT" --region "$REGION" --config infra/cloudbuild.yaml \
  --substitutions="_DOCKERFILE=apps/web/Dockerfile,_IMAGE=${WEB_IMAGE},_NEXT_PUBLIC_FIREBASE_API_KEY=$(getv NEXT_PUBLIC_FIREBASE_API_KEY "$WEB_ENV_FILE"),_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$(getv NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN "$WEB_ENV_FILE"),_NEXT_PUBLIC_FIREBASE_PROJECT_ID=$(getv NEXT_PUBLIC_FIREBASE_PROJECT_ID "$WEB_ENV_FILE"),_NEXT_PUBLIC_FIREBASE_APP_ID=$(getv NEXT_PUBLIC_FIREBASE_APP_ID "$WEB_ENV_FILE"),_NEXT_PUBLIC_BANK_URL=${BANK_URL},_NEXT_PUBLIC_DEMO_MODE=true"
retry gcloud run deploy matta-web --project "$PROJECT" --region "$REGION" --image "$WEB_IMAGE" \
  --service-account "$SA_WEB" --allow-unauthenticated --max-instances=3 \
  --set-env-vars="^;^NODE_ENV=production;GOOGLE_CLOUD_PROJECT=${PROJECT};GOOGLE_CLOUD_LOCATION=global;MODEL_FAST=${MODEL_FAST};MODEL_SMART=${MODEL_SMART};FIRESTORE_DATABASE_ID=(default);WEB_URL=${WEB_URL};BANK_URL=${BANK_URL};TASKS_MODE=cloud;S2S_DEV_INSECURE=false;DEMO_MODE=true"

echo "== URLs (share these; the legacy hash URLs from 'status.url' fail CORS because the bank allows WEB_URL only)"
echo "web : ${WEB_URL}"
echo "bank: ${BANK_URL}"
echo "Next: pnpm smoke ${WEB_URL} ${BANK_URL}"
