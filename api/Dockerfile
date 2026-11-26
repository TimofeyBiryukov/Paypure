# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN apk add --no-cache openssl libc6-compat \
 && corepack enable && corepack prepare pnpm@10.33.4 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
WORKDIR /app

# dev: deps only, source is bind-mounted (Tech §7.1)
FROM base AS dev
# pdftotext, for the one-off Paydirt import (cli import:paydirt, docs/paypure/05 §4)
RUN apk add --no-cache poppler-utils
CMD ["sh"]

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @paypure/domain build \
 && pnpm --filter api exec prisma generate \
 && pnpm --filter api build \
 && pnpm --filter api deploy --prod --legacy /out \
 && cp -r api/dist api/prisma api/prisma.config.ts /out/

FROM node:24-alpine AS prod
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
