# syntax=docker/dockerfile:1

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

# ── deps: install once, reused by build and by dev ──────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ── build: compile TypeScript ────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm build

# ── prod-deps: production-only node_modules (scripts skipped: the `prisma`
# CLI used by postinstall is a devDependency and won't be present here — the
# generated client is copied from the `build` stage instead, below) ─────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ── api: HTTP server image ───────────────────────────────────────────────────
FROM base AS api
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]

# ── worker: BullMQ background-processing image ───────────────────────────────
FROM base AS worker
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/workers/index.js"]
