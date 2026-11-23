# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat \
 && corepack enable && corepack prepare pnpm@10.33.4 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS dev
CMD ["sh"]

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @paypure/domain build \
 && pnpm --filter client build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/client/.next/standalone ./
COPY --from=build --chown=node:node /app/client/.next/static ./client/.next/static
USER node
CMD ["node", "client/server.js"]
