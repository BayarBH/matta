# Build context: repo root (pnpm workspace). Built by infra/cloudbuild.yaml.
FROM node:22-slim
WORKDIR /app
RUN npm i -g pnpm@9.15.9

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/demo-bank/package.json apps/demo-bank/
RUN pnpm install --frozen-lockfile --prod --filter @matta/demo-bank...

COPY packages/core packages/core
COPY apps/demo-bank apps/demo-bank
COPY policy policy

ENV NODE_ENV=production POLICY_PATH=/app/policy/system-policy.yaml
WORKDIR /app/apps/demo-bank
# tsx runs the TS sources directly (no build step; see DECISIONS).
CMD ["node_modules/.bin/tsx", "src/server.ts"]
