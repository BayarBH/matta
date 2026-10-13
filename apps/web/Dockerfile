# Build context: repo root (pnpm workspace). Built by infra/cloudbuild.yaml.
FROM node:22-slim
WORKDIR /app
RUN npm i -g pnpm@9.15.9

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
# Root project too: typescript / @types/node live there and next build type-checks.
RUN pnpm install --frozen-lockfile --filter . --filter @matta/web...

COPY packages/core packages/core
COPY apps/web apps/web
# Runtime data read relative to apps/web (cwd): ../../policy and ../../scenarios.
COPY policy policy
COPY scenarios scenarios

# NEXT_PUBLIC_* are inlined at build time.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_BANK_URL
ARG NEXT_PUBLIC_DEMO_MODE=true
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_BANK_URL=$NEXT_PUBLIC_BANK_URL \
    NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @matta/web build

ENV NODE_ENV=production
WORKDIR /app/apps/web
CMD ["sh", "-c", "exec node_modules/.bin/next start -p ${PORT:-8080}"]
