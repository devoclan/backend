# Deployment

## Topology

Two long-running processes, one shared database, one shared cache/queue broker:

- **`api`** — Fastify HTTP server (`dist/server.js`), stateless, horizontally scalable.
- **`worker`** — BullMQ worker process (`dist/workers/index.js`): the blockchain indexer, notification delivery, and reconciliation jobs. Also horizontally scalable — BullMQ handles job distribution across worker instances.
- **PostgreSQL 16** — primary datastore.
- **Redis 7** — cache + BullMQ broker (two logical connections, see `src/shared/cache` vs `src/shared/queue`, kept separate deliberately).

Both `api` and `worker` are built from the same multi-stage [`Dockerfile`](../Dockerfile) (`api` / `worker` build targets) so there is exactly one build pipeline to maintain, not two diverging images.

## Environments

| Environment | Network | Notes |
|---|---|---|
| Local | testnet | `docker compose up`, see `README.md` |
| Staging | testnet | Mirrors production topology; used to validate against real (but risk-free) Soroban testnet contracts before promotion |
| Production | mainnet | Only stood up once the smart-contract side has completed its own audit/mainnet deployment — this backend does not gate or accelerate that decision (`ROADMAP.md` §11) |

## Release Process

1. Merge to `main` (CI green: lint, typecheck, build, test — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
2. Tag `vX.Y.Z` (Conventional Commits drive the version bump).
3. [`.github/workflows/release.yml`](../.github/workflows/release.yml) builds and drafts a GitHub Release with auto-generated notes for maintainer review before publishing.
4. Deploy: build/push the `api` and `worker` images, then run migrations as an explicit release step —
   ```bash
   pnpm prisma:migrate:deploy
   ```
   **Never** run `prisma migrate dev` or rely on auto-migration on API boot in a deployed environment — migrations are a deliberate, reviewed step, not a side effect of starting the process.
5. Roll out `api`/`worker` images. Because both are stateless (all state in Postgres/Redis), this supports standard rolling deployment without a maintenance window.

## Configuration

All configuration is environment variables, validated at boot by `src/shared/config/env.ts` (Zod schema) — an invalid or missing required variable fails startup immediately with a clear error, rather than failing on the first request that happens to need it. See [`.env.example`](../.env.example) for the full list.

Contract IDs (`ESCROW_CONTRACT_ID`, etc.) and network settings (`STELLAR_NETWORK`, `SOROBAN_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`) must match the actual deployed `FaniLab-SmartContract` instance for the target environment — cross-check against that repository's deployment output before promoting to a new network.

## Health Checks

- `GET /health` — liveness/readiness: database + Redis reachability (see `src/shared/http/routes/health.ts`).
- `GET /health/indexer` — indexer lag — see [`EVENT_INDEXER.md`](./EVENT_INDEXER.md).
- `GET /health/queue` — BullMQ queue job counts/failures — see [`OBSERVABILITY.md`](./OBSERVABILITY.md).
- `GET /metrics` — Prometheus scrape endpoint for whatever monitoring stack the deployment environment runs (Phase 6 — see [`OBSERVABILITY.md`](./OBSERVABILITY.md)); point network policy, not app-level auth, at restricting who can reach it.

Point your orchestrator's readiness probe at `/health`; a `503` means don't route traffic yet, not that the process should be killed — Postgres/Redis blips are often transient.

## Rollback

Because migrations are a separate, explicit step from image deployment, rolling back the `api`/`worker` images to a previous tag is safe as long as no destructive (column-dropping) migration has been applied since that tag — additive migrations are preferred for exactly this reason during active development.

## Scaling

- `api`: scale horizontally behind a load balancer; no in-memory state to worry about (rate limiting is Redis-backed, sessions are stateless JWTs).
- `worker`: scale horizontally; BullMQ distributes jobs across worker instances automatically. The indexer itself should remain a single logical consumer per contract (its repeatable job is idempotent but not designed for concurrent execution against the same checkpoint — see `EVENT_INDEXER.md`) until the distributed-bus future enhancement in `ARCHITECTURE.md` §11 is implemented.

## Status

This document describes the intended deployment process for the scaffold as it stands (Phase 4) plus the design Phase 5 modules build toward. It will be updated with real infra specifics (hosting provider, exact CI deploy steps) once those are finalized.
