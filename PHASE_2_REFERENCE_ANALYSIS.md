# Phase 2 — Reference Backend Analysis (SwiftChain_Backend)

**Status:** Complete
**Scope:** Study `SwiftChain_Backend` (Express/MongoDB/Socket.IO Soroban logistics-escrow backend) purely for engineering-quality inspiration. Nothing here is copied — code, structure, and naming in `fanilab-backend` will be original and will use a different stack (Fastify, PostgreSQL/Prisma, BullMQ, Clean Architecture).
**Rule enforced:** No backend code was written in this phase.

---

## 1. Domain/Feature Coverage Observed

SwiftChain implements the same class of problem as FaniLab: auth (JWT + RBAC for user/driver/admin), delivery lifecycle CRUD and status workflow, escrow state mirrored from on-chain events, disputes with admin resolution, fleet management (enterprise-role gated), driver/vehicle profiles, evidence/file uploads (S3 + local), real-time location via Socket.IO, unsigned-XDR transaction building (backend never custodies keys — client signs), admin dashboards, and indexer-lag/RPC-health monitoring. This is a useful checklist cross-reference against the module list already implied by the FaniLab contracts (Phase 1, §12) — it confirms nothing major is missing from the task brief's module list, and adds two concrete ideas worth carrying into Phase 3: **indexer lag monitoring as a first-class health signal**, and **never holding driver/sender private keys — build and return unsigned transactions for client-side signing**, which fits the Soroban `require_auth()` model exactly (every state-changing contract call in Phase 1 requires the calling `Address`'s own signature, not an admin/relay signature except where admin is explicitly the caller).

## 2. Architecture Pattern Used

Traditional Express MVC-ish layering: Controller → Service → Mongoose Model, thin route registration, cross-cutting middleware/validators, and a separate indexer/blockchain layer. Not hexagonal — services import Mongoose models directly, no repository abstraction despite one being aspirationally documented. Dependency direction: routes → controllers → services → models → MongoDB, with the indexer calling back into services.

## 3. Strong Points Worth Adopting

- **Indexer checkpointing as durable state**: persists last-processed ledger per network, exposes lag detection with a configurable threshold and alerting. Directly applicable — `fanilab-backend`'s indexer needs the equivalent (a Prisma `IndexerCheckpoint` model) to safely resume after restarts and to reconcile the two-layer dispute/reputation systems identified in Phase 1 (§4, §5).
- **Idempotent event handlers**: malformed events are skipped (return null / log, don't crash the loop), and duplicate-transaction-hash writes are explicitly guarded. Essential given Soroban RPC event polling can redeliver or replay a range.
- **A resilient, independently unit-tested RPC retry wrapper** (backoff + retryable-error predicate) sitting between the service layer and the raw Soroban client.
- **In-flight guards on scheduled jobs** to prevent overlapping runs.
- **Load tests treated as a way to surface real wiring bugs**, documented candidly rather than hidden.
- **Scoped CSP relaxation only for the API-docs route**, keeping the rest of the API under a strict Helmet policy.

## 4. Weak Points / Anti-Patterns to Deliberately Avoid

- **Duplicate, unreconciled implementations of the same concern committed side by side**: two parallel error-class hierarchies, three auth middlewares split across a `middleware/` and a `middlewares/` directory, two parallel controller/service/model verticals for both escrow and delivery (confirmed by one integration test literally documenting the duplication rather than forcing consolidation), and `server.ts` importing the same job-starter from two different modules. This reads as unresolved merge conflicts and parallel PRs left in the tree.
- **A model file with a genuinely broken/duplicated schema definition** (mismatched braces, two conflicting interfaces, two `mongoose.model()` calls for the same collection).
- **Background work runs via in-process `node-cron`, not a durable queue** — doesn't survive restarts mid-cycle, can't scale horizontally without duplicate-run risk. `docker-compose.yml` has no Redis or worker service at all.
- **Minimal CI** (lint → build → test, no coverage gate, no dedicated indexer/queue test job).
- **Flat, single-directory `tests/`** decoupled from source layout, making coverage gaps hard to spot at a glance.

## 5. Concrete Decisions for FaniLab-Backend Phase 3, Informed by This Review

1. **One canonical vertical per bounded context.** Each module (auth, users, deliveries, escrow, disputes, fleet, reputation, indexer, notifications) gets exactly one domain/application/infrastructure/interface slice. No parallel "old" and "new" implementations of the same entity are ever allowed to coexist — if a module needs to be redone, the old one is deleted in the same change, not left alongside.
2. **Indexer checkpoint + idempotency as first-class domain concepts**, not an afterthought: a `BlockchainCheckpoint` table per contract/network, idempotent event ingestion keyed by `(ledger, tx_hash, event_index)`, and a lag-health check exposed on `/health` and to the metrics layer.
3. **BullMQ + Redis for all background work from day one** (indexer polling, escrow-expiry/dispute-timeout scanning, notification delivery, reputation-sync reconciliation) — no in-process cron. `docker-compose.yml` includes Redis and a distinct worker process/target alongside the API from the first scaffold, directly fixing SwiftChain's gap.
4. **A single resilient Soroban RPC client wrapper** (retry + backoff + circuit breaker), unit-tested in isolation, injected as a Fastify plugin/decorator rather than a singleton import.
5. **One error hierarchy**, normalized through Fastify's `setErrorHandler`, covering Zod validation errors, Prisma errors, and Soroban RPC/contract errors (including the mixed `FaniLabError`/contract-local-error and bare-`panic!`-string cases documented in Phase 1 §3–§4) into one consistent API error shape.
6. **Tests colocated with or 1:1-mirrored against source**, with CI coverage thresholds and a distinct pipeline job for indexer/queue logic vs. HTTP API logic.
7. **Never custody sender/driver/admin private keys for user-initiated actions.** Where a contract call requires `sender`/`recipient`/`driver.require_auth()`, the backend builds an unsigned transaction (XDR) for the client to sign, mirroring SwiftChain's approach — this also matches how Soroban auth actually works per Phase 1's contract review. Only truly backend-owned admin operations (if any are delegated to a backend-held key) would ever be signed server-side, and that decision is deferred to Phase 3's security design, not assumed here.

---

**Next:** Phase 3 — architecture design (diagrams, folder structure, DB schema, event flow, API design), and updating `ROADMAP.md`. No business logic implementation yet.
