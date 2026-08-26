# FaniLab Backend — Contributor Issue Backlog

A contributor-ready backlog of **70 remaining issues** (#31–#100) for [`fanilabs/backend`](https://github.com/fanilabs/backend), authored against `main` at commit `ec15e93` (`v1.0.0`).

> **Published:** backlog items #1–#30 (Sections A and B, plus #27–#30 of Section C) have been filed as GitHub issues **#9–#38** and removed from this file. Backlog numbering of the remaining items is unchanged — item #31 below is GitHub-unpublished, not GitHub issue #31.

Every entry below was verified against the actual implementation — file, function, and behaviour — not inferred from documentation. Where a doc and the code disagree, the code was treated as authoritative and the disagreement is itself recorded as part of the issue.

## How to use this backlog

- Each issue is independently solvable and scoped to a single contributor-sized change.
- Labels are ordinary topical GitHub labels (`bug`, `security`, `enhancement`, `performance`, `testing`, `documentation`, `refactor`, `backend`, `database`, `api`, `authentication`, `authorization`, `devops`, `ci`, `deployment`, `reliability`, `validation`, `dependencies`, `technical-debt`).
- Every issue uses the same structure: title, labels, area/component, then **Problem**, **Current behavior**, **Evidence / code location**, **Impact**, **Expected behavior**, **Proposed scope / implementation direction**, **Acceptance criteria**, **Verification / testing requirements**.
- Nothing below duplicates existing tracker content: GitHub issues #9–#38 are the already-published first batch from this same backlog, and PRs #1–#8 are Dependabot version bumps that no issue here proposes.

## Index

| Section | Issues | Theme |
|---|---|---|
| C | #31–#40 | Read-model correctness |
| D | #41–#45 | Notifications |
| E | #46–#55 | Configuration, Docker & deployment |
| F | #56–#63 | CI/CD & repository tooling |
| G | #64–#73 | API contract & OpenAPI |
| H | #74–#81 | Testing |
| I | #82–#88 | Documentation |
| J | #89–#100 | Maintainability & performance |

---

## Section C — Read-model correctness

---

### #31 — `platformFee` is never populated for escrows released through dispute resolution

- **Labels:** `bug`, `enhancement`, `backend`, `api`
- **Area / component:** `modules/escrow/application/sync-escrow-from-event.ts`, `modules/escrow/domain/entities.ts`

**Problem**
`platformFee` is only ever read from an `escrow_released` event payload. When an escrow reaches `RELEASED` via `dispute_resolved`, no payload carries the fee and no fallback read attempts to recover it, so the field stays `null` on a released escrow.

**Current behavior**
`escrow_released` sets `platformFee` from `payload[2]`. `dispute_resolved` sets only `status` and `releasedAt`. `GET /api/v1/escrow/:chainDeliveryId` therefore returns `status: "RELEASED", platformFee: null` for that path — a state the API's own documentation calls out as a gap but which analytics and any fee-reporting consumer cannot distinguish from "no fee charged".

**Evidence / code location**
- `src/modules/escrow/application/sync-escrow-from-event.ts:43-51` (release payload) vs `:71-88` (dispute path).
- `src/modules/escrow/domain/entities.ts:25-32` — `ChainEscrowRecord` deliberately omits `platformFee` because the on-chain `EscrowRecord` has no such field.
- `src/modules/escrow/interface/routes.ts:31` — serialised as `platformFee: escrow.platformFee?.toString() ?? null`.
- `docs/API_REFERENCE.md` line 61 — documents the gap.

**Impact**
Fee reporting is incomplete and silently so. Because `platformFee` is nullable in the schema, no consumer can tell "fee unknown" from "fee zero".

**Expected behavior**
Either the fee is recovered for dispute-driven releases, or the distinction between "unknown" and "zero" is made explicit in the API.

**Proposed scope / implementation direction**
1. Investigate whether `escrow_contract` emits an `escrow_released` event in addition to `dispute_resolved` on the dispute path (per `PHASE_1_DOMAIN_ANALYSIS.md` §3); if so, the fix is ordering rather than a new read.
2. If not recoverable, add an explicit `platformFeeKnown` boolean (or use a sentinel) so API consumers can distinguish the two cases, and document it.
3. Update `docs/API_REFERENCE.md` and `docs/EVENT_INDEXER.md` with whichever resolution is chosen.

**Acceptance criteria**
- [ ] A dispute-driven release either records the fee or is explicitly marked as fee-unknown in the API response.
- [ ] The behaviour is documented in `docs/API_REFERENCE.md`.
- [ ] `analytics`' GMV reporting is unaffected or updated consistently.

**Verification / testing requirements**
- Unit test in `sync-escrow-from-event.spec.ts` covering the dispute-driven release path's fee handling.

---

### #32 — `senderShareBps` is accepted at build time and then discarded, so it is always `null`

- **Labels:** `enhancement`, `api`, `backend`, `database`
- **Area / component:** `modules/disputes/interface/routes.ts`, `modules/disputes/application/build-dispute-transactions.ts`

**Problem**
`POST /transactions/build/resolve-dispute-split-funds` takes a validated `senderShareBps` (0–10000), passes it into the ScVal encoder, and never records it anywhere. The `Dispute.senderShareBps` column exists but is written by nothing.

**Current behavior**
The `SPLIT` dispute status is set by `dispute_resolved_split`, whose payload is `(caller, delivery_id)` with no share. `Dispute.senderShareBps` therefore stays `null` for every split dispute, and `GET /api/v1/disputes/:chainDeliveryId` reports a split with no split ratio.

**Evidence / code location**
- `src/modules/disputes/interface/schemas.ts:51-55` — `senderShareBps` validated on input.
- `src/modules/disputes/infrastructure/disputes-scval-mapping.ts:69-77` — encoded into the transaction.
- `src/modules/disputes/application/sync-dispute-from-event.ts:88-92` — the `SPLIT` branch records only status/resolver/time.
- `src/modules/disputes/domain/ports.ts:3-9` — `DisputeUpsertFields` has no `senderShareBps`.
- `prisma/schema.prisma:237` — `senderShareBps Int? @map("sender_share_bps")`, written nowhere.
- `src/modules/disputes/domain/entities.ts:13-19` and `docs/API_REFERENCE.md` line 84 both document the gap.

**Impact**
An admin-facing dispute view cannot show how a split was apportioned, even though the backend saw the requested ratio moments earlier. The column and the DTO field advertise data that never arrives.

**Expected behavior**
The requested split ratio is recorded at build time as a *proposed* value and reconciled (or clearly labelled as proposed-not-confirmed) when the matching `dispute_resolved_split` event arrives.

**Proposed scope / implementation direction**
1. In the split-funds build use case, write the requested `senderShareBps` to the dispute row through a new narrow repository method, clearly marked as proposed (e.g. a `proposed_sender_share_bps` column, leaving `sender_share_bps` for a future on-chain source).
2. On `dispute_resolved_split`, promote the proposed value if one exists for the same delivery id.
3. Surface both in the DTO with unambiguous names and document the semantics in `docs/API_REFERENCE.md`.
4. Alternatively, if recording an unsubmitted intent is judged wrong, remove the dead column and DTO field and document the removal — but pick one; the current state advertises a field that can never be non-null.

**Acceptance criteria**
- [ ] After a split-funds build followed by the matching event, the dispute exposes the share ratio.
- [ ] A build that is never signed does not present unconfirmed data as confirmed.
- [ ] `docs/API_REFERENCE.md`'s read-model-gaps note is updated.

**Verification / testing requirements**
- Unit tests in `build-dispute-transactions.spec.ts` and `sync-dispute-from-event.spec.ts`.
- Integration coverage in `prisma-dispute-repository.integration.spec.ts`.

---

### #33 — Out-of-order dispute resolution writes the literal string `'unknown'` into the `raisedBy` address column

- **Labels:** `bug`, `database`, `backend`
- **Area / component:** `modules/disputes/application/sync-dispute-from-event.ts`

**Problem**
`upsertResolution` defends against observing a resolution before its raise by falling back through `existing?.raisedBy ?? resolvedBy ?? 'unknown'`. The final fallback writes a non-address sentinel into a column every other code path treats as a Stellar address.

**Current behavior**
When both the existing row and the resolution's `caller` are absent, `disputes.raised_by` is set to the seven-character string `'unknown'`. That value then flows into `GET /api/v1/disputes/:chainDeliveryId`'s `raisedBy` field, into `GET /api/v1/admin/disputes`' review list, and — critically — into `downloadEvidence`'s authorisation check `isOwnedByUser(requesterId, dispute.raisedBy)`.

**Evidence / code location**
- `src/modules/disputes/application/sync-dispute-from-event.ts:141-159` — `raisedBy: existing?.raisedBy ?? resolvedBy ?? 'unknown'`.
- `src/modules/disputes/interface/schemas.ts:22` — `raisedBy: z.string()`, unconstrained, so the sentinel serialises fine.
- `src/modules/disputes/application/download-evidence.ts:52` — the value is used as an authorisation subject.
- `src/modules/admin/infrastructure/prisma-dispute-review-reader.ts:16` — surfaced to admins.

**Impact**
Poisoned data in a column used for both display and authorisation. The authorisation impact is benign today (no wallet address equals `'unknown'`, so the check simply fails closed), but the field is unusable for its stated purpose and the sentinel is indistinguishable from real data downstream.

**Expected behavior**
`raisedBy` holds a Stellar address or nothing. An event that cannot supply one is either skipped or recorded with the column left null.

**Proposed scope / implementation direction**
1. Make `Dispute.raisedBy` nullable (schema + migration), or keep it non-null and skip the upsert entirely when no address is available, logging a `warn`.
2. Remove the `'unknown'` sentinel.
3. Tighten `raisedBy` in the response DTO to the same Stellar-address regex the request schemas already use, so a bad value fails loudly at the API boundary rather than being served.
4. Add a null-safe guard in `downloadEvidence`'s raiser check.

**Acceptance criteria**
- [ ] No code path can write a non-address value to `raised_by`.
- [ ] A resolution observed without a prior raise and without a caller is handled explicitly (skipped or nulled) with a log line.
- [ ] `downloadEvidence` behaves correctly when `raisedBy` is null.

**Verification / testing requirements**
- Unit tests in `sync-dispute-from-event.spec.ts` for the out-of-order resolution path.
- Update `download-evidence.spec.ts` for the null-raiser case.

---

### #34 — Fleet event handlers mix `create`, `update` and silent-skip inconsistently

- **Labels:** `bug`, `reliability`, `database`, `backend`
- **Area / component:** `modules/fleet/infrastructure/prisma-fleet-repository.ts`

**Problem**
Within one repository, three different strategies are used for the same class of "the parent row may not exist yet" situation: `create` (throws on duplicate), `update` (throws on missing), and an explicit `if (!fleet) return;` guard.

**Current behavior**
- `create` — bare `prisma.fleet.create`, so a replayed `fleet_registered` throws `P2002`.
- `updateTreasury` — bare `prisma.fleet.update`, so a `fleet_treasury_updated` for an unindexed fleet throws `P2025`.
- `inviteDriver` — guards with `if (!fleet) return;`, then upserts the driver row (with a good explanatory comment).
- `acceptInvite` / `removeDriver` — guard on the *fleet* but then `prisma.fleetDriver.update`, which still throws `P2025` if the driver row is missing (e.g. `invite_accepted` observed without its `driver_invited`).

**Evidence / code location**
- `src/modules/fleet/infrastructure/prisma-fleet-repository.ts:57-66` (`create`), `:68-70` (`updateTreasury`), `:72-85` (`inviteDriver`), `:87-95` (`acceptInvite`), `:97-105` (`removeDriver`).
- `src/modules/fleet/application/sync-fleet-from-event.ts:34-77` — all five branches, none of which handles a repository throw.
- `src/modules/fleet/infrastructure/event-subscription.ts` — errors are logged and the event dropped.

**Impact**
Because the indexer starts at the chain tip with no backfill, an existing fleet's subsequent events are the *common* case, not the edge case — so `fleet_treasury_updated`, `invite_accepted` and `driver_removed` for pre-existing fleets all fail. The inconsistency also makes the module's behaviour hard to reason about or test.

**Expected behavior**
All five fleet write paths use one documented strategy for missing/duplicate parents: idempotent upsert where the event carries enough data, explicit skip-with-log where it does not.

**Proposed scope / implementation direction**
1. Convert `create` to an upsert on `chainFleetId`.
2. Convert `updateTreasury` to an `updateMany` (no throw) or an upsert, logging when nothing matched.
3. Make `acceptInvite`/`removeDriver` upsert the `FleetDriver` row (the event carries `fleetId` and `driverAddress`, which is the full unique key) rather than requiring a prior invite row.
4. Replace the silent `return`s with a `debug`-level log naming the skipped event, so the behaviour is observable.

**Acceptance criteria**
- [ ] Each of the five events is idempotent under replay.
- [ ] `invite_accepted` without a preceding `driver_invited` produces a correct `ACTIVE` driver row.
- [ ] `fleet_treasury_updated` for an unknown fleet logs rather than throws.
- [ ] Skips are logged, not silent.

**Verification / testing requirements**
- Unit tests in `sync-fleet-from-event.spec.ts` for each out-of-order permutation.
- Integration coverage in `prisma-fleet-repository.integration.spec.ts`.

---

### #35 — `GET /fleets/:chainFleetId` returns removed drivers with no way to request only current members

- **Labels:** `enhancement`, `api`, `performance`
- **Area / component:** `modules/fleet/infrastructure/prisma-fleet-repository.ts`, `modules/fleet/interface/routes.ts`

**Problem**
Driver removal is a soft delete — the row is kept with `removedAt` set — but the read endpoint returns every driver row ever associated with a fleet, with no filter parameter and no pagination.

**Current behavior**
`findByChainFleetId` does `include: { drivers: true }`. `toFleetWithDrivers` computes `totalActiveDrivers` correctly by filtering in memory, then returns the full unfiltered `drivers` array. A long-lived fleet with high driver churn returns its entire membership history on every request, and every client must re-implement the `removedAt === null` filter the entity's own doc comment tells them to apply.

**Evidence / code location**
- `src/modules/fleet/infrastructure/prisma-fleet-repository.ts:49-55` — `include: { drivers: true }`.
- `src/modules/fleet/infrastructure/prisma-fleet-repository.ts:30-39` — in-memory `totalActiveDrivers` filter.
- `src/modules/fleet/domain/entities.ts:20-28` — "callers that need 'currently in the fleet' must filter on `removedAt === null`".
- `src/modules/fleet/interface/schemas.ts:28-29` — `fleetIdParamsSchema` has no query schema at all.

**Impact**
Unbounded response growth proportional to historical churn, and a correctness footgun pushed onto every client. The soft-delete design is right; the read API just does not expose it usefully.

**Expected behavior**
The endpoint defaults to current members, with an explicit opt-in for the full history, and bounds the driver list.

**Proposed scope / implementation direction**
1. Add a `includeRemoved` boolean query parameter (default `false`) and a driver-list `limit` to a new `getFleetQuerySchema`.
2. Push the filter into the Prisma `include` (`where: { removedAt: null }`) rather than filtering in memory.
3. Keep `totalActiveDrivers` computed from the unfiltered count so it stays correct when the list is filtered or truncated.
4. Update `docs/API_REFERENCE.md` line 63.

**Acceptance criteria**
- [ ] Default response contains only drivers with `removedAt === null`.
- [ ] `includeRemoved=true` returns the historical list.
- [ ] `totalActiveDrivers` is correct in both modes.
- [ ] The driver list is bounded.

**Verification / testing requirements**
- Integration test in `prisma-fleet-repository.integration.spec.ts` with removed and active drivers.
- API test in `fleet-routes.integration.spec.ts` for both modes.

---

### #36 — A dispute raised and resolved purely through `escrow_contract` stays `OPEN` in the read model forever

- **Labels:** `bug`, `enhancement`, `backend`
- **Area / component:** `modules/disputes/application/sync-dispute-from-event.ts`

**Problem**
The dispute read model reconciles two on-chain layers, but only Layer B (`dispute_resolution_contract`) can move a dispute out of `OPEN`. `escrow_contract`'s own `dispute_resolved` is deliberately unhandled because it does not disambiguate the outcome — and unlike the `escrow` module's handler, `disputes` has no fallback read to resolve the ambiguity.

**Current behavior**
`handleEscrowEvent` handles only `delivery_disputed`, creating or updating the dispute row as `OPEN`. When resolution happens purely through Layer A, no Layer B event ever arrives, so the row never leaves `OPEN`. `GET /api/v1/admin/disputes` lists it for review indefinitely; `analytics`' dispute rate counts it; the `disputes` API reports an open dispute for a settled escrow.

**Evidence / code location**
- `src/modules/disputes/application/sync-dispute-from-event.ts:8-48` — the header comment states this is "a real on-chain possibility this read model cannot fully resolve".
- `src/modules/disputes/application/sync-dispute-from-event.ts:115-139` — `handleEscrowEvent` returns early for anything but `delivery_disputed`.
- Contrast `src/modules/escrow/application/sync-escrow-from-event.ts:71-88`, which *does* disambiguate via `getEscrow`.
- `src/modules/disputes/domain/ports.ts:69-71` — `DisputeContractReader` currently exposes only `getDispute`.
- `docs/API_REFERENCE.md` line 84 documents the gap.

**Impact**
Permanently stale dispute state visible in three separate surfaces (public dispute read, admin review queue, analytics), and an admin review queue that accumulates unactionable entries.

**Expected behavior**
A Layer-A-only resolution is reflected in the dispute read model, using the same supplementary-read technique the `escrow` module already applies to the identical ambiguity.

**Proposed scope / implementation direction**
1. Add a narrow escrow-state reader port to the `disputes` module (mirroring `reputation`'s `LegacyDriverProfileReader`, which reads a second contract for one field) — or have `escrow` publish a derived internal event.
2. Handle `escrow.dispute_resolved`: read the escrow's current on-chain status and map `RELEASED` → `RESOLVED_PAYOUT`, `REFUNDED` → `RESOLVED_REFUND`, leaving anything else `OPEN` with a `warn`.
3. Only apply the mapping when no Layer B resolution already exists, so Layer B remains authoritative.
4. Update `docs/API_REFERENCE.md` and `docs/EVENT_INDEXER.md` to remove the documented gap.

**Acceptance criteria**
- [ ] A dispute raised and resolved only via `escrow_contract` reaches a resolved status.
- [ ] A dispute resolved via Layer B is unaffected by any later Layer A event.
- [ ] `GET /api/v1/admin/disputes` no longer lists Layer-A-resolved disputes.

**Verification / testing requirements**
- Unit tests in `sync-dispute-from-event.spec.ts` covering Layer-A-only, Layer-B-only, and both-layers sequences.

---

### #37 — The driver tier formula is reimplemented off-chain with nothing pinning it to the contract

- **Labels:** `technical-debt`, `testing`, `backend`
- **Area / component:** `modules/reputation/application/sync-reputation-from-event.ts`

**Problem**
`tierFromScore` hardcodes the Bronze/Silver/Gold thresholds as a local copy of `identity_reputation_contract`'s `get_driver_tier`. The same file's header comment cites `ROADMAP.md` §13's "no duplicated business logic" rule as the reason for *not* reimplementing the scoring formula — and then reimplements the tier formula immediately below.

**Current behavior**
```
function tierFromScore(score: number): DriverTier {
  if (score >= 75) return 'GOLD';
  if (score >= 50) return 'SILVER';
  return 'BRONZE';
}
```
There is no test asserting these boundaries, no constant shared with any contract artifact, and no comment tying the numbers to a specific contract revision. If the contract's thresholds change, `driver_profiles.tier` and `GET /api/v1/drivers/:address/reputation` silently disagree with `get_driver_tier`.

**Evidence / code location**
- `src/modules/reputation/application/sync-reputation-from-event.ts:96-100` — the duplicated formula.
- `src/modules/reputation/application/sync-reputation-from-event.ts:19-42` — the header comment's own no-duplication argument, and the justification for recomputing rather than making an extra RPC call.
- `src/modules/reputation/domain/entities.ts:20-33` — `ChainDriverProfile` deliberately has no `tier`.
- `src/modules/reputation/application/sync-reputation-from-event.spec.ts` — no boundary-value cases.
- `src/modules/analytics/application/get-driver-tier-distribution.ts` consumes the stored tier, so drift propagates into admin analytics.

**Impact**
A silent-drift risk on a field used for ranking and, potentially, eligibility. The trade-off (recompute locally rather than pay an extra RPC round-trip) is defensible; the absence of any guard against drift is not.

**Expected behavior**
The thresholds are stated in one obvious place, tied explicitly to a contract revision, and covered by boundary tests so a change is a deliberate, reviewed edit.

**Proposed scope / implementation direction**
1. Move the thresholds into an exported, named constant in `modules/reputation/domain/` with a comment citing the exact contract source and revision they mirror.
2. Add boundary tests at 49/50/74/75 and at the extremes.
3. Add a short note to `docs/API_REFERENCE.md`'s reputation section stating that `tier` is derived off-chain from `reputationScore` using those thresholds.
4. Optionally add an opt-in reconciliation check that compares against `get_driver_tier` for a sample of drivers.

**Acceptance criteria**
- [ ] Thresholds live in one named constant.
- [ ] Boundary tests exist for every tier edge.
- [ ] The derivation and its source are documented.

**Verification / testing requirements**
- Boundary-value unit tests in `src/modules/reputation/application/sync-reputation-from-event.spec.ts`.

---

### #38 — Analytics endpoints run unbounded all-time aggregates on every request with no caching

- **Labels:** `performance`, `enhancement`, `api`, `database`
- **Area / component:** `modules/analytics/infrastructure/prisma-analytics-reader.ts`, `modules/analytics/interface/routes.ts`

**Problem**
All four analytics endpoints run full-table `count`/`groupBy` queries with no time filter, no result caching, and no supporting indexes for the specific predicates used.

**Current behavior**
`getGmvByToken` groups the entire `escrows` table by `token` where `status = 'RELEASED'`. `getDeliveryFunnelCounts` runs three unfiltered `count`s. `getDriverTierCounts` groups the whole `driver_profiles` table. Every request recomputes from scratch. `docs/API_REFERENCE.md` line 108 documents the absence of time-range filtering as a deliberate v1 choice, but the cost characteristics are not documented at all, and neither is the absence of caching.

**Evidence / code location**
- `src/modules/analytics/infrastructure/prisma-analytics-reader.ts:12-54`.
- `prisma/schema.prisma:194-222` — `Escrow` has no index on `status` or `token`.
- `prisma/schema.prisma:304-319` — `DriverProfile` has no index on `tier`.
- `src/modules/analytics/interface/routes.ts:36-78` — no cache headers, no cache layer.
- `src/shared/cache/redis-client.ts` — a Redis client exists and is currently used only by the rate limiter.

**Impact**
Each admin dashboard refresh triggers four sequential full scans. At meaningful data volume these become the slowest endpoints in the API, and they run in the request path of the same process serving customer traffic.

**Expected behavior**
Analytics results are cached for a short, configurable TTL, and the queries are backed by appropriate indexes.

**Proposed scope / implementation direction**
1. Add a short-TTL Redis cache (via `src/shared/cache`) in the analytics infrastructure layer, keyed per metric, with the TTL in config.
2. Add the supporting indexes in a migration: `escrows(status, token)` and `driver_profiles(tier)`.
3. Send `Cache-Control` on the responses so an admin UI can also cache.
4. Note the caching behaviour and staleness window in `docs/API_REFERENCE.md`.

**Acceptance criteria**
- [ ] Repeated requests within the TTL do not re-query the database.
- [ ] Indexes exist and are used (verify with `EXPLAIN`).
- [ ] Cache TTL is configurable.
- [ ] Values are still correct after the TTL expires.

**Verification / testing requirements**
- Integration test in `prisma-analytics-reader.integration.spec.ts` with a counting fake or query spy.
- Migration applied cleanly by `pnpm prisma:migrate:deploy` in CI.

---

### #39 — Fraud velocity windows are measured against wall-clock time while activity is stamped with ledger-close time

- **Labels:** `bug`, `reliability`, `backend`
- **Area / component:** `modules/fraud-detection/application/assess-actor.ts`, `modules/fraud-detection/application/record-actor-activity-from-event.ts`

**Problem**
`ActorActivity.occurredAt` is set from `event.closedAt` — the on-chain ledger close time. `assessActor` computes its window boundary from `Date.now()`. The two clocks are only aligned when the indexer has zero lag.

**Current behavior**
`const since = new Date(Date.now() - rule.windowHours * 60 * 60 * 1000)` is compared against `occurredAt >= since`. When the indexer is lagging — the single most important operational signal per `docs/OBSERVABILITY.md` — recently ingested events carry older `occurredAt` values and fall outside the window, so a burst of activity that *just* got indexed may not trigger a rule that it should. Conversely a backlog flush can pack many events into a window they did not really occur in.

**Evidence / code location**
- `src/modules/fraud-detection/application/record-actor-activity-from-event.ts:48,58,65` — `occurredAt: event.closedAt`.
- `src/modules/fraud-detection/application/assess-actor.ts:52-56` — `const now = Date.now();` and the derived `since`.
- `prisma/schema.prisma:343-352` — the model stores both `occurredAt` and `createdAt` (ingestion time); only `occurredAt` is queried.
- `src/shared/events/index.ts:18-20` — the envelope's own comment: "use this, not `new Date()`, when a handler needs an on-chain timestamp."

**Impact**
Velocity rules under- or over-fire depending on indexer lag, exactly when the platform is most likely to be under stress. The `DISPUTE_RAISE_VELOCITY` rule (24-hour window, threshold 3) is especially sensitive.

**Expected behavior**
Window boundaries are computed from the same time base as the stored timestamps, or the intended semantics are stated and both timestamps are used deliberately.

**Proposed scope / implementation direction**
1. Decide the intended semantics: "activity that happened on-chain in the last N hours" (use ledger time as the reference) or "activity this backend observed in the last N hours" (query `createdAt`).
2. For on-chain semantics, derive `now` from the most recent tracked checkpoint's ledger close time rather than `Date.now()`, or accept an injected `Clock`.
3. Inject a `Clock` port either way so the rules are deterministically testable.
4. Document the choice in `docs/API_REFERENCE.md`'s fraud-detection section.

**Acceptance criteria**
- [ ] Window computation uses a single, documented time base.
- [ ] The use case takes an injectable clock/reference so tests are deterministic.
- [ ] A test demonstrates correct behaviour under simulated indexer lag.

**Verification / testing requirements**
- Unit tests in `src/modules/fraud-detection/application/assess-actor.spec.ts` with a fixed clock and lagged `occurredAt` values.

---

### #40 — `actor_activities` grows without bound and has no retention policy

- **Labels:** `reliability`, `database`, `performance`, `backend`
- **Area / component:** `prisma/schema.prisma`, `modules/fraud-detection`

**Problem**
The fraud-detection activity log is append-only by design and nothing ever deletes from it, yet the longest rule window is 24 hours. Rows older than that can never affect any assessment.

**Current behavior**
One row is inserted per relevant blockchain event, forever. `countSince` only ever reads rows newer than 24 hours. There is no pruning job, no partitioning, and no configured retention.

**Evidence / code location**
- `prisma/schema.prisma:336-352` — "durable, append-only … never mutated, only inserted into".
- `src/modules/fraud-detection/infrastructure/prisma-actor-activity-repository.ts:6-16` — `create` and `count`; no delete.
- `src/modules/fraud-detection/application/assess-actor.ts:26-45` — maximum `windowHours` is 24.
- `src/shared/queue/queues.ts:10-14` — no maintenance queue exists to hang a cleanup job on.

**Impact**
Unbounded table growth with no read benefit. The `(address, category, occurredAt)` index grows with it, gradually slowing the very `countSince` queries it exists to serve, and increasing backup size and restore time indefinitely.

**Expected behavior**
A configurable retention window, comfortably longer than the widest rule window, enforced by a scheduled cleanup.

**Proposed scope / implementation direction**
1. Add `FRAUD_ACTIVITY_RETENTION_DAYS` to the env schema and `.env.example` with a default well above 1 day (e.g. 30, to leave room for future rules and for forensic review).
2. Add a repeatable BullMQ job in the worker process that deletes rows older than the retention window in bounded batches.
3. Add the queue to `MONITORED_QUEUES` in `src/shared/queue/queue-health.ts` so failures are visible.
4. Document the policy in `docs/DATABASE.md` and `docs/OBSERVABILITY.md`.

**Acceptance criteria**
- [ ] Rows older than the retention window are removed on a schedule.
- [ ] Deletion is batched so it cannot lock the table for long.
- [ ] Retention is configurable and defaults to a documented value.
- [ ] Assessments are unaffected for any rule window shorter than the retention period.

**Verification / testing requirements**
- Integration test in `prisma-actor-activity-repository.integration.spec.ts` seeding old and recent rows and asserting only old ones are removed.

---

## Section D — Notifications

---

### #41 — A notification row is marked `FAILED` on every attempt, including attempts BullMQ will retry

- **Labels:** `bug`, `backend`, `reliability`
- **Area / component:** `modules/notifications/application/send-notification.ts`

**Problem**
`sendNotification` marks the row `FAILED` and rethrows on any sender error. The rethrow lets BullMQ retry, but the row is already `FAILED` — so a notification that will succeed on attempt 3 spends the intervening minutes advertising itself as permanently failed. The function's own header comment claims the opposite behaviour.

**Current behavior**
```
try { await deps.sender.send(...) } catch (error) { await deps.notificationRepository.markFailed(notification.id); throw error; }
```
The header comment states: "only the last, permanently-failed attempt leaves the row `FAILED`." Nothing in the implementation distinguishes attempt 1 from attempt 5 — the use case receives only a `notificationId` and has no access to `job.attemptsMade`.

**Evidence / code location**
- `src/modules/notifications/application/send-notification.ts:21-62` — comment at lines 28–31, implementation at lines 50-59.
- `src/modules/notifications/infrastructure/queue.ts:37-44` — the worker passes only `job.data.notificationId`; `job` itself is not forwarded.
- `src/shared/queue/queues.ts:19-24` — 5 attempts, exponential backoff from 2 s, so the misleading window spans roughly 30 seconds.
- `src/modules/notifications/interface/routes.ts:46-64` — `GET /api/v1/notifications?status=FAILED` surfaces this state directly to users.

**Impact**
`GET /api/v1/notifications?status=FAILED` and any operator dashboard built on `notifications.status` report failures that are still in flight. The status column cannot be used to drive alerting or a retry UI, and the code contradicts its own documented contract.

**Expected behavior**
The row reflects the real lifecycle: pending/attempting while retries remain, `FAILED` only once BullMQ has exhausted them.

**Proposed scope / implementation direction**
1. Pass `attemptsMade` and `opts.attempts` (or a computed `isFinalAttempt` boolean) from the worker into `SendNotificationInput`.
2. Mark `FAILED` only on the final attempt; otherwise leave the row `PENDING` and rethrow.
3. Optionally add an `attempts` counter column and a `lastError` field so partial failures are still visible without being misreported.
4. Correct the header comment either way.

**Acceptance criteria**
- [ ] A notification that fails twice then succeeds is never observed as `FAILED`.
- [ ] A notification that exhausts all attempts ends as `FAILED`.
- [ ] The header comment matches the implementation.
- [ ] The already-`SENT` early return is preserved.

**Verification / testing requirements**
- Unit tests in `src/modules/notifications/application/send-notification.spec.ts` for the intermediate and final attempt cases.

---

### #42 — `SMS` and `PUSH` notification channels are exposed through the schema and API but can never be produced

- **Labels:** `enhancement`, `technical-debt`, `api`, `backend`
- **Area / component:** `prisma/schema.prisma`, `modules/notifications`

**Problem**
`NotificationChannel` has three variants and the API response schema advertises all three, but the only producer hardcodes `EMAIL` and the only sender implements email. `SMS` and `PUSH` are reachable in the type system, the database enum, and the OpenAPI schema — and unreachable in practice.

**Current behavior**
`dispatchNotificationsFromEvent` always calls `create({ …, channel: 'EMAIL' })`. `NotificationSender.send` takes a `NotificationEmailInput` (`{ to, type, payload }`) with no channel discriminator. `notificationChannel` in the response schema is `z.enum(['EMAIL', 'SMS', 'PUSH'])`, so consumers must handle three cases for a field with one possible value.

**Evidence / code location**
- `prisma/schema.prisma:94-100` — the three-variant enum.
- `src/modules/notifications/application/dispatch-notifications-from-event.ts:72-77` — `channel: 'EMAIL'` hardcoded.
- `src/modules/notifications/domain/ports.ts:62-76` — `NotificationSender` is email-shaped by name and by field.
- `src/modules/notifications/infrastructure/logger-notification-sender.ts` — the only implementation.
- `src/modules/notifications/interface/schemas.ts:3` — all three exposed to clients.
- `docs/API_REFERENCE.md` line 101 — "channel is always `EMAIL` for v1".

**Impact**
API consumers are given a contract wider than the implementation, which is exactly the "placeholder implementation" pattern `CONTRIBUTING.md` § Code Standards prohibits. It also makes the eventual multi-channel implementation harder, since `NotificationSender`'s shape assumes email.

**Expected behavior**
Either the channel abstraction is completed (a channel-dispatching sender with per-channel adapters and per-user channel preferences), or the surface is narrowed to what exists until it is.

**Proposed scope / implementation direction**
Two viable directions; pick one in the issue thread before starting.
- **Narrow (smaller):** restrict the response schema's `channel` enum to `['EMAIL']`, keep the database enum for forward compatibility, and document why.
- **Complete (larger):** rename `NotificationSender.send`'s input to a channel-agnostic shape, add a `ChannelRouter` selecting an adapter by `notification.channel`, add `SMS`/`PUSH` adapter stubs that throw a clear "channel not configured" `NotificationDeliveryError` (the class already exists and is currently unused), and add per-user channel preference resolution at dispatch time.

**Acceptance criteria**
- [ ] The API's `channel` field cannot report a value the system can never produce, or the system can genuinely produce all advertised values.
- [ ] `NotificationDeliveryError` is either used or removed.
- [ ] `docs/API_REFERENCE.md` matches.

**Verification / testing requirements**
- Update `src/modules/notifications/interface/notifications-routes.integration.spec.ts` for the chosen contract.

---

### #43 — Notification dispatch reaches only the acting party, never the counterparty who needs to know

- **Labels:** `enhancement`, `backend`, `api`
- **Area / component:** `modules/notifications/application/dispatch-notifications-from-event.ts`

**Problem**
The dispatch handler resolves a recipient only from an address already present in the event's topic or payload. For the events that matter most to a waiting counterparty — a delivery being confirmed, an escrow being refunded, a dispute being resolved — the payload names either nobody or the acting admin, so no notification is produced.

**Current behavior**
`resolveCandidate` covers six event types and returns `null` for everything else. The header comment enumerates the reasons honestly: no address in the payload, or the only address present is the actor's own. The stated blocker is that resolving the counterparty would require reading another module's read-model table. The `deliveries` read model, however, already contains `senderAddress`, `recipientAddress` and `driverAddress` for exactly this purpose, and both `analytics` and `admin` already read other modules' tables under a documented, `ARCHITECTURE.md`-sanctioned exception.

**Evidence / code location**
- `src/modules/notifications/application/dispatch-notifications-from-event.ts:23-59` — the scope rationale.
- `src/modules/notifications/application/dispatch-notifications-from-event.ts:90-194` — the six covered cases.
- `src/modules/analytics/domain/ports.ts:3-19` and `src/modules/admin/domain/ports.ts:3-16` — the existing cross-module read-model precedent.
- `prisma/schema.prisma:166-192` — `Delivery` carries all three party addresses.

**Impact**
The notification module's product value is largely unrealised: a sender is never told their delivery was confirmed or cancelled, a driver is never told an escrow was refunded, and neither party is told a dispute they are in was resolved. ROADMAP objective 6 lists notifications as a headline deliverable.

**Expected behavior**
Events whose counterparty can be resolved from an existing read model produce notifications for that counterparty.

**Proposed scope / implementation direction**
1. Add a narrow `DeliveryPartyLookup` port to `modules/notifications/domain/ports.ts` — `findParties(chainDeliveryId): { sender, recipient, driver } | null` — documented on the same precedent as `UserContactLookup`.
2. Implement it in `modules/notifications/infrastructure/` over the `deliveries` table.
3. Extend `resolveCandidate` to emit one notification per resolvable interested party for `delivery_confirmed`, `delivery_cancelled`, `DeliveryInTransit`, `escrow_refunded`, and the three `dispute_resolved_*` events.
4. Return an array of candidates rather than a single one, and de-duplicate against the acting address so nobody is notified of their own action.
5. Update `docs/EVENT_INDEXER.md`'s event-to-notification table and `docs/API_REFERENCE.md`'s notifications section.

**Acceptance criteria**
- [ ] `delivery_confirmed` notifies the sender and the driver, not the confirming recipient.
- [ ] `dispute_resolved_*` notifies both dispute parties, not the acting admin.
- [ ] Addresses with no linked account are still silently skipped.
- [ ] No duplicate notifications for one event/recipient pair.

**Verification / testing requirements**
- Unit tests in `dispatch-notifications-from-event.spec.ts` for each newly covered event.
- Integration test asserting the enqueued job count per event.

---

### #44 — `GET /api/v1/notifications` supports only `limit`, so users cannot page past their newest N

- **Labels:** `enhancement`, `api`, `performance`
- **Area / component:** `modules/notifications/application/list-notifications.ts`, `modules/notifications/infrastructure/prisma-notification-repository.ts`

**Problem**
The list endpoint accepts a `limit` (max 100) and always returns the newest matching rows. There is no cursor, offset, or date filter, so notification #101 onwards is unreachable through the API.

**Current behavior**
`listByUserId` does `findMany({ where, orderBy: { createdAt: 'desc' }, take: filter.limit })` with no `skip` or `cursor`. The maximum obtainable history is 100 notifications, permanently.

**Evidence / code location**
- `src/modules/notifications/interface/schemas.ts:16-19` — only `status` and `limit`.
- `src/modules/notifications/application/list-notifications.ts:13-26` — `DEFAULT_LIMIT` 20, `MAX_LIMIT` 100.
- `src/modules/notifications/infrastructure/prisma-notification-repository.ts:36-43` — no cursor.
- `docs/API_REFERENCE.md` line 98 documents the limits but not the inability to page.

**Impact**
A user with any meaningful activity permanently loses access to older notifications. The capping is correct; the missing continuation is the gap. `admin`'s audit-log endpoint has the identical shape and the identical gap, so the two are worth solving with one pattern.

**Expected behavior**
Cursor-based pagination using the existing `createdAt` ordering, with continuation metadata returned in the envelope's `meta` field.

**Proposed scope / implementation direction**
1. Add a `before` (ISO timestamp) or opaque `cursor` query parameter.
2. Thread it into `ListNotificationsFilter` and the Prisma `cursor`/`skip: 1` or a `createdAt: { lt: … }` predicate.
3. Return `ok(items, { limit, nextCursor })`.
4. Add the supporting composite index `notifications(user_id, created_at desc)` — see #96.
5. Apply the same pattern to `GET /api/v1/admin/audit-log`.
6. Update `docs/API_REFERENCE.md` for both.

**Acceptance criteria**
- [ ] A user with more than `MAX_LIMIT` notifications can retrieve all of them by following the cursor.
- [ ] Ordering is stable across pages.
- [ ] `status` filtering composes with pagination.
- [ ] The response carries continuation metadata.

**Verification / testing requirements**
- Integration test in `prisma-notification-repository.integration.spec.ts` paging a seeded set.
- API test asserting `meta.nextCursor`.

---

### #45 — The default `Mailer` and `NotificationSender` log secrets and remain the production default

- **Labels:** `security`, `reliability`, `deployment`, `backend`
- **Area / component:** `modules/auth/infrastructure/logger-mailer.ts`, `modules/notifications/infrastructure/logger-notification-sender.ts`, module composition roots

**Problem**
Both default adapters write their full content — including raw email-verification and password-reset tokens — to the structured log at `info` level. Both are wired unconditionally in their module composition roots, with no environment gate. A production deployment that has not swapped them in gets a running, apparently-healthy service that silently logs credentials and delivers no mail.

**Current behavior**
`createLoggerMailer()` logs `{ to, token }`. The logger's redaction config removes any field named `token` at the top level or one level down — `'*.token'` — but the mailer logs `{ to, token }` as the *top-level* merge object, where the redaction path `'*.token'` does not match a bare `token` key. Verify this against your Pino version before assuming either way; either the token is logged in clear, or the intended redaction is silently masking the developer-facing purpose the adapter exists for. Meanwhile `createAuthModule` always calls `createLoggerMailer()` and `createNotificationsBackgroundWorker` always calls `createLoggerNotificationSender()` — neither checks `NODE_ENV`.

**Evidence / code location**
- `src/modules/auth/infrastructure/logger-mailer.ts:14-23` — `log.info({ to, token }, …)`.
- `src/shared/logger/index.ts:20-31` — `redact.paths` includes `'*.token'` (one level of nesting) and `remove: true`.
- `src/modules/auth/index.ts:33` — `const mailer = createLoggerMailer();`, unconditional.
- `src/modules/notifications/index.ts:62` — `const sender = createLoggerNotificationSender();`, unconditional.
- `docs/AUTHENTICATION.md` § Dev email delivery describes these as "genuinely functional dev-defaults" — accurate for development, unmanaged for production.

**Impact**
Two distinct failures. Operationally: a production deployment silently sends no email, so users cannot verify addresses or reset passwords, and nothing reports the misconfiguration. Security: if the redaction path does not in fact match, password-reset tokens land in the log pipeline in clear text — a credential in a system typically retained longer and shared more widely than the mail it replaced.

**Expected behavior**
The logging adapters are development/test-only. In `production` the process either uses a configured real provider or fails fast at boot with a clear message, consistent with the fail-fast philosophy `src/shared/config/env.ts` already applies to secrets.

**Proposed scope / implementation direction**
1. First, empirically determine whether `'*.token'` redacts the current call shape; adjust the redaction paths (add bare `'token'`, `'to'` if appropriate) regardless of the rest of this change.
2. Add a `MAIL_PROVIDER` / `NOTIFICATION_PROVIDER` config value (`logger` | a real provider name) with `logger` disallowed when `NODE_ENV=production`.
3. In the composition roots, select the adapter from config and throw a clear startup error for the disallowed combination.
4. Update `docs/AUTHENTICATION.md`, `docs/DEPLOYMENT.md` and `docs/SECURITY.md`.

**Acceptance criteria**
- [ ] Booting with `NODE_ENV=production` and no configured provider fails at startup with a clear message.
- [ ] Development and test behaviour is unchanged.
- [ ] Verification and reset tokens do not appear in log output at any level, verified against real output.

**Verification / testing requirements**
- Unit test on the composition-root selection logic for each `NODE_ENV`.
- A test that captures logger output and asserts no token substring is present.

---

## Section E — Configuration, Docker & deployment

---

### #46 — Dispute evidence written inside the container is lost on every restart

- **Labels:** `bug`, `deployment`, `devops`, `reliability`
- **Area / component:** `docker-compose.yml`, `modules/disputes/infrastructure/local-evidence-storage.ts`

**Problem**
`EVIDENCE_STORAGE_DIR` defaults to the relative path `./storage/evidence`, which resolves inside the container's writable layer. `docker-compose.yml` declares volumes for Postgres, Redis, Prometheus and Grafana — but none for the API's evidence directory.

**Current behavior**
`createLocalEvidenceStorage(config.EVIDENCE_STORAGE_DIR)` resolves `./storage/evidence` against the process working directory (`/app`), and `save()` writes there. The `api` service in `docker-compose.yml` has no `volumes:` key at all. `docker compose up --build`, `docker compose down`, or any container recreation destroys every uploaded evidence file, while the corresponding `evidence` rows — with their `storageUrl` and content hash — survive in Postgres.

**Evidence / code location**
- `src/shared/config/env.ts:42-44` — `EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence')`.
- `src/modules/disputes/infrastructure/local-evidence-storage.ts:20-30` — `path.resolve(baseDir)` then `writeFile`.
- `docker-compose.yml:32-46` — the `api` service, no volume mount.
- `docker-compose.yml:96-100` — the `volumes:` block, which has no entry for evidence.
- `.dockerignore` explicitly excludes `storage/evidence/` from the build context, confirming it is intended as runtime data.

**Impact**
Permanent, silent loss of dispute evidence — the one class of data in this system that is legally and commercially significant and that exists *only* here. `GET /api/v1/disputes/evidence/:evidenceId/download` then fails with an unmapped `ENOENT` from `readFile`, surfacing as a 500. This is the deployment topology `docs/DEPLOYMENT.md` presents as validated.

**Expected behavior**
Evidence files persist across container restarts and rebuilds, exactly as Postgres data does.

**Proposed scope / implementation direction**
1. Add a named volume (e.g. `evidence-data`) to `docker-compose.yml`, mounted into the `api` service at an absolute path.
2. Set `EVIDENCE_STORAGE_DIR` to that absolute path in the `api` service's `environment` block, so it does not depend on the working directory.
3. Change the config default to an absolute path, or document clearly that the relative default is development-only.
4. Map `readFile`'s `ENOENT` to a domain `NotFoundError` so a missing file returns 404 rather than 500.
5. Document the volume and its backup requirements in `docs/DEPLOYMENT.md`.

**Acceptance criteria**
- [ ] Uploading evidence, then `docker compose down && docker compose up`, still allows download.
- [ ] A genuinely missing file returns a `404` in the standard error envelope.
- [ ] `docs/DEPLOYMENT.md` names the volume and its backup requirement.

**Verification / testing requirements**
- Manual verification of the upload → recreate → download cycle, recorded in the PR.
- Unit test for the `ENOENT` mapping in `local-evidence-storage.spec.ts`.

---

### #47 — The container runs as `USER node` but cannot create the evidence directory it needs

- **Labels:** `bug`, `deployment`, `devops`, `security`
- **Area / component:** `Dockerfile`, `modules/disputes/infrastructure/local-evidence-storage.ts`

**Problem**
`WORKDIR /app` creates `/app` owned by `root`. The final `api` stage copies files in as `root` and then switches to `USER node`. At runtime, evidence storage calls `mkdir('/app/storage/evidence', { recursive: true })` — a write into a root-owned directory by an unprivileged user.

**Current behavior**
The first evidence upload attempts `mkdir` under the root-owned `/app` and fails with `EACCES`. The error is not mapped by the error handler, so `POST /api/v1/disputes/:chainDeliveryId/evidence` returns a generic 500 `INTERNAL_ERROR`. Nothing in the boot sequence checks that the configured storage directory is writable, so the failure only appears on first use.

**Evidence / code location**
- `Dockerfile:12` — `WORKDIR /app` in the `base` stage, as root.
- `Dockerfile:52-61` — the `api` stage: `COPY --from=…` as root, then `USER node`, with no `chown` and no `mkdir` of the storage path.
- `src/modules/disputes/infrastructure/local-evidence-storage.ts:25-26` — `await mkdir(dir, { recursive: true })`.
- `src/shared/config/env.ts:44` — default `./storage/evidence`, relative to `/app`.
- `docs/DEPLOYMENT.md` § Status lists the four bugs found when `docker compose up` was first run for real; evidence upload was not exercised in that run.

**Impact**
Evidence upload — a headline feature (ROADMAP objective 5) and the subject of the Phase 6 security fix — is non-functional in the shipped production image. Running as a non-root user is correct and should be kept; the missing directory ownership is the bug.

**Expected behavior**
The container can write to its configured evidence directory as the `node` user, and a non-writable directory fails loudly at boot rather than on first upload.

**Proposed scope / implementation direction**
1. In the `api` stage, create the storage directory and `chown` it: `RUN mkdir -p /var/lib/fanilab/evidence && chown -R node:node /var/lib/fanilab/evidence` before `USER node`.
2. Point `EVIDENCE_STORAGE_DIR` at that absolute path (coordinate with #46's volume mount).
3. Add a startup writability check in `createDisputesModule` (or in `buildApp`) that throws a clear configuration error, consistent with the fail-fast posture in `docs/DEPLOYMENT.md`.
4. Do the same in the `worker` stage if any worker path ever writes evidence.

**Acceptance criteria**
- [ ] `docker compose up` followed by an evidence upload succeeds end to end.
- [ ] The container still runs as a non-root user.
- [ ] A non-writable storage directory fails at boot with a clear message.

**Verification / testing requirements**
- Manual `docker compose up` + upload + download, recorded in the PR (this is exactly the class of bug `docs/DEPLOYMENT.md` § Status says only a real run catches).
- Add the flow to the e2e suite once #74 lands.

---

### #48 — No container healthcheck or restart policy for the `api` and `worker` services

- **Labels:** `devops`, `deployment`, `reliability`
- **Area / component:** `docker-compose.yml`, `Dockerfile`

**Problem**
`postgres` and `redis` both declare healthchecks and are depended on with `condition: service_healthy`. The `api` and `worker` services declare neither a healthcheck nor a restart policy, even though the application exposes purpose-built probes.

**Current behavior**
`docker compose ps` reports `api` as running the moment the process starts, before it can serve traffic. A crashed or wedged `worker` — the process that runs the entire indexer — stays down until someone notices, because there is no `restart:` key. Nothing consumes `GET /health`, despite `docs/DEPLOYMENT.md` instructing operators to point their orchestrator's readiness probe at it.

**Evidence / code location**
- `docker-compose.yml:32-60` — `api` and `worker`; no `healthcheck:`, no `restart:`.
- `docker-compose.yml:14-18,26-30` — `postgres`/`redis` healthchecks, showing the intended pattern.
- `Dockerfile:52-71` — no `HEALTHCHECK` instruction in either final stage.
- `src/shared/http/routes/health.ts:23-39` — `GET /health` returns 200/503 and is designed for exactly this.
- `docs/DEPLOYMENT.md` § Health Checks.

**Impact**
The reference local/staging topology cannot express "the API is ready" or "restart the worker if it dies", so the documented health endpoints go unused in the one deployment artifact the project ships. Prometheus and Grafana (the `observability` profile) start against an `api` that may not be listening yet.

**Expected behavior**
Both services declare a healthcheck against their real readiness signal and a restart policy, and the Dockerfile carries a default `HEALTHCHECK` for the `api` image.

**Proposed scope / implementation direction**
1. Add `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` to the `api` stage.
2. Add matching `healthcheck:` and `restart: unless-stopped` to the `api` service in compose.
3. Give `worker` a `restart: unless-stopped` and a liveness check — a lightweight one, since it has no HTTP surface (a marker file touched by the poll job, or a small internal port).
4. Make `prometheus`/`grafana` depend on `api` with `condition: service_healthy`.
5. Document both in `docs/DEPLOYMENT.md`.

**Acceptance criteria**
- [ ] `docker compose up -d` shows `api` as `healthy` only once `/health` returns 200.
- [ ] Killing the `worker` process causes an automatic restart.
- [ ] The `observability` profile starts after `api` is healthy.

**Verification / testing requirements**
- Manual `docker compose up`, `docker compose ps`, and a forced `docker kill` of the worker, recorded in the PR.

---

### #49 — `docker compose up` never applies database migrations, so the documented quick-start yields a broken stack

- **Labels:** `deployment`, `devops`, `documentation`, `bug`
- **Area / component:** `docker-compose.yml`, `README.md`, `docs/DEPLOYMENT.md`

**Problem**
`README.md`'s "Full stack via Docker Compose" section says `cp .env.example .env && make docker-up` brings up the stack. Nothing in that path runs `prisma migrate deploy`, so the API and worker start against an empty schema.

**Current behavior**
`make docker-up` runs `docker compose up -d --build`. Neither the `api` nor the `worker` service runs migrations, and there is no one-shot migrate service. Every query fails at runtime with a Prisma "table does not exist" error. The only documented remedy is `docs/DEPLOYMENT.md`'s release-process step 4, which correctly insists migrations be an explicit reviewed step — good policy for production, but it leaves the advertised local quick-start non-functional with no in-band fix.

**Evidence / code location**
- `README.md` § Full stack via Docker Compose — two commands, neither of which migrates.
- `Makefile:69-70` — `docker-up: docker compose up -d --build`.
- `docker-compose.yml:32-60` — no migrate service, no migration command.
- `Dockerfile:52-71` — `CMD ["node", "dist/server.js"]`, no entrypoint script.
- `docs/DEPLOYMENT.md` § Release Process step 4 — `pnpm prisma:migrate:deploy` as a separate step, and an explicit prohibition on auto-migration at API boot.

**Impact**
A new contributor following the README gets a stack that builds, starts, reports the containers as up, and fails every request. This is the project's first-run experience.

**Expected behavior**
The compose stack applies migrations before the API and worker start, without violating the "never auto-migrate on API boot in production" rule.

**Proposed scope / implementation direction**
1. Add a one-shot `migrate` service to `docker-compose.yml` built from the same image, running `pnpm prisma:migrate:deploy` (or `npx prisma migrate deploy`), depending on `postgres` being healthy.
2. Make `api` and `worker` depend on it with `condition: service_completed_successfully`.
3. Keep it out of the production topology — or document it clearly as the local/dev convenience it is, preserving `docs/DEPLOYMENT.md`'s production rule.
4. Add a `make docker-migrate` target and correct the README's quick-start.

**Acceptance criteria**
- [ ] A clean `docker compose down -v && make docker-up` produces a stack that serves `GET /api/v1/deliveries` successfully.
- [ ] The API process itself still does not migrate on boot.
- [ ] `docs/DEPLOYMENT.md`'s production guidance is unchanged.
- [ ] README's quick-start is accurate as written.

**Verification / testing requirements**
- Manual clean-volume verification, recorded in the PR.

---

### #50 — `SETTLEMENT_CONTRACT_ID` is validated and documented but read by no code

- **Labels:** `technical-debt`, `documentation`, `deployment`
- **Area / component:** `shared/config/env.ts`, `.env.example`

**Problem**
The env schema declares `SETTLEMENT_CONTRACT_ID`, `.env.example` documents it alongside the five real contract ids, and no module, indexer entry, or test ever reads it.

**Current behavior**
`grep -r SETTLEMENT_CONTRACT_ID src` matches exactly one line — its own declaration in the schema. `getTrackedContracts()` deliberately excludes settlement, with a comment explaining that `settlement_contract` is an unimplemented on-chain stub with no consuming module planned. `.env.example` lists it with the other five under a heading that says modules needing them "will fail fast with a clear error" — which is untrue for this one, since nothing needs it.

**Evidence / code location**
- `src/shared/config/env.ts:37` — the only occurrence in `src/`.
- `.env.example:41` — listed with the other contract ids.
- `src/modules/indexer/index.ts:18-35` — the exclusion and its rationale.
- `ROADMAP.md` §9 — multi-currency settlement is explicitly out of scope for v1, blocked on the contract itself.

**Impact**
An operator configuring a deployment reasonably assumes setting this variable enables settlement indexing. It does nothing. It is the only configuration knob in the file with no effect, and `CONTRIBUTING.md` prohibits exactly this kind of half-wired placeholder.

**Expected behavior**
The variable is either removed until settlement is real, or explicitly annotated as reserved-and-unused in both the schema and `.env.example`.

**Proposed scope / implementation direction**
1. Preferred: remove it from `src/shared/config/env.ts` and `.env.example`, with a one-line note in `ROADMAP.md` §9 that it returns when `settlement_contract` is implemented.
2. If it must stay for forward compatibility, add a comment in both files stating that it is currently unused and why, mirroring the indexer's own exclusion comment.

**Acceptance criteria**
- [ ] No configuration variable is documented as functional while having no reader.
- [ ] Existing deployments that set the variable are unaffected (extra environment variables are ignored by the Zod schema).
- [ ] The rationale is captured in exactly one place.

**Verification / testing requirements**
- Add an env-schema test (see #77) asserting the schema's key set matches `.env.example`'s, so this class of drift cannot recur.

---

### #51 — The logger reads `LOG_LEVEL` straight from `process.env`, bypassing the validated config

- **Labels:** `bug`, `reliability`, `backend`
- **Area / component:** `shared/logger/index.ts`

**Problem**
`src/shared/logger/index.ts` reads `process.env.LOG_LEVEL` directly and prefers it over the parsed config, even though `getConfig()` is called on the very same line for `NODE_ENV` and `LOG_LEVEL`.

**Current behavior**
```
const level = process.env.LOG_LEVEL ?? (getConfig().NODE_ENV === 'test' ? 'silent' : getConfig().LOG_LEVEL);
```
The Zod schema constrains `LOG_LEVEL` to a seven-value enum, but that validation is bypassed: `LOG_LEVEL=verbose` (a valid Winston level, not a Pino one) reaches `pino({ level: 'verbose' })` directly and throws at module load, before the config's clear, actionable error message could be produced. It also means `LOG_LEVEL=info` in a test environment silently overrides the intended `silent` default.

**Evidence / code location**
- `src/shared/logger/index.ts:15-16` — the raw read.
- `src/shared/config/env.ts:10` — `LOG_LEVEL: z.enum([...]).default('info')`.
- `src/shared/config/env.ts:3-7` — the schema's own header: "Failing fast here (instead of discovering a missing var mid-request) is the whole point."
- `docs/DEPLOYMENT.md` § Configuration — "an invalid or missing required variable fails startup immediately with a clear error".

**Impact**
An invalid `LOG_LEVEL` crashes the process with a Pino internal error rather than the documented configuration error, in the one module every other module imports first. It is also the only place in the codebase that bypasses `getConfig()`, undermining the single-source-of-truth property the config module exists for.

**Expected behavior**
The logger derives its level entirely from validated config.

**Proposed scope / implementation direction**
1. Replace the raw read with `const config = getConfig();` and derive the level from `config.LOG_LEVEL` / `config.NODE_ENV`.
2. Preserve the "silent in test unless explicitly set" behaviour by adding an explicit config field (e.g. keeping the enum but letting `NODE_ENV=test` default it to `silent` inside the Zod schema via a `superRefine`/transform), so the intent is expressed in one place.
3. Keep the existing explanatory comment about Fastify's deprecated per-instance logging flag.

**Acceptance criteria**
- [ ] An invalid `LOG_LEVEL` produces the standard "Invalid environment configuration" error, not a Pino crash.
- [ ] `pnpm test` output remains quiet by default.
- [ ] Explicitly setting `LOG_LEVEL` in a test run still takes effect.

**Verification / testing requirements**
- Env-schema unit test (see #77) covering an invalid level.

---

### #52 — Disconnect helpers leave stale singletons behind, so post-shutdown access returns closed clients

- **Labels:** `bug`, `reliability`, `backend`
- **Area / component:** `shared/cache/redis-client.ts`, `shared/queue/connection.ts`, `shared/database/prisma-client.ts`

**Problem**
All three shared connection modules memoise a module-level singleton and expose a `disconnect*` function that closes the connection without clearing the reference. A subsequent `get*` returns the closed object rather than reconnecting.

**Current behavior**
`disconnectRedis()` does `await client?.quit()` and leaves `client` set. `disconnectQueueConnection()` and `disconnectPrisma()` are identical. `closeAllQueues()`, by contrast, *does* clear its map — showing the intended pattern exists in the same directory.

**Evidence / code location**
- `src/shared/cache/redis-client.ts:26-28` — `await client?.quit();` with no `client = undefined`.
- `src/shared/queue/connection.ts:23-25` — same.
- `src/shared/database/prisma-client.ts:19-21` — same.
- `src/shared/queue/queues.ts:39-42` — `closeAllQueues` correctly does `queues.clear()`.
- `src/server.ts:13-22` and `src/workers/index.ts:67-76` — both shutdown handlers call all three.

**Impact**
Any code path that touches a connection after shutdown begins — a request already in flight, a `closeWithGrace` handler ordering issue, or a test suite that disconnects and then builds a second app — gets a dead client and a confusing `Connection is closed` error instead of a fresh connection. It also makes these modules untestable in isolation, since there is no way to reset them between cases.

**Expected behavior**
Disconnecting resets the singleton, so a later `get*` transparently establishes a new connection.

**Proposed scope / implementation direction**
1. Set the module-level variable to `undefined` after closing, in all three files.
2. Guard against double-disconnect (already safe via `?.`).
3. Consider exporting a `resetForTesting()` in each, or simply document that `disconnect*` is the reset path.

**Acceptance criteria**
- [ ] `disconnectRedis(); getRedisClient();` yields a usable client.
- [ ] The same holds for the queue connection and the Prisma client.
- [ ] Shutdown paths in `server.ts` and `workers/index.ts` are unaffected.

**Verification / testing requirements**
- Unit tests for each module's connect → disconnect → reconnect cycle (integration-gated where a real service is required).

---

### #53 — `CORS_ORIGIN` is parsed by naive string splitting with no validation

- **Labels:** `security`, `validation`, `deployment`
- **Area / component:** `shared/config/env.ts`, `shared/http/plugins/security.ts`

**Problem**
`CORS_ORIGIN` is a plain `z.string()` with a default. The security plugin splits it on commas and trims each part, with no validation that each part is a well-formed origin and no handling of empty segments.

**Current behavior**
`config.CORS_ORIGIN.split(',').map((o) => o.trim())`. A trailing comma or a double comma (`"https://a.example,,"`) yields an empty string in the allow-list. A value with a path or a trailing slash (`"https://a.example/"`) silently never matches any real `Origin` header, so CORS fails at runtime with no configuration error. There is no explicit rejection of `*`, which combined with `credentials: true` would be exactly the configuration `docs/SECURITY.md` promises never to allow.

**Evidence / code location**
- `src/shared/config/env.ts:24` — `CORS_ORIGIN: z.string().default('http://localhost:3000')`.
- `src/shared/http/plugins/security.ts:31-34` — the split and `credentials: true`.
- `docs/SECURITY.md` § Baseline HTTP Security — "explicit allow-listed origins … never a wildcard with credentials enabled" — enforced by convention only.
- `.env.example:23` — a single origin, so the multi-value path is never exercised by the documented default.

**Impact**
A misconfigured origin list fails silently at request time rather than at boot, contradicting the config module's fail-fast contract. The wildcard-with-credentials prohibition is a documented promise with no code enforcing it.

**Expected behavior**
The origin list is validated at boot: each entry a well-formed scheme+host+optional-port origin with no path, empty entries rejected, and `*` rejected outright while `credentials: true` is set.

**Proposed scope / implementation direction**
1. Change the schema to `z.string().transform(s => s.split(',').map(x => x.trim()).filter(Boolean))` followed by a `.refine()` validating each entry with `new URL()` and asserting `url.origin === entry`.
2. Reject `*` explicitly with a message referencing the credentials interaction.
3. Have the security plugin consume the already-parsed array rather than splitting again.
4. Show a multi-origin example in `.env.example`.

**Acceptance criteria**
- [ ] An empty, malformed, or path-bearing origin fails at boot with a clear message.
- [ ] `CORS_ORIGIN=*` fails at boot.
- [ ] A valid comma-separated list works, including with surrounding whitespace.

**Verification / testing requirements**
- Env-schema unit tests (see #77) for each rejected form.
- API test asserting an allow-listed origin is reflected and a non-listed one is not.

---

### #54 — `/health/queue` latches to `degraded` for a week after a single failed job

- **Labels:** `bug`, `reliability`, `devops`, `deployment`
- **Area / component:** `shared/http/routes/health.ts`, `shared/queue/queues.ts`

**Problem**
`GET /health/queue` returns `503 degraded` whenever any monitored queue has `failed > 0`. BullMQ retains failed jobs for `removeOnFail: { age: 604_800 }` — seven days. One transient failure therefore keeps the endpoint at 503 for a week, long after the underlying condition has cleared.

**Current behavior**
`status: queues.every((q) => q.failed === 0) ? 'ok' : 'degraded'`, and a 503 when degraded. The route's own comment defends the "any failure at all is the signal" threshold, which is reasonable as an *alert*; the problem is that the signal never clears on its own and the endpoint is documented as a health check.

**Evidence / code location**
- `src/shared/http/routes/health.ts:41-57` — the latch and the 503.
- `src/shared/queue/queues.ts:19-24` — `removeOnFail: { age: 604_800 }`.
- `docs/DEPLOYMENT.md` § Health Checks lists `/health/queue` alongside `/health` and `/health/indexer` as orchestrator-facing probes.
- `docs/OBSERVABILITY.md` § Health Checks repeats the same framing.
- `src/shared/queue/queue-health.integration.spec.ts` — covers the counts, not the latching behaviour.

**Impact**
If an operator follows the documentation and points a readiness probe at `/health/queue`, one transient notification-send failure takes the API out of the load-balancer pool for seven days. Even used purely for alerting, an alert that cannot self-clear trains operators to ignore it.

**Expected behavior**
The endpoint distinguishes "there are failed jobs in history" from "the queue is currently unhealthy" — for example by reporting recent failures, or by returning 200 with a `degraded` body and leaving the 503 for a genuinely unavailable queue.

**Proposed scope / implementation direction**
1. Decide the endpoint's contract: liveness/readiness probe, or alerting signal. `docs/DEPLOYMENT.md` currently implies the former.
2. Return `200` with `status: 'degraded'` for historical failures, reserving `503` for an unreachable Redis or a stalled queue (e.g. `waiting` growing while `active` is zero).
3. Add a `failedRecent` count over a bounded window so the signal can clear.
4. Update both docs to state which probe an orchestrator should use.

**Acceptance criteria**
- [ ] A single historical failed job does not keep the endpoint at 503 indefinitely.
- [ ] A genuinely broken queue still produces a non-200.
- [ ] The response distinguishes historical from current failures.
- [ ] `docs/DEPLOYMENT.md` and `docs/OBSERVABILITY.md` describe the actual contract.

**Verification / testing requirements**
- Extend `src/shared/queue/queue-health.integration.spec.ts` with a failed-job scenario asserting the status code.

---

### #55 — `prisma/seed.ts` is an advertised placeholder that seeds nothing

- **Labels:** `technical-debt`, `documentation`, `devops`
- **Area / component:** `prisma/seed.ts`, `package.json`, `Makefile`

**Problem**
`pnpm seed`, `make seed`, and Prisma's own `prisma.seed` hook all point at a script whose entire body prints a warning that no seed data is defined.

**Current behavior**
`main()` constructs a `PrismaClient`, logs `[seed] No seed data defined yet — add module seed steps as they land.`, and disconnects. All twelve modules have since landed. `make help` still advertises `make seed  Run the database seed script`.

**Evidence / code location**
- `prisma/seed.ts:8-15` — the placeholder body.
- `package.json` `scripts.seed` and `prisma.seed` — both wired.
- `Makefile:66-67` and `Makefile:20` — the target and its help text.
- `CONTRIBUTING.md` § Code Standards — "No placeholder/TODO-filled implementations."

**Impact**
A new contributor following `README.md` gets an empty database and no way to exercise any read endpoint — every `GET` returns 404 or an empty list, and the read models cannot be populated at all without a live Soroban deployment emitting events. This is a significant barrier to the contributor experience `ROADMAP.md` §1 names as a first-class deliverable.

**Expected behavior**
`pnpm seed` produces a small, coherent local dataset that makes every read endpoint demonstrable without a live chain.

**Proposed scope / implementation direction**
1. Seed an `ADMIN` and a `CUSTOMER` account with known credentials (development-only, loudly logged), plus a linked wallet for each.
2. Seed a handful of `Delivery` / `Escrow` / `Dispute` / `Fleet` / `DriverProfile` rows covering each status, respecting the existing foreign keys.
3. Make the script idempotent (upserts) and refuse to run when `NODE_ENV=production`.
4. Document what it creates in `README.md` and `docs/DATABASE.md`.

**Acceptance criteria**
- [ ] `pnpm seed` on a migrated empty database populates every read model.
- [ ] Running it twice is safe.
- [ ] It refuses to run against `NODE_ENV=production`.
- [ ] The seeded admin credentials are documented and obviously development-only.

**Verification / testing requirements**
- Run `pnpm seed` against a fresh database in CI (or a smoke test) and assert non-zero row counts in each seeded table.

---

## Section F — CI/CD & repository tooling

---

### #56 — CI has no dependency-vulnerability audit step

- **Labels:** `ci`, `security`, `dependencies`, `devops`
- **Area / component:** `.github/workflows/ci.yml`

**Problem**
The CI workflow runs format, lint, typecheck, build and test. It never audits the dependency tree for known vulnerabilities, so a PR can introduce or inherit a vulnerable transitive package and still show a fully green check set.

**Current behavior**
Three jobs — `lint-and-typecheck`, `build`, `test`. `pnpm audit` appears nowhere in the workflow, nowhere in `package.json`'s scripts, and nowhere in the `Makefile`. `docs/SECURITY.md` § Dependency Management describes Dependabot as the whole of the dependency story, but Dependabot only *proposes* upgrades — it does not fail a build on a known-vulnerable dependency that no upgrade has been merged for.

**Evidence / code location**
- `.github/workflows/ci.yml:19-86` — the three jobs.
- `package.json` `scripts` — no audit script.
- `.github/dependabot.yml` — weekly npm/docker/actions updates, majors ignored for npm.
- `docs/SECURITY.md` § Dependency Management.
- `ROADMAP.md` §5 Phase 4 lists "production-grade security … CI/CD from the first scaffold" as a deliverable.

**Impact**
The project has 20 runtime dependencies including `jsonwebtoken`, `bcrypt`, `@stellar/stellar-sdk` and `ioredis` — all security-relevant. A published advisory against any of them, or their transitive tree, goes unnoticed between Dependabot's weekly runs and produces no signal at all on PRs.

**Expected behavior**
CI fails, or at minimum warns visibly, when the dependency tree contains a known vulnerability at or above a chosen severity.

**Proposed scope / implementation direction**
1. Add an `audit` job running `pnpm audit --audit-level=high` (adjust the level after seeing the current baseline).
2. Add a matching `pnpm audit` script to `package.json` so contributors can run it locally.
3. If the current tree has unfixable advisories, record them in a documented ignore list with a rationale and an owner, rather than lowering the threshold globally.
4. Note the new required check in `docs/SECURITY.md` and `CONTRIBUTING.md`.

**Acceptance criteria**
- [ ] A dependency with a high-severity advisory fails CI.
- [ ] The job runs on every PR and on `main`.
- [ ] Any accepted exceptions are listed with a reason.
- [ ] `docs/SECURITY.md` describes the check.

**Verification / testing requirements**
- Confirm the job passes on the current tree, and demonstrate the failure path once (e.g. against a deliberately pinned vulnerable version in a scratch branch).

---

### #57 — Coverage is collected and uploaded but no threshold is enforced

- **Labels:** `ci`, `testing`, `devops`
- **Area / component:** `vitest.config.ts`, `.github/workflows/ci.yml`

**Problem**
CI runs `pnpm test:coverage` and uploads the report as an artifact, but the Vitest coverage config declares no thresholds. Coverage can fall arbitrarily without failing a build.

**Current behavior**
`coverage: { provider: 'v8', reporter: ['text', 'lcov'], include: ['src/**/*.ts'], exclude: [specs, index files] }` — no `thresholds` key. The `test` job runs the command and uploads `coverage/` with a 14-day retention. Nothing reads the numbers.

**Evidence / code location**
- `vitest.config.ts:8-14` — the coverage block.
- `.github/workflows/ci.yml:80-86` — the run and the artifact upload.
- `CONTRIBUTING.md` § Workflow — "No PR that adds behavior without a test for it will be merged", enforced by review alone.
- `ROADMAP.md` §10 — the testing strategy commits to unit, integration and API tests across every layer.

**Impact**
The one automated signal that could enforce the contribution standard is collected and discarded. Coverage regressions are invisible in review, and the artifact is only inspected if someone thinks to download it.

**Expected behavior**
A coverage floor is enforced in CI, starting at the current measured level so the change is non-disruptive, and ratcheted upward deliberately.

**Proposed scope / implementation direction**
1. Run `pnpm test:coverage` locally to establish the current baseline (note that integration specs skip without a database, so measure in a CI-equivalent environment).
2. Add `thresholds: { lines, functions, branches, statements }` to `vitest.config.ts`, set just below the measured baseline.
3. Consider per-directory thresholds so `src/shared/` and `src/blockchain/` — the highest-blast-radius code — can be held to a higher bar.
4. Document the floor and the ratchet policy in `CONTRIBUTING.md`.

**Acceptance criteria**
- [ ] A PR that materially lowers coverage fails CI.
- [ ] Thresholds are committed and match the documented baseline.
- [ ] The existing artifact upload still works.

**Verification / testing requirements**
- Confirm CI passes at the chosen threshold and fails when a covered file's tests are removed.

---

### #58 — CI never builds the Docker image, so `Dockerfile` regressions are only found by hand

- **Labels:** `ci`, `devops`, `deployment`, `reliability`
- **Area / component:** `.github/workflows/ci.yml`, `Dockerfile`

**Problem**
`pnpm build` compiles TypeScript, but no CI job builds the container image. The `Dockerfile` is a load-bearing artifact that is validated only when a human runs `docker compose up`.

**Current behavior**
No `docker build`, `docker/build-push-action`, or `docker compose build` step exists in either workflow. `docs/DEPLOYMENT.md` § Status documents that the first real `docker compose up` — which happened during Phase 6, after every module had shipped — immediately surfaced four latent bugs: a missing `.dockerignore`, a Prisma-client copy step that never worked under pnpm, native build scripts silently skipped, and a missing OpenSSL package. All four were invisible to CI.

**Evidence / code location**
- `.github/workflows/ci.yml` — three jobs, none of which touches Docker.
- `.github/workflows/release.yml:22-27` — builds TypeScript and drafts a release; no image build.
- `docs/DEPLOYMENT.md` § Status — the four bugs and the explicit note that they were "latent the whole time".
- `Dockerfile:25-50` — a long, subtle multi-stage sequence with extensive explanatory comments about failure modes.
- Issues #46 and #47 in this backlog are two further container-only defects still present.

**Impact**
The most fragile file in the repository has no automated verification, in a project whose own deployment documentation records that exactly this gap produced four production-blocking bugs at once.

**Expected behavior**
CI builds both the `api` and `worker` targets on every PR, and preferably boots the compose stack far enough to prove the API answers `/health`.

**Proposed scope / implementation direction**
1. Add a `docker` job building both targets with `docker/build-push-action` (no push), using GitHub Actions layer caching.
2. Optionally extend it to `docker compose up -d` with `postgres`/`redis`, run migrations, and poll `/health` until 200 or timeout — a genuine smoke test.
3. Keep it non-blocking initially if build time is a concern, then promote it to required.
4. Note the new check in `docs/DEPLOYMENT.md` § Status.

**Acceptance criteria**
- [ ] Both image targets build in CI on every PR.
- [ ] A deliberate `Dockerfile` break fails the job.
- [ ] Build time stays acceptable with caching.

**Verification / testing requirements**
- Verify the job catches a reverted `.dockerignore` or a removed `openssl` install.

---

### #59 — The release workflow publishes without running lint, typecheck or tests

- **Labels:** `ci`, `deployment`, `reliability`, `devops`
- **Area / component:** `.github/workflows/release.yml`

**Problem**
`release.yml` triggers on a `v*.*.*` tag and runs `pnpm install && pnpm build` before drafting a GitHub Release. It never runs `pnpm lint`, `pnpm typecheck` or `pnpm test`.

**Current behavior**
The workflow assumes the tagged commit passed CI on `main`. Nothing enforces that: a tag can be pushed to any commit, including one that never went through a PR, and the release job will happily draft a release from it. `docs/DEPLOYMENT.md` § Release Process step 1 states the assumption ("Merge to `main` (CI green…)") as a manual precondition.

**Evidence / code location**
- `.github/workflows/release.yml:8-28` — the single job.
- `.github/workflows/ci.yml:3-7` — CI triggers on `push` to `main` and `pull_request`, not on tags.
- `docs/DEPLOYMENT.md` § Release Process steps 1–3.

**Impact**
An untested commit can become a tagged release. `build` alone catches only type errors that `tsc -p tsconfig.build.json` surfaces — and since `tsconfig.build.json` narrows the include set relative to `tsconfig.json`, it is strictly weaker than `pnpm typecheck`.

**Expected behavior**
A tagged release runs the same verification gate as a merge to `main`.

**Proposed scope / implementation direction**
1. Extract the CI jobs into a reusable workflow (`workflow_call`) and invoke it from `release.yml` as a prerequisite job.
2. Alternatively, add `pnpm lint && pnpm typecheck && pnpm test` to the release job, with the Postgres/Redis service containers CI already defines.
3. Gate the `softprops/action-gh-release` step on that job succeeding.
4. Update `docs/DEPLOYMENT.md` to describe the enforced gate rather than the manual precondition.

**Acceptance criteria**
- [ ] Tagging a commit whose tests fail does not produce a draft release.
- [ ] The verification uses the same commands and service containers as CI.
- [ ] Release notes generation is unchanged.

**Verification / testing requirements**
- Dry-run on a scratch tag in a fork, or verify via `act`/workflow-dispatch.

---

### #60 — The release workflow does not build or publish the container images the deployment runbook depends on

- **Labels:** `deployment`, `devops`, `ci`
- **Area / component:** `.github/workflows/release.yml`, `docs/DEPLOYMENT.md`

**Problem**
`docs/DEPLOYMENT.md` § Release Process step 4 instructs the operator to "build/push the `api` and `worker` images", but no automation does so and no registry is named anywhere in the repository.

**Current behavior**
The release workflow produces a draft GitHub Release containing source archives and auto-generated notes. There is no image build, no registry login, no tag scheme, and no published artifact corresponding to the `api`/`worker` targets that `docker-compose.yml` and `docs/DEPLOYMENT.md` are both written around. Deploying a tagged version requires an operator to build locally from a checkout — which is exactly how the four Phase 6 Docker bugs stayed hidden.

**Evidence / code location**
- `.github/workflows/release.yml:22-28`.
- `docs/DEPLOYMENT.md` § Release Process step 4 and step 5 ("Roll out `api`/`worker` images").
- `Dockerfile:52-71` — the two named build targets.
- `ROADMAP.md` §11 — "Containerized: separate `api` and `worker` images/targets from one multi-stage Dockerfile".

**Impact**
The documented release process cannot be followed as written. Every deployment is a hand-built image with no provenance, no immutable digest, and no guarantee it matches the tagged source.

**Expected behavior**
Tagging a release builds and publishes both images to a registry, tagged with the release version and a stable moving tag.

**Proposed scope / implementation direction**
1. Publish to GitHub Container Registry (`ghcr.io/fanilabs/backend-api`, `…-worker`) using the workflow's existing `GITHUB_TOKEN` with `packages: write`.
2. Use `docker/metadata-action` for tags (`vX.Y.Z`, `X.Y`, `latest`) and `docker/build-push-action` for both targets, ideally multi-arch.
3. Gate on the verification job from #59.
4. Reference the published image names in `docs/DEPLOYMENT.md` and consider an `image:`-based compose override for non-local use.

**Acceptance criteria**
- [ ] A `v*.*.*` tag publishes both images with the expected tags.
- [ ] Image digests are recorded in the release notes or job summary.
- [ ] `docs/DEPLOYMENT.md` names the published images.

**Verification / testing requirements**
- Verify on a pre-release tag; pull and boot the published image against the compose stack.

---

### #61 — Husky is configured but no `pre-commit` hook exists, so `lint-staged` never runs

- **Labels:** `ci`, `devops`, `technical-debt`
- **Area / component:** `.husky/`, `package.json`

**Problem**
`package.json` declares a `lint-staged` configuration and a `prepare` script that installs Husky, and `.husky/_/` contains Husky's generated shims — but there is no `.husky/pre-commit` file for the shim to delegate to. No hook ever executes.

**Current behavior**
`git config core.hooksPath` is `.husky/_`, and `.husky/_/pre-commit` exists as a Husky shim. Husky shims look for a corresponding hook script at `.husky/<name>`; `.husky/` contains only the `_` directory. The `lint-staged` block (`eslint --fix` on `*.{ts,js}`, `prettier --write` on `*.{ts,js,json,md,yml,yaml}`) is therefore dead configuration.

**Evidence / code location**
- `.husky/` — contains only `_/`; `find .husky -maxdepth 1 -type f` returns nothing.
- `package.json` `scripts.prepare` — `node -e "try{require('husky')}catch(e){process.exit(0)}" && husky || true`.
- `package.json` `lint-staged` — the configured tasks.
- `ROADMAP.md` §13 — "ESLint + Prettier enforced in CI and via pre-commit hook".
- `.github/workflows/ci.yml:30-31` — `pnpm format:check` and `pnpm lint` in CI, so the CI half of that statement is true.

**Impact**
Contributors get no local feedback and discover formatting/lint failures only after pushing and waiting for CI — the exact friction the tooling was added to remove. Two `devDependencies` (`husky`, `lint-staged`) are installed for no effect.

**Expected behavior**
A committed `pre-commit` hook runs `lint-staged`, matching the documented standard.

**Proposed scope / implementation direction**
1. Add an executable `.husky/pre-commit` containing `pnpm lint-staged` (Husky v9 format — no sourcing boilerplate needed).
2. Ensure it is committed with the executable bit set and that `.husky/_` remains git-ignored.
3. Consider a `commit-msg` hook validating Conventional Commits, since `ROADMAP.md` §13 and `CONTRIBUTING.md` both require them and nothing enforces it.
4. Note the hook in `CONTRIBUTING.md` § Development Setup.

**Acceptance criteria**
- [ ] A commit touching a `.ts` file runs ESLint and Prettier on the staged files.
- [ ] A fresh clone plus `pnpm install` installs the hook automatically.
- [ ] The hook does not run in CI (Husky already skips in non-interactive installs).

**Verification / testing requirements**
- Fresh-clone verification: `pnpm install`, stage a deliberately misformatted file, confirm the hook fixes or rejects it.

---

### #62 — Type-aware ESLint rules are disabled, so floating promises are caught only by hand-written `void`

- **Labels:** `technical-debt`, `ci`, `reliability`
- **Area / component:** `eslint.config.js`

**Problem**
The config uses `tseslint.configs.recommended`, not `recommendedTypeChecked`, so `@typescript-eslint/no-floating-promises` and `no-misused-promises` are off. The codebase compensates manually with `void` prefixes on dozens of `reply.send(...)` calls.

**Current behavior**
Every route handler in the repository writes `void reply.status(200).send(...)`. Each one is a manual assertion that the promise is intentionally unawaited. Nothing verifies that a contributor who omits the `void` — or who forgets to `await` a genuine async call, as in a repository write inside a sync-from-event handler — is caught by tooling.

**Evidence / code location**
- `eslint.config.js:26` — `...tseslint.configs.recommended`, with no `parserOptions.projectService` / `project`.
- `eslint.config.js:88-98` — the manual rule block, which sets only `no-unused-vars`, `consistent-type-imports` and `no-console`.
- `void reply.` appears in every module's `interface/routes.ts` (deliveries, escrow, fleet, disputes, reputation, notifications, analytics, fraud-detection, admin, auth, users) and in `shared/http/routes/{health,metrics}.ts` and `shared/errors/error-handler.ts`.
- `ROADMAP.md` §13 — "TypeScript strict mode, no implicit `any`" plus an architecture boundary rule, both of which the config does enforce.

**Impact**
The single most common class of async bug in a Fastify/Prisma codebase — an unawaited promise producing a silently swallowed rejection or an out-of-order write — is not detectable by the lint suite. In event-handler code paths (`sync-*-from-event.ts`), a missed `await` would surface as a read model that intermittently fails to update, with no error anywhere.

**Expected behavior**
Type-aware linting is enabled, at least for `no-floating-promises` and `no-misused-promises`, so the `void` markers are verified rather than trusted.

**Proposed scope / implementation direction**
1. Add `parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }` to the `src/**/*.ts` block.
2. Enable `tseslint.configs.recommendedTypeChecked` (or enable the two rules individually to keep the initial diff small).
3. Fix whatever it surfaces — expect this to be the bulk of the work, and expect it to find real issues.
4. Measure lint runtime; type-aware linting is slower, so confirm CI time stays acceptable.

**Acceptance criteria**
- [ ] `no-floating-promises` and `no-misused-promises` are enabled and the repository is clean under them.
- [ ] `pnpm lint` runtime remains acceptable in CI.
- [ ] Existing boundary rules still pass.

**Verification / testing requirements**
- Confirm the rules fire on a deliberately unawaited promise in a scratch commit.

---

### #63 — `CODEOWNERS` names a GitHub org that does not exist and omits half the modules

- **Labels:** `documentation`, `ci`, `technical-debt`
- **Area / component:** `CODEOWNERS`

**Problem**
Every rule assigns `@fanilab/maintainers`, but the repository lives under the `fanilabs` organisation. A CODEOWNERS entry naming a non-existent team is silently ignored by GitHub, so no reviewer is ever auto-requested. The per-module rules also stop at `indexer`, missing four shipped modules and both cross-cutting layers.

**Current behavior**
The file's own header says it is "a placeholder so the file's structure (and CI's expectation that it exists) is in place from day one", to be updated "once the repository is transferred to the FaniLab GitHub organization". `gh repo view` reports the owner as `fanilabs`. Directory rules exist for `auth`, `users`, `deliveries`, `escrow`, `fleet`, `disputes`, `reputation`, `indexer`, plus `/src/blockchain/`, `/prisma/`, `/.github/` and `/docs/SECURITY.md` — with no entries for `notifications`, `analytics`, `fraud-detection`, `admin`, `/src/shared/` or `/src/workers/`.

**Evidence / code location**
- `CODEOWNERS:1-3` — the placeholder header.
- `CODEOWNERS:5-17` — every rule uses `@fanilab/maintainers`.
- Repository owner per the GitHub API: `fanilabs`.
- `src/modules/` — twelve module directories; only eight have rules.
- `ROADMAP.md` §12 — "`CODEOWNERS` mapping each module directory to responsible reviewers".

**Impact**
No automatic review requests on any PR, including PRs touching `/docs/SECURITY.md` and `/prisma/` — the two paths the file most clearly intends to protect. Four modules and the shared kernel have no ownership expressed at all. Anyone reading the file reasonably believes review routing is configured.

**Expected behavior**
CODEOWNERS references a real team in the correct organisation and covers every module and cross-cutting directory.

**Proposed scope / implementation direction**
1. Correct the org slug to `@fanilabs/<team>` (confirm the actual team name with a maintainer before merging).
2. Add rules for `notifications`, `analytics`, `fraud-detection`, `admin`, `/src/shared/` and `/src/workers/`.
3. Remove the now-inaccurate "once the repository is transferred" header.
4. Enable "Require review from Code Owners" in branch protection, or note in `CONTRIBUTING.md` that it is advisory.

**Acceptance criteria**
- [ ] GitHub's CODEOWNERS validation (visible in the repo's UI) reports no unknown-owner errors.
- [ ] A PR touching `src/modules/admin/` auto-requests the owning team.
- [ ] Every `src/modules/*` directory and both cross-cutting directories have a rule.

**Verification / testing requirements**
- Open a draft PR touching a newly covered path and confirm the review request appears.

---

## Section G — API contract & OpenAPI

---

### #64 — The OpenAPI server URL double-prefixes every documented path

- **Labels:** `bug`, `api`, `documentation`
- **Area / component:** `shared/http/plugins/docs.ts`, `src/app.ts`

**Problem**
`@fastify/swagger` derives OpenAPI paths from each route's fully-resolved URL, which already includes the `/api/v1` prefix applied at registration. The document *also* declares `servers: [{ url: '/api/v1' }]`, so a client resolving a path against the server base produces `/api/v1/api/v1/...`.

**Current behavior**
Every module plugin is registered with `{ prefix: '/api/v1' }`, so a route declared as `/auth/register` is recorded by the swagger plugin as `/api/v1/auth/register`. The generated document pairs that path with a `/api/v1` server base. Swagger UI's "Try it out" therefore issues requests to `/api/v1/api/v1/auth/register`, which 404s, and any generated client inherits the same bug.

**Evidence / code location**
- `src/shared/http/plugins/docs.ts:13-23` — `servers: [{ url: '/api/v1' }]`.
- `src/app.ts:83-94` — twelve `app.register(…, { prefix: '/api/v1' })` calls.
- `src/modules/auth/interface/routes.ts:43` — routes declared without the prefix, e.g. `app.post('/auth/register', …)`.
- `docs/API_REFERENCE.md:3` — "The live, authoritative reference is … served at `/api-docs` … if the two ever disagree, `/api-docs` is correct."

**Impact**
The project's self-declared authoritative API reference is unusable for interactive exploration and produces broken generated clients. It also breaks the `/health*` and `/metrics` routes' documentation differently — those are registered without a prefix, so they are recorded correctly as `/health` and then incorrectly rebased under `/api/v1`.

**Expected behavior**
Paths and the server base compose to the real URLs, for both `/api/v1`-prefixed business routes and unprefixed operational routes.

**Proposed scope / implementation direction**
1. Remove the `/api/v1` `servers` entry (leaving the paths, which are already absolute and correct), or declare `servers: [{ url: '/' }]`.
2. Verify by fetching `/api-docs/json` and checking a known path against a real request.
3. Consider tagging routes by module so the UI groups them usefully.
4. Add an assertion to the observability/route integration tests so this cannot regress.

**Acceptance criteria**
- [ ] "Try it out" in Swagger UI succeeds against `POST /api/v1/auth/register`.
- [ ] `/health` is documented at a path that actually resolves.
- [ ] A generated client from `/api-docs/json` hits the correct URLs.

**Verification / testing requirements**
- Integration test fetching `/api-docs/json` and asserting the composed URL for at least one prefixed and one unprefixed route.

---

### #65 — The OpenAPI document declares no security scheme, so authenticated routes are undocumented as such

- **Labels:** `documentation`, `api`, `security`
- **Area / component:** `shared/http/plugins/docs.ts`, every module's `interface/routes.ts`

**Problem**
Roughly two-thirds of the API requires a bearer token and several routes additionally require the `ADMIN` role, but the generated OpenAPI document contains no `securitySchemes`, no `security` requirement, and no per-operation annotation. Swagger UI offers no way to authorize.

**Current behavior**
`docsPlugin` registers `@fastify/swagger` with `openapi: { info, servers }` only. Auth is enforced purely through Fastify `preHandler` arrays, which the schema generator cannot see. Consumers must read `docs/API_REFERENCE.md` prose to learn which endpoints need a token — and that prose is currently wrong for two of them (#2, #3).

**Evidence / code location**
- `src/shared/http/plugins/docs.ts:13-23` — no `components.securitySchemes`.
- `src/shared/http/plugins/auth-guard.ts:18-47` — `authenticate` / `requireRole`, applied per route.
- Every `interface/routes.ts` — `preHandler: authenticate` or `preHandler: adminOnly`, with no corresponding `schema.security`.
- `docs/API_REFERENCE.md:3` — asserts `/api-docs` is authoritative.

**Impact**
The interactive documentation cannot exercise any protected endpoint, which is most of the API. Generated clients omit authentication entirely. There is also no machine-readable record of the auth requirements, so drift like #2/#3 cannot be caught automatically.

**Expected behavior**
The document declares a `bearerAuth` HTTP scheme, and every protected operation carries the corresponding `security` requirement.

**Proposed scope / implementation direction**
1. Add `components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }` to the swagger options.
2. Add `security: [{ bearerAuth: [] }]` to each protected route's `schema`. Consider a small helper that pairs the `preHandler` and the `security` annotation so the two cannot diverge.
3. Document the `ADMIN` requirement in each admin-only operation's `description`.
4. Confirm Swagger UI's Authorize button works end to end.

**Acceptance criteria**
- [ ] `/api-docs` offers an Authorize control accepting a bearer token.
- [ ] Every route with an `authenticate` preHandler carries a `security` requirement in the document.
- [ ] Public routes carry none.

**Verification / testing requirements**
- Integration test fetching `/api-docs/json` and cross-checking the set of operations carrying `security` against the set of routes with an auth preHandler (this also gives #79 a foundation).

---

### #66 — The OpenAPI document reports version `0.1.0` while the package is at `1.0.0`

- **Labels:** `documentation`, `api`
- **Area / component:** `shared/http/plugins/docs.ts`

**Problem**
The API version advertised in the OpenAPI `info` block is hardcoded to `0.1.0`, three phases and one tagged release out of date.

**Current behavior**
`info: { title: 'FaniLab Backend API', description: …, version: '0.1.0' }` — a literal, written during the Phase 4 scaffold and never updated. `package.json` is at `1.0.0` and the repository has a `v1.0.0` tag; the most recent commit on `main` (`ec15e93`) exists specifically to align `package.json` with that tag.

**Evidence / code location**
- `src/shared/http/plugins/docs.ts:15-19` — `version: '0.1.0'`.
- `package.json` — `"version": "1.0.0"`.
- Commit `ec15e93` — "chore: bump package.json version to match v1.0.0 tag".
- `README.md` — "**Status:** `v1.0.0`".

**Impact**
Generated clients and API consumers are told they are talking to a pre-release API. Any consumer keying behaviour off the reported version gets the wrong answer, and the value will drift again at the next release.

**Expected behavior**
The documented version is derived from a single source of truth and updates automatically with the package version.

**Proposed scope / implementation direction**
1. Import the version from `package.json` (`resolveJsonModule` is already enabled in `tsconfig.json`), or read it from an env/build-time constant.
2. Confirm the import works under the `NodeNext` module resolution the project uses, and that the JSON is available in the built `dist/` output — adjust the build config if not.
3. Add a test asserting the documented version equals the package version.

**Acceptance criteria**
- [ ] `/api-docs/json` reports the current package version.
- [ ] A future version bump requires no change to `docs.ts`.
- [ ] The compiled `dist/` build still starts.

**Verification / testing requirements**
- Integration test comparing `info.version` to the package version.

---

### #67 — No route declares its error responses, so the OpenAPI document only describes success

- **Labels:** `documentation`, `api`
- **Area / component:** every module's `interface/routes.ts` and `interface/schemas.ts`

**Problem**
Every route declares `response: { 200: … }` (or `201`), and none declares any 4xx or 5xx shape. The generated document therefore describes only the happy path, despite the codebase having a rigorously consistent error envelope.

**Current behavior**
`handleError` produces `{ error: { code, message, details? } }` for every failure, with a well-defined code set (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BLOCKCHAIN_ERROR`, `INTERNAL_ERROR`). None of that appears in OpenAPI. The one partial exception is `/health/indexer`, which declares both `200` and `503` — showing the mechanism works and is simply unused elsewhere.

**Evidence / code location**
- `src/shared/errors/app-error.ts:21-61` — the seven error classes and their codes.
- `src/shared/errors/error-handler.ts:5-11` — `ErrorResponseBody`.
- `src/modules/indexer/interface/routes.ts:21-24` — the only route declaring a non-2xx response.
- All other `interface/routes.ts` files — success-only response schemas.
- `docs/API_REFERENCE.md:9` — documents the envelope in prose and points readers at `src/shared/errors` for the code list.

**Impact**
Generated clients cannot type or handle errors. The relationship between an endpoint and the specific errors it can produce — `409 CONFLICT` on duplicate registration, `403 FORBIDDEN` on cross-user notification access, `502 BLOCKCHAIN_ERROR` on an unconfigured contract — exists only in prose that must be maintained by hand.

**Expected behavior**
A shared error-response schema is declared once and attached to every route for the status codes that route can actually produce.

**Proposed scope / implementation direction**
1. Define an `errorResponseSchema` in `src/shared/http/` mirroring `ErrorResponseBody`, with `code` as an enum of the known codes.
2. Add a small helper (e.g. `withErrors(schema, [400, 401, 404])`) so each route declares its real set without boilerplate.
3. Apply it route by route, using `docs/API_REFERENCE.md`'s existing per-module error notes as the source list.
4. Note in `docs/API_REFERENCE.md` that the error contract is now machine-readable.

**Acceptance criteria**
- [ ] Every route declares at least its authentication and validation error responses.
- [ ] The declared error schema matches what `handleError` actually emits.
- [ ] Serialisation of real error responses is unaffected (Fastify only serialises declared response schemas for matching status codes — verify no error body is stripped).

**Verification / testing requirements**
- API tests asserting that a real 401/404/409 body validates against the declared schema.

---

### #68 — Unknown query parameters are silently dropped, so a mistyped filter returns unfiltered results

- **Labels:** `api`, `validation`, `enhancement`
- **Area / component:** every module's `interface/schemas.ts`

**Problem**
Zod objects strip unrecognised keys by default. A client that sends `?sender=G...` instead of `?senderAddress=G...` gets a `200` with the *entire* unfiltered result set rather than an error.

**Current behavior**
`listDeliveriesQuerySchema` is a plain `z.object` with four optional fields. A typo'd or obsolete parameter is silently discarded, and — because every filter is optional (#11) — the request degrades to "return everything". The same pattern applies to `listNotificationsQuerySchema` and `listAuditLogQuerySchema`, where a mistyped `limit` silently reverts to the default.

**Evidence / code location**
- `src/modules/deliveries/interface/schemas.ts:33-38`.
- `src/modules/notifications/interface/schemas.ts:16-19`.
- `src/modules/admin/interface/schemas.ts:25-27`.
- `src/app.ts:50-51` — `setValidatorCompiler(validatorCompiler)` from `fastify-type-provider-zod`, which uses the schema's own parsing mode.
- `docs/SECURITY.md` § Baseline HTTP Security — "every route's request body/params/query validated by a Zod schema … before handler code runs", which is true but does not extend to rejecting unknown keys.

**Impact**
A client bug becomes a silent data-over-fetch rather than a clear `400`. For `GET /api/v1/deliveries` specifically, the failure mode is "accidentally download the whole table" (see #11). It also makes API deprecations invisible: a removed parameter keeps returning `200`.

**Expected behavior**
Unknown query parameters produce a `400 VALIDATION_ERROR` naming the offending key.

**Proposed scope / implementation direction**
1. Add `.strict()` to the query schemas across all modules.
2. Consider the same for request-body schemas, weighing forward compatibility — document whichever policy is chosen.
3. Verify the resulting Zod error maps cleanly through `handleError`'s `FST_ERR_VALIDATION` branch into the standard envelope.
4. State the policy in `docs/API_REFERENCE.md` § Conventions.

**Acceptance criteria**
- [ ] `GET /api/v1/deliveries?sender=X` returns `400` naming `sender`.
- [ ] Valid parameter sets are unaffected.
- [ ] The error uses the standard envelope with `code: 'VALIDATION_ERROR'`.

**Verification / testing requirements**
- API tests per module asserting the rejection and the error shape.

---

### #69 — Error responses carry no request id, making a reported failure untraceable in logs

- **Labels:** `enhancement`, `api`, `reliability`
- **Area / component:** `shared/errors/error-handler.ts`, `shared/http/response-envelope.ts`

**Problem**
Fastify generates a request id and includes it in every log line, but the HTTP error envelope does not expose it. A user reporting "I got a 500" gives support nothing to correlate against.

**Current behavior**
`ErrorResponseBody` is `{ error: { code, message, details? } }`. `handleError` receives the `request` object — and uses it for `request.log` — but never reads `request.id`. Once #12 masks 5xx messages, the response will carry no distinguishing information at all.

**Evidence / code location**
- `src/shared/errors/error-handler.ts:5-11` — the response body interface.
- `src/shared/errors/error-handler.ts:37-41` — `request` is in scope.
- `src/shared/errors/error-handler.ts:113-117` — the generic 500 path.
- `docs/OBSERVABILITY.md` § Logging — "Fastify's request logging … includes request id, method, path, status code, and response time automatically."
- `src/shared/http/response-envelope.ts:6-13` — `SuccessResponse` has a `meta` slot that could carry the same value on success.

**Impact**
The correlation id exists on the server side and is deliberately withheld from the one party who needs to quote it. Supporting a production incident means searching logs by timestamp and endpoint instead of by id.

**Expected behavior**
Every error response includes the request id, and it is also returned on success responses (or as a response header) so clients can log it proactively.

**Proposed scope / implementation direction**
1. Add `requestId` to `ErrorResponseBody['error']` and populate it from `request.id` in all five `handleError` branches.
2. Set an `x-request-id` response header globally via an `onSend` hook, honouring an inbound `x-request-id` when present so upstream correlation is preserved (Fastify supports `requestIdHeader` for this).
3. Update the error-envelope description in `docs/API_REFERENCE.md` § Conventions and mention it in `docs/OBSERVABILITY.md`.

**Acceptance criteria**
- [ ] Every error response body contains a `requestId`.
- [ ] The same id appears in the corresponding log line.
- [ ] An inbound `x-request-id` is honoured and echoed.
- [ ] Success responses expose the id via a header.

**Verification / testing requirements**
- API tests asserting the id is present and matches the response header.

---

### #70 — The error handler maps only two Prisma error codes; foreign-key and write-conflict failures become opaque 500s

- **Labels:** `bug`, `reliability`, `api`, `database`
- **Area / component:** `shared/errors/error-handler.ts`

**Problem**
`handleError` duck-types Prisma known-request errors with a `/^P\d{4}$/` regex and then handles exactly two of them — `P2002` (unique constraint) and `P2025` (record not found). Every other Prisma error falls through to a generic 500.

**Current behavior**
`P2003` (foreign-key constraint violation) is the single most likely Prisma failure in this codebase, because `escrows` and `disputes` both hold a foreign key to `deliveries` and event ordering is not guaranteed (#29). It currently produces `500 INTERNAL_ERROR` with the message masked. `P2034` (transaction write conflict / deadlock — a retryable condition) does the same, so a transient serialisation failure is reported as an unrecoverable server error.

**Evidence / code location**
- `src/shared/errors/error-handler.ts:13-25` — `isPrismaKnownRequestError`.
- `src/shared/errors/error-handler.ts:86-101` — the `P2002` / `P2025` branches only.
- `prisma/schema.prisma:219,241` — the two FK relations that make `P2003` reachable.
- `src/modules/escrow/application/sync-escrow-from-event.ts:37-41` and `src/modules/disputes/infrastructure/prisma-dispute-repository.ts:37-41` — the write paths that can raise it.

**Impact**
Real, distinguishable database conditions are collapsed into "an unexpected error occurred", which is both unhelpful to clients and misleading in triage — a 500 implies a bug, whereas `P2003` here usually implies an ordering or configuration issue. Retryable conflicts are not identifiable as retryable.

**Expected behavior**
The common Prisma error codes map to appropriate, distinguishable HTTP responses.

**Proposed scope / implementation direction**
1. Add `P2003` → `409 CONFLICT` with a code such as `RELATED_RESOURCE_MISSING`, including the constraint name from `meta` (subject to #12's 5xx redaction rules — 409 is a 4xx, so `details` may remain).
2. Add `P2034` → `409 CONFLICT` with a retryable-conflict code, or `503` with `Retry-After`.
3. Consider `P1001`/`P1002` (database unreachable) → `503`, which is more accurate than 500 for a connectivity failure.
4. Document the mapping table in `docs/API_REFERENCE.md`.

**Acceptance criteria**
- [ ] A foreign-key violation returns a `409` with a specific code, not a 500.
- [ ] Unmapped Prisma codes still return the masked 500.
- [ ] The mapping is documented.

**Verification / testing requirements**
- Unit tests in the new `error-handler.spec.ts` (see #75) for each mapped code.
- Integration test triggering a real `P2003` against a test database.

---

### #71 — `bytesToScVal` silently truncates malformed hex into a short byte value

- **Labels:** `bug`, `validation`, `backend`
- **Area / component:** `blockchain/xdr/sc-val.ts`

**Problem**
`bytesToScVal(hex)` passes its input straight to `Buffer.from(hex, 'hex')`, which stops at the first invalid character and returns however many bytes it managed to decode, rather than throwing. A malformed or odd-length string therefore produces a valid-looking but wrong-length `ScVal`.

**Current behavior**
`Buffer.from('zz', 'hex')` returns an empty buffer; `Buffer.from('abcz', 'hex')` returns one byte. `bytesToScVal` wraps whatever comes back in `xdr.ScVal.scvBytes` with no length assertion, even though its own doc comment says it "encodes a fixed-size byte array (e.g. `BytesN<32>`)". The `add_evidence_hash` route is protected by a `^[0-9a-f]{64}$` schema, so the currently-reachable path is safe — but the shared helper carries no such guarantee for its next caller.

**Evidence / code location**
- `src/blockchain/xdr/sc-val.ts:131-135` — the helper and its `BytesN<32>` doc comment.
- `src/modules/disputes/interface/schemas.ts:6` — `evidenceHash` regex, the only current guard.
- `src/modules/disputes/infrastructure/disputes-scval-mapping.ts:54-60` — the only current caller.
- `src/blockchain/index.ts:16` — exported as part of the public blockchain API surface.

**Impact**
A wrong-length `BytesN<32>` is rejected on-chain with an opaque error long after the backend has returned a `200` and an XDR envelope. The failure surfaces to the user at wallet-signing time with no useful diagnostic. It is also inconsistent with every other decode helper in the codebase, all of which throw descriptively on bad input.

**Expected behavior**
The helper validates its input and throws a descriptive error, and callers needing a fixed width can state it.

**Proposed scope / implementation direction**
1. Validate with `/^[0-9a-fA-F]+$/` and an even length; throw naming the expected format.
2. Add an optional `expectedBytes` parameter (defaulting to unconstrained) and assert the decoded length when supplied; have the disputes mapping pass `32`.
3. Note in the doc comment that `Buffer.from(…, 'hex')` truncates silently, so the check cannot be skipped.

**Acceptance criteria**
- [ ] Non-hex input throws.
- [ ] Odd-length input throws.
- [ ] A length mismatch against `expectedBytes` throws.
- [ ] Valid 64-character hex still produces the same 32-byte value as today.

**Verification / testing requirements**
- Unit tests in `src/blockchain/xdr/sc-val.spec.ts` for each rejected form and the round trip.

---

### #72 — `POST /transactions/submit` is a stated objective but does not exist

- **Labels:** `enhancement`, `api`, `backend`
- **Area / component:** new — `modules/transactions` (or an extension of an existing module)

**Problem**
ROADMAP objective 3 commits to an API that "builds unsigned Soroban transactions for client-side signing, **and tracks their submission/confirmation lifecycle**". Seventeen build endpoints exist. Nothing submits, and nothing tracks.

**Current behavior**
A client receives an XDR envelope, signs it in a wallet, and must submit it to Soroban RPC itself. The backend learns the outcome only when the indexer eventually observes the resulting event — which can be several poll cycles later, and never at all if the transaction fails. There is no way to ask "what happened to the transaction I just signed?", and no correlation between a build request and its eventual on-chain effect.

**Evidence / code location**
- `docs/API_REFERENCE.md:126` — the "Planned Endpoint Families" table's single remaining row: `POST /transactions/submit` (relay a signed XDR envelope, track confirmation).
- `ROADMAP.md` §2 objective 3.
- `src/blockchain/soroban-client.ts:17-83` — `SorobanClient` exposes `getHealth`, `getLatestLedger`, `getEvents`, `getAccount`, `prepareTransaction` and `simulateTransaction`, but no `sendTransaction` / `getTransaction`.
- `docs/API_REFERENCE.md:10` — "Mutating endpoints … return a **pending transaction record**", which no endpoint currently does.
- `prisma/schema.prisma` — no transactions table.

**Impact**
The API's documented contract around pending transaction records is unimplemented, so clients get no confirmation feedback and the "no invented blockchain functionality" principle is met at the cost of an incomplete product loop. This is the last named gap in the API reference.

**Expected behavior**
A client can submit a signed envelope through the backend and poll its status until it is confirmed or failed.

**Proposed scope / implementation direction**
This is genuinely two units of work; scope it to whichever the reviewer prefers, and open the other separately if needed.
1. **Relay:** add `sendTransaction` / `getTransaction` to `SorobanClient` (both exist on `rpc.Server`), plus a `POST /api/v1/transactions/submit` accepting a signed XDR, validating it parses and targets a configured contract, and relaying it.
2. **Tracking:** add a `Transaction` model (hash, submitter user id, status, submitted-at, confirmed-at, error) written on submit and updated by a small polling job in the worker process, plus `GET /api/v1/transactions/:hash`.
3. Require authentication and apply the tighter build-endpoint rate limit from #10.
4. Reject envelopes whose operations do not target a configured FaniLab contract, so the endpoint cannot be used as an open relay.
5. Update `docs/API_REFERENCE.md` and `ARCHITECTURE.md` §9.

**Acceptance criteria**
- [ ] A signed envelope can be submitted and its hash returned.
- [ ] The endpoint refuses envelopes targeting contracts this deployment does not know about.
- [ ] Status can be polled until confirmed or failed.
- [ ] Submission is authenticated and rate-limited.
- [ ] The "Planned Endpoint Families" table is emptied or removed.

**Verification / testing requirements**
- Unit tests over a fake RPC client for accept/reject/relay paths.
- Integration tests for the persistence and status transitions.
- API tests for auth and validation.

---

### #73 — Swagger UI is served unauthenticated in every environment, including production

- **Labels:** `security`, `api`, `deployment`
- **Area / component:** `shared/http/plugins/docs.ts`, `src/app.ts`

**Problem**
`docsPlugin` is registered unconditionally in `buildApp()`, so `/api-docs` and `/api-docs/json` are publicly reachable on every deployment with no environment gate and no access control.

**Current behavior**
`await app.register(docsPlugin);` with no `NODE_ENV` check. The document enumerates every route including all admin-only ones, every request/response schema, and — once #65 lands — the exact authentication requirements. Unlike `/metrics`, whose public exposure is a deliberate, documented decision justified by network policy (`docs/OBSERVABILITY.md`), nothing in the documentation set states a position on `/api-docs`.

**Evidence / code location**
- `src/app.ts:57` — unconditional registration.
- `src/shared/http/plugins/docs.ts:25-27` — `routePrefix: '/api-docs'`, no auth hook.
- `docker-compose.yml:40-41` — the `api` service publishes port 3000 directly.
- `docs/SECURITY.md` — no mention of `/api-docs`.
- `docs/API_REFERENCE.md:7` — notes `/api-docs` is outside `/api/v1`, but says nothing about exposure.

**Impact**
Full API surface disclosure to anonymous callers on a production deployment. This is a reconnaissance aid rather than a vulnerability in itself, but it is an unconsidered exposure — the one operational endpoint the project has *not* reasoned about publicly, in contrast to the explicit reasoning applied to `/metrics` and `/health*`.

**Expected behavior**
A deliberate, documented decision: either the UI is restricted in production, or its public exposure is stated as intentional in `docs/SECURITY.md` alongside the `/metrics` reasoning.

**Proposed scope / implementation direction**
1. Add a `DOCS_ENABLED` config flag defaulting to `true` outside production and `false` in production.
2. Register `docsPlugin` conditionally on it, so the routes do not exist rather than returning 403 (avoids fingerprinting).
3. Alternatively, keep it enabled and gate with `requireRole('ADMIN')` on `/api-docs/json` — note that Swagger UI would then need a token to load the spec.
4. Document the chosen posture in `docs/SECURITY.md` and `docs/DEPLOYMENT.md`, mirroring how `/metrics` is handled.

**Acceptance criteria**
- [ ] The exposure decision is explicit, configurable and documented.
- [ ] Local development and CI still serve the UI by default.
- [ ] With docs disabled, `/api-docs` returns 404 and the rest of the API is unaffected.

**Verification / testing requirements**
- Integration test asserting the route's presence/absence under each config value.

---

## Section H — Testing

---

### #74 — `tests/e2e/` is empty despite the roadmap committing to full-flow end-to-end tests

- **Labels:** `testing`, `reliability`
- **Area / component:** `tests/e2e/`

**Problem**
`ROADMAP.md` §10 names end-to-end tests as one of five testing levels and specifies the exact flow to cover. The directory contains only a `.gitkeep`.

**Current behavior**
`tests/e2e/.gitkeep` is the sole file. `vitest.config.ts` already includes `tests/**/*.{spec,test}.ts` in its test glob, so the harness is wired and waiting. The 96 existing spec files cover units, repositories and per-module HTTP routes — but nothing exercises a flow that crosses module boundaries, and the several defects in this backlog that arise precisely at those seams (#27, #28, #29, #34, #36, #47) would all have been caught by one.

**Evidence / code location**
- `tests/e2e/.gitkeep` — the only content.
- `ROADMAP.md` §10 — "**End-to-end tests**: `tests/e2e/` covering full flows (register → link wallet → create delivery → fund escrow → confirm → verify reputation updated) against a local Soroban test ledger where feasible, or a recorded/mocked RPC fixture otherwise."
- `vitest.config.ts:6` — `include: ['src/**/*.{spec,test}.ts', 'tests/**/*.{spec,test}.ts']`.
- `src/shared/testing/database.ts` and `src/shared/testing/soroban.ts` — the skip-not-fail gating helpers such a suite would use.

**Impact**
No test proves the system works as a system. Each module is verified against its own fakes; the assumptions those fakes encode about event shape, ordering and cross-module state are unverified. The roadmap's own flow — the product's core loop — has never been executed end to end in CI.

**Expected behavior**
At least one e2e suite drives the documented flow against a real Postgres, a real Redis, and a mocked or fixture-backed Soroban RPC, asserting read-model state at each step.

**Proposed scope / implementation direction**
1. Build the happy path first: register → verify email → login → link wallet (real ed25519 signature, as `stellar-signature-verifier.spec.ts` already does) → publish a `delivery_created` fixture event → assert `GET /api/v1/deliveries/:id` → publish `escrow_funded` → assert `GET /api/v1/escrow/:id` → publish `delivery_confirmed` and `escrow_released` → assert reputation and notification effects.
2. Drive the chain side by publishing fixture events through `publishBlockchainEvent` (see #80) rather than standing up a Soroban ledger, keeping the suite deterministic and CI-friendly.
3. Gate on `isDatabaseAvailable()` so it skips rather than fails without Docker, matching the existing convention.
4. Add a second suite for the dispute flow: raise → upload evidence → download as each authorised party → resolve.

**Acceptance criteria**
- [ ] The happy-path flow runs green in CI against the existing Postgres/Redis service containers.
- [ ] It skips cleanly with no database available.
- [ ] Each step asserts observable API state, not internal calls.
- [ ] The suite runs in a reasonable time.

**Verification / testing requirements**
- The suite is itself the deliverable; verify it fails when a module's sync handler is deliberately broken.

---

### #75 — `src/shared/errors/error-handler.ts` has no tests

- **Labels:** `testing`, `reliability`, `api`
- **Area / component:** `shared/errors/error-handler.ts`

**Problem**
The single function that turns every thrown error in the application into an HTTP response has no test file.

**Current behavior**
`handleError` has five distinct branches — `AppError`, bare `ZodError`, Fastify validation errors, Prisma known-request errors, and generic Fastify errors with a `statusCode` — plus a final fallback. None is directly tested. The only incidental coverage comes from per-module route integration specs, which exercise a handful of `AppError` paths and skip entirely without a database.

**Evidence / code location**
- `src/shared/errors/error-handler.ts` — 118 lines, no sibling `.spec.ts`.
- `src/app.ts:52` — `app.setErrorHandler(handleError)`, so every route depends on it.
- Branches at lines 42, 55, 74, 86 and 104.
- `vitest.config.ts:12` — `coverage.include: ['src/**/*.ts']`, so this file counts against coverage while being effectively untested.
- Three issues in this backlog (#12, #69, #70) propose changes to this exact function.

**Impact**
The highest-fan-in function in the codebase is unverified, and three planned changes to it have no regression net. A subtle change to branch ordering — for example, moving the Prisma check above the validation check — would silently change the status code of a large class of responses.

**Expected behavior**
A unit test file covering every branch and the fallback.

**Proposed scope / implementation direction**
1. Add `src/shared/errors/error-handler.spec.ts` with a minimal fake `FastifyRequest` (just `log.warn`/`log.error`) and a fake `FastifyReply` recording `status`/`send`.
2. Cover: each `AppError` subclass and its status/code; a bare `ZodError` and its `details` mapping; a `FastifyError` with a `validation` array; `P2002` and `P2025`; a 4xx `FastifyError` with a `statusCode`; and an arbitrary `Error`.
3. Assert log level selection (`warn` for 4xx, `error` for 5xx), since `docs/OBSERVABILITY.md` § Error Reporting depends on it.

**Acceptance criteria**
- [ ] Every branch is covered.
- [ ] Log-level selection is asserted.
- [ ] The tests run without a database or Redis.

**Verification / testing requirements**
- Confirm branch coverage of the file reaches 100% in the coverage report.

---

### #76 — `src/shared/http/plugins/auth-guard.ts` has no direct tests

- **Labels:** `testing`, `security`, `authentication`
- **Area / component:** `shared/http/plugins/auth-guard.ts`

**Problem**
`authenticate` and `requireRole` — the entirety of the API's authentication and authorization enforcement — have no dedicated test file.

**Current behavior**
Coverage exists only incidentally, through per-module route integration specs that skip without a database. There is no test asserting the header-parsing edge cases (`Bearer` with no token, a lowercase `bearer` prefix, a token containing spaces), and none asserting `requireRole`'s behaviour when `request.user` is unset — the branch whose comment claims it is "unreachable in practice", which #1 shows is exactly the kind of assumption worth testing.

**Evidence / code location**
- `src/shared/http/plugins/auth-guard.ts` — 47 lines, no sibling `.spec.ts`.
- `src/shared/http/plugins/auth-guard.ts:19-24` — `header?.startsWith('Bearer ')` then `header.slice('Bearer '.length)`, case-sensitive with no trimming.
- `src/shared/http/plugins/auth-guard.ts:38-47` — `requireRole`, including the "authentication required before role check" branch.
- Every `interface/routes.ts` depends on both.

**Impact**
The security control every protected route relies on is verified only indirectly, by tests that do not run in environments without Docker. Issues #1, #2 and #3 all touch this area and would benefit from a direct harness.

**Expected behavior**
A unit test file covering both guards' accept and reject paths, running with no external dependencies.

**Proposed scope / implementation direction**
1. Add `src/shared/http/plugins/auth-guard.spec.ts` using the test env's JWT secrets (already set by `src/shared/testing/env.ts`).
2. Cover `authenticate`: valid token; missing header; `Basic` scheme; lowercase `bearer`; `Bearer ` with an empty token; expired token; wrong-secret signature; and (after #1) each non-access token type.
3. Cover `requireRole`: matching role; non-matching role; multiple accepted roles; and `request.user` unset.
4. Assert the thrown error types (`UnauthorizedError` / `ForbiddenError`) rather than status codes.

**Acceptance criteria**
- [ ] Both functions have full branch coverage.
- [ ] Tests run without Postgres or Redis.
- [ ] Each rejection asserts the specific error class.

**Verification / testing requirements**
- Confirm the file appears in the coverage report at full branch coverage.

---

### #77 — The environment schema has no tests, so the documented fail-fast contract is unverified

- **Labels:** `testing`, `reliability`, `deployment`
- **Area / component:** `shared/config/env.ts`

**Problem**
`docs/DEPLOYMENT.md` and `docs/SECURITY.md` both present boot-time environment validation as a core reliability and security property. `src/shared/config/env.ts` has no test file.

**Current behavior**
Nothing verifies that a missing `DATABASE_URL` throws, that a 20-character `JWT_ACCESS_SECRET` is rejected, that `PORT=abc` fails, that `STELLAR_NETWORK=mainnett` fails, or that the aggregated error message lists every failing key as the implementation intends. Three issues in this backlog (#50, #51, #53) change this file.

**Evidence / code location**
- `src/shared/config/env.ts` — 58 lines, no sibling `.spec.ts`.
- `src/shared/config/env.ts:49-57` — `parseEnv` aggregates `result.error.issues` into a multi-line message.
- `src/shared/config/env.ts:19-20` — the `.min(32)` secret constraints `docs/SECURITY.md` § Secrets explicitly cites.
- `docs/DEPLOYMENT.md` § Configuration — "an invalid or missing required variable fails startup immediately with a clear error".
- `parseEnv(source = process.env)` already takes an injectable source, so it is trivially testable.

**Impact**
A documented security control (minimum secret length) and a documented reliability control (fail fast at boot) are both unverified. A future refactor could relax either without any test noticing.

**Expected behavior**
A unit test file covering required fields, constrained fields, defaults, coercions and the aggregated error message.

**Proposed scope / implementation direction**
1. Add `src/shared/config/env.spec.ts` calling `parseEnv(fixtureObject)` directly — no `process.env` mutation needed.
2. Cover: a minimal valid environment; each missing required field; both short-secret cases; invalid enum values for `NODE_ENV`, `LOG_LEVEL` and `STELLAR_NETWORK`; non-numeric `PORT` / `RATE_LIMIT_MAX`; an invalid `SOROBAN_RPC_URL`; and every default.
3. Assert the error message names every failing key when several fail at once.
4. Add a test asserting the schema's key set matches `.env.example`'s (this also closes #50's drift risk permanently).

**Acceptance criteria**
- [ ] Every field's validation and default is covered.
- [ ] The multi-failure aggregated message is asserted.
- [ ] Schema keys and `.env.example` keys are checked against each other.

**Verification / testing requirements**
- Confirm the tests fail if a `.min(32)` constraint is removed.

---

### #78 — `src/blockchain/soroban-client.ts` and `simulate-read-call.ts` have no tests

- **Labels:** `testing`, `reliability`, `backend`
- **Area / component:** `blockchain/soroban-client.ts`, `blockchain/xdr/simulate-read-call.ts`

**Problem**
The resilient RPC client — the single gateway for every chain interaction — and the read-simulation helper both lack test files, while the pieces they compose (`retry.ts`, `sc-val.ts`, `build-invoke-transaction.ts`) are all tested.

**Current behavior**
`SorobanClient` has untested logic worth verifying independently of the network: the `isRetryableRpcError` message matching, the composition order of breaker-then-retry, and the wrapping of every failure into a `BlockchainError` carrying `{ operation, cause }`. `simulateReadCall` has two distinct failure branches (`isSimulationSuccess` false, and a successful simulation with no `result`) plus the decode path, none exercised. The only related coverage is `soroban-event-source.integration.spec.ts`, which is gated on real public-testnet reachability and therefore skips in most environments.

**Evidence / code location**
- `src/blockchain/soroban-client.ts` — 103 lines, no sibling `.spec.ts`.
- `src/blockchain/xdr/simulate-read-call.ts` — 62 lines, no sibling `.spec.ts`.
- `src/blockchain/soroban-client.ts:91-96` — the retryable-error regex.
- `src/blockchain/soroban-client.ts:72-82` — the breaker/retry composition and error wrapping.
- `src/blockchain/xdr/simulate-read-call.ts:47-59` — the two failure branches.
- `src/shared/testing/soroban.ts` — the availability gate showing real-RPC tests are expected to skip.
- Issues #12 and #16 both change `soroban-client.ts`.

**Impact**
The resilience layer that the whole project's "Soroban RPC is an unreliable shared resource" risk mitigation rests on (`ROADMAP.md` §7) is verified only through a network-gated test that usually does not run.

**Expected behavior**
Both files have unit tests that run offline against injected fakes.

**Proposed scope / implementation direction**
1. Add `soroban-client.spec.ts` exercising `isRetryableRpcError` against representative messages, and `call()` against a stubbed operation that fails in retryable and non-retryable ways — asserting attempt counts, `BlockchainError` shape, and breaker interaction.
2. Refactor `SorobanClient` just enough to inject a fake `rpc.Server`, or extract `call` and `isRetryableRpcError` so they are independently testable.
3. Add `simulate-read-call.spec.ts` with a fake `SorobanClient` returning a successful simulation, a failed one, and a successful one with no `result`.

**Acceptance criteria**
- [ ] Both files have unit tests that run with no network access.
- [ ] Retryable and non-retryable classification is asserted for representative messages.
- [ ] Both `simulateReadCall` failure branches produce a `BlockchainError` with the expected details.

**Verification / testing requirements**
- Confirm the tests run green with no network and no Docker.

---

### #79 — No test asserts each route's authentication and role requirements

- **Labels:** `testing`, `security`, `authorization`
- **Area / component:** repository-wide (all `interface/routes.ts`)

**Problem**
Authentication and role requirements are expressed as per-route `preHandler` arrays, one route at a time, across eleven files. Nothing verifies the resulting matrix, so a route registered without a guard — or with the wrong one — is caught only by review.

**Current behavior**
Issues #2 and #3 are exactly this failure, already present on `main`: four routes documented as admin-only carry no role guard, and no test noticed. Existing route integration specs test individual endpoints' happy paths and a few 401s; none enumerates the full route table and asserts each route's expected protection level.

**Evidence / code location**
- `src/modules/disputes/interface/routes.ts:151-200` and `src/modules/reputation/interface/routes.ts:64-79` — the four unguarded admin routes.
- `src/modules/{analytics,fraud-detection,admin}/interface/routes.ts` — the correctly guarded ones, for contrast.
- Fastify exposes the full route table via `app.printRoutes()` / the `onRoute` hook, so the matrix is machine-readable.
- `docs/API_REFERENCE.md` — the current source of truth for expected protection, in prose.

**Impact**
Authorization drift is invisible. As the API grows, "did this new route get a guard?" has no automated answer, and the documentation-based answer is already wrong in four places.

**Expected behavior**
A single test enumerates every registered route and asserts its expected protection level against a checked-in table, failing when a new route is added without a deliberate entry.

**Proposed scope / implementation direction**
1. Add `tests/route-auth-matrix.spec.ts` building the app and collecting routes via an `onRoute` hook or `app.printRoutes({ commonPrefix: false })`.
2. Maintain a checked-in map of `METHOD /path` → `'public' | 'authenticated' | 'admin'`.
3. Assert that every registered route appears in the map (so new routes force a decision) and that no map entry is stale.
4. For each entry, inject a request with no token, a `CUSTOMER` token, and an `ADMIN` token, asserting 401/403/non-401 as appropriate.
5. Keep it runnable without a database by asserting only the guard outcome, not the handler result — a 401/403 short-circuits before any repository call.

**Acceptance criteria**
- [ ] Adding a route without updating the map fails the test.
- [ ] The test currently fails against `main` for the four routes in #2 and #3, and passes once those are fixed.
- [ ] The test runs without external services.

**Verification / testing requirements**
- The test is the deliverable; verify it detects a removed `requireRole` on any admin route.

---

### #80 — Every module hand-builds synthetic blockchain events instead of sharing fixtures

- **Labels:** `testing`, `technical-debt`, `refactor`
- **Area / component:** all `src/modules/*/application/__fixtures__/fakes.ts` and `sync-*-from-event.spec.ts`

**Problem**
Seven modules consume `BlockchainEventEnvelope`s, and each constructs its own synthetic events inside its own fixtures. There is no shared fixture module and no recorded real payloads, despite `ROADMAP.md` §10 committing to exactly that.

**Current behavior**
Each module's `__fixtures__/fakes.ts` and event-sync spec encodes its own assumptions about topic and payload layout. Those assumptions are genuinely subtle and genuinely differ per contract — `escrow_contract` puts the delivery id in the *topic*, `delivery_contract` and `fleet_management_contract` put it in the *payload*, and `dispute_resolution_contract` puts a JSON-stringified tuple-wrapped id in the topic. Each of those facts is documented in a long comment in the relevant handler and re-encoded, separately, in that module's fixtures. Two modules (`notifications`, `fraud-detection`) consume events from contracts they do not own and must replicate the owning module's assumptions a third time.

**Evidence / code location**
- `src/modules/escrow/application/sync-escrow-from-event.ts:9-23` — the topic-vs-payload warning.
- `src/modules/disputes/application/sync-dispute-from-event.ts:38-47` — the JSON-stringified tuple id.
- `src/modules/fleet/application/sync-fleet-from-event.ts:8-22` — the third convention.
- `src/modules/notifications/application/dispatch-notifications-from-event.ts:120-123` — "verified against `EVENT_INDEXER.md`'s own documentation of this event", i.e. a fourth-hand copy.
- `src/modules/fraud-detection/application/record-actor-activity-from-event.ts:14-24` — the same payload shapes restated again.
- `ROADMAP.md` §10 — "**Blockchain event fixtures**: recorded real event payloads from testnet (sanitized) used to drive indexer idempotency and reconciliation tests deterministically."

**Impact**
The single most error-prone detail in the codebase — which contract puts the id where — is duplicated across seven modules' test fixtures. If any module's assumption is wrong, its tests pass anyway, because they validate against the same wrong assumption. This is the highest-leverage testing gap in the repository and a prerequisite for a credible e2e suite (#74).

**Expected behavior**
One shared fixture module defines a builder per contract and per event type, encoding each contract's convention exactly once, and every module's tests build their events through it.

**Proposed scope / implementation direction**
1. Add `src/shared/testing/blockchain-events.ts` (or `tests/fixtures/`) exporting a builder per event — `escrowFundedEvent({ chainDeliveryId, … })`, `deliveryCreatedEvent(…)`, `disputeRaisedEvent(…)`, and so on — each encoding its contract's real topic/payload convention with a comment citing the contract source.
2. Migrate all seven modules' sync specs and fixtures onto it, deleting the local duplicates.
3. Where real testnet payloads become available, replace the synthesised shapes with sanitised recordings, as the roadmap specifies.
4. Reference the fixture module from `docs/EVENT_INDEXER.md` as the canonical machine-readable statement of each convention.

**Acceptance criteria**
- [ ] One module defines every event shape; no module builds envelopes inline.
- [ ] Each builder's convention is documented with a contract-source citation.
- [ ] All existing sync specs pass on the shared fixtures.
- [ ] `notifications` and `fraud-detection` use the same builders as the owning modules.

**Verification / testing requirements**
- Confirm that changing a builder's convention breaks the corresponding module's tests, proving the fixtures are load-bearing.

---

### #81 — CI has no scheduled run, so nothing catches environment drift or newly disclosed advisories

- **Labels:** `ci`, `testing`, `devops`
- **Area / component:** `.github/workflows/ci.yml`

**Problem**
CI runs only on pushes to `main` and on pull requests. `ROADMAP.md` §10 specifies that end-to-end tests should run "on a schedule and on release branches given its higher cost/flakiness surface", and there is no scheduled workflow at all.

**Current behavior**
`on: { push: { branches: [main] }, pull_request: { branches: [main] } }`. A repository with no merges for a week runs no CI for a week. Nothing detects a newly published advisory against a pinned dependency (see #56), a broken public Soroban testnet RPC that the network-gated integration tests would surface, or a base-image change.

**Evidence / code location**
- `.github/workflows/ci.yml:3-7` — the two triggers.
- `.github/workflows/release.yml:3-6` — tag trigger only.
- `ROADMAP.md` §10 — the scheduled-e2e commitment.
- `src/modules/indexer/infrastructure/soroban-event-source.integration.spec.ts` — gated on `isSorobanRpcAvailable`, so it skips silently rather than reporting upstream breakage.
- `.github/dependabot.yml` — weekly, but it opens PRs rather than running the suite.

**Impact**
Time-dependent breakage — advisories, upstream RPC changes, base-image updates — is discovered by whoever happens to open the next PR, at the worst possible moment. The network-gated tests, which are the only ones exercising a real Soroban RPC, effectively never report anything.

**Expected behavior**
A scheduled workflow runs the full suite (including e2e once #74 lands) on a regular cadence and reports failures visibly.

**Proposed scope / implementation direction**
1. Add `schedule: [{ cron: '0 6 * * 1' }]` (or daily) to CI, or create a separate `nightly.yml` reusing the CI jobs.
2. Include the audit job from #56 and the Docker build from #58.
3. Report which optional/gated suites actually ran, so a permanently-skipping suite is visible rather than silently absent.
4. Note the cadence in `CONTRIBUTING.md`.

**Acceptance criteria**
- [ ] A scheduled run executes the full suite without a push.
- [ ] The run's summary states which gated suites ran versus skipped.
- [ ] Failures are visible on the Actions tab and, ideally, notify maintainers.

**Verification / testing requirements**
- Trigger once via `workflow_dispatch` to confirm the job graph runs correctly outside a push context.

---

## Section I — Documentation

---

### #82 — `docs/SECURITY.md` claims dispute resolutions and KYC changes are audit-logged; only role changes are

- **Labels:** `documentation`, `security`, `backend`
- **Area / component:** `docs/SECURITY.md`, `modules/admin`, `modules/disputes`

**Problem**
`docs/SECURITY.md` § Audit Logging states that "privileged/sensitive actions (admin dispute resolutions, KYC status changes, role changes) are recorded in the `audit_logs` table". Exactly one of those three is implemented.

**Current behavior**
`updateUserRole` is the only writer to `audit_logs` anywhere in the codebase. Nothing writes an entry when an admin builds a dispute-resolution transaction, when a KYC-status transaction is built, or when evidence is downloaded — the last of which is arguably the most sensitive read in the system, since it exposes another party's confidential dispute material.

**Evidence / code location**
- `docs/SECURITY.md` § Audit Logging — the three-item claim, characterised as "a structural requirement of the `admin` module design … not an afterthought bolted on later".
- `src/modules/admin/application/update-user-role.ts:36-43` — the only `auditLogRepository.record` call in `src/`.
- `src/modules/admin/domain/ports.ts:39-48` — the port's own comment notes the planned shared audit-logging decorator was never built and that `admin` is "the first and only consumer so far".
- `src/modules/disputes/interface/routes.ts:151-200` — resolve-dispute builds, no audit.
- `src/modules/reputation/interface/routes.ts:64-79` — KYC build, no audit.
- `src/modules/disputes/application/download-evidence.ts:38-62` — evidence download, no audit.

**Impact**
A security document overstates the implemented controls, which is worse than understating them — a reviewer or auditor reading `docs/SECURITY.md` reasonably concludes an audit trail exists for privileged dispute actions. It does not.

**Expected behavior**
The audit trail covers the actions the document claims, or the document is corrected to match reality — preferably the former, since the table, the repository and the read endpoint all already exist.

**Proposed scope / implementation direction**
1. Extend the `AuditLogRepository` port into `disputes` and `reputation` (or promote it to `shared/` as the never-built decorator, now that there would be three consumers).
2. Record an entry for: each resolve-dispute transaction build, each KYC-status build, and each successful evidence download (actor, evidence id, dispute id).
3. Record admin-only actions only where an admin is genuinely the actor — do not log ordinary party actions as privileged.
4. Update `docs/SECURITY.md` to enumerate precisely what is logged.

**Acceptance criteria**
- [ ] Each action named in `docs/SECURITY.md` produces an `audit_logs` row.
- [ ] Entries appear in `GET /api/v1/admin/audit-log`.
- [ ] `actorLabel` is resolved server-side, never taken from the request, matching the existing pattern.
- [ ] The document matches the implementation exactly.

**Verification / testing requirements**
- Unit tests per new audit call site.
- Integration test asserting the rows are visible through the admin endpoint.

---

### #83 — The security issue template links to a `SECURITY.md` that does not exist at that path

- **Labels:** `documentation`, `bug`
- **Area / component:** `.github/ISSUE_TEMPLATE/security_vulnerability.md`

**Problem**
The template tells reporters to follow the process in `[SECURITY.md](../../SECURITY.md)`. From `.github/ISSUE_TEMPLATE/`, that path resolves to the repository root, where no `SECURITY.md` exists — the file lives at `docs/SECURITY.md`.

**Current behavior**
The link 404s on GitHub. The template's entire purpose is to redirect a would-be public vulnerability report to the private disclosure process, and the redirect is broken.

**Evidence / code location**
- `.github/ISSUE_TEMPLATE/security_vulnerability.md` — `Follow the responsible disclosure process in [SECURITY.md](../../SECURITY.md) instead.`
- `docs/SECURITY.md` — the actual location; `ls SECURITY.md` at the root fails.
- `CODEOWNERS:17` — `/docs/SECURITY.md`, confirming the real path.
- `README.md` § Documentation table — correctly links `docs/SECURITY.md`.

**Impact**
Someone with a vulnerability to report, at the exact moment the project most needs them to follow the private process, is handed a dead link. The cheapest possible fix for the highest-stakes documentation path in the repository.

**Expected behavior**
The link resolves to the disclosure policy.

**Proposed scope / implementation direction**
1. Change the link to `../../docs/SECURITY.md`.
2. Consider adding a root-level `SECURITY.md` that points to `docs/SECURITY.md` — GitHub surfaces a root, `.github/`, or `docs/` `SECURITY.md` in the repository's Security tab, and a root stub makes every relative link in the repository work regardless of depth.
3. Audit the other two issue templates and the PR template for similar relative-link breakage.

**Acceptance criteria**
- [ ] The link resolves when the template is rendered on GitHub.
- [ ] The Security tab surfaces the policy.
- [ ] No other template contains a broken relative link.

**Verification / testing requirements**
- Render the template through GitHub's new-issue flow and click the link.

---

### #84 — `README.md` links to sibling repositories by filesystem path and gates contributions on a milestone already passed

- **Labels:** `documentation`
- **Area / component:** `README.md`

**Problem**
Two problems in one file. The README links to `FaniLab-SmartContract` as `../FaniLab-SmartContract` — a relative filesystem path that only works for someone with both repositories checked out side by side, and 404s for everyone reading on GitHub. Separately, the Contributing section still says issues and PRs are welcome "once the initial module set lands", which happened at `v1.0.0`.

**Current behavior**
The `../FaniLab-SmartContract` path appears twice: in the opening paragraph and in the Related Repositories list. `FaniLab-Frontend` in the same list has no link at all. Meanwhile the status banner at the top of the same file correctly announces `v1.0.0` with Phases 5 and 6 complete, so the file contradicts itself about whether the project is open for contributions.

**Evidence / code location**
- `README.md` — opening paragraph, `[FaniLab Soroban smart contracts](../FaniLab-SmartContract)`.
- `README.md` § Related Repositories — the same path, plus an unlinked `FaniLab-Frontend`.
- `README.md` § Contributing — "Issues and PRs welcome once the initial module set lands — check `ROADMAP.md` for current phase status before proposing large changes."
- `README.md` status banner — "`v1.0.0`. Phase 5 (all twelve modules) and Phase 6 … are both complete".
- `ROADMAP.md` §1 — "engineering quality, documentation, and contributor experience are treated as first-class deliverables".

**Impact**
The README is the project's front door and the primary artifact for the open-source credibility the roadmap explicitly targets. Broken links to the companion repository — the one the entire backend is built against — and an ambiguous invitation to contribute both work directly against that goal.

**Expected behavior**
Every link in `README.md` resolves for a reader on GitHub who has no local checkout, and the Contributing section states plainly that the project is open to contributions at `v1.0.0`.

**Proposed scope / implementation direction**
1. Replace the relative paths with absolute GitHub URLs under the `fanilabs` organisation (confirm the actual repository names with a maintainer).
2. Link `FaniLab-Frontend`, or state plainly that it is not yet public.
3. Rewrite the Contributing paragraph to state that contributions are open, pointing at `CONTRIBUTING.md` and this backlog.
4. Sweep the rest of `README.md` and `ROADMAP.md` §8 for other sibling-repository references (`ROADMAP.md` §8 mentions `FANILAB_PROJECT_OVERVIEW.md` in a sibling repo).

**Acceptance criteria**
- [ ] Every external link in `README.md` resolves when rendered on GitHub.
- [ ] The Contributing section reflects the project's actual `v1.0.0` status.
- [ ] No section of the README contradicts another about project status.

**Verification / testing requirements**
- Run a link checker over `README.md` and the `docs/` tree; consider adding one to CI.

---

### #85 — `docs/adr/` is empty though the architecture document presents it as an established practice

- **Labels:** `documentation`
- **Area / component:** `docs/adr/`, `ARCHITECTURE.md`

**Problem**
`ARCHITECTURE.md`'s folder-structure diagram lists `docs/adr/` as "Architecture Decision Records, mirroring the smart-contract repo's own ADR practice". The directory exists and contains nothing.

**Current behavior**
Zero ADRs. Meanwhile, the codebase contains an unusual density of genuinely consequential, well-reasoned architectural decisions — recorded as long header comments inside implementation files, where they are hard to find, impossible to index, and invisible to anyone reading the documentation set.

**Evidence / code location**
- `ARCHITECTURE.md:194` — `│   └── adr/   (Architecture Decision Records, mirroring the smart-contract repo's own ADR practice)`.
- `docs/adr/` — empty directory.
- Decisions currently buried in code comments, each of which is ADR-shaped: the two-layer dispute reconciliation (`src/modules/disputes/application/sync-dispute-from-event.ts:8-48`); treating `identity_reputation_contract` as the canonical reputation ledger (`src/modules/reputation/domain/entities.ts:12-16`); the in-process event bus over a distributed one (`src/shared/events/index.ts:3-9`); the documented cross-module read-model exceptions for `notifications`/`analytics`/`admin` (`src/modules/notifications/domain/ports.ts:36-56`); and never custodying signing keys (`docs/AUTHENTICATION.md` § Transaction Signing).

**Impact**
A new contributor cannot find the reasoning behind the architecture's most load-bearing decisions without reading implementation files. The documented practice does not exist, and the reasoning that would populate it is already written — just in the wrong place.

**Expected behavior**
The first several ADRs exist, cross-referenced from the code comments that currently carry the reasoning.

**Proposed scope / implementation direction**
1. Add `docs/adr/README.md` with the chosen template (MADR or Nygard) and an index.
2. Write the first four ADRs from reasoning that already exists in the codebase — no new decisions needed, just relocation and formalisation:
   - ADR-0001: The backend never custodies signing keys; every mutating contract call is returned as unsigned XDR.
   - ADR-0002: Read models are written exclusively by the event indexer, never by API requests.
   - ADR-0003: The two on-chain dispute layers are reconciled into one row, with the Layer-A-only gap documented.
   - ADR-0004: The in-process event bus is deliberate for v1; Redis Streams is the identified seam.
3. Replace the longest code comments with a one-line pointer to the corresponding ADR, keeping the local "why" but removing the duplication.
4. Link the index from `ARCHITECTURE.md` and `README.md`'s documentation table.

**Acceptance criteria**
- [ ] `docs/adr/` contains an index and at least four ADRs in a consistent format.
- [ ] Each ADR cites the code it governs.
- [ ] `ARCHITECTURE.md`'s reference to the directory is accurate.

**Verification / testing requirements**
- Documentation review; confirm each ADR's claims still match the code it cites.

---

### #86 — `scripts/examples/` is empty though the Phase 5 per-module Definition of Done requires runnable examples

- **Labels:** `documentation`, `technical-debt`
- **Area / component:** `scripts/examples/`

**Problem**
`ROADMAP.md` §5's per-module DoD requires "Example usage (a request/response example in the OpenAPI schema at minimum; a runnable script under `scripts/examples/` for non-HTTP flows like the indexer)". All twelve modules were marked complete against that DoD; `scripts/examples/` contains only a `.gitkeep`.

**Current behavior**
The directory is empty. The only script in `scripts/` is `load-test.ts`. The non-HTTP flows the DoD names — indexer polling, worker-side event processing, notification delivery — have no runnable demonstration, and there is no way to exercise them locally without a live Soroban deployment emitting real events.

**Evidence / code location**
- `scripts/examples/.gitkeep` — the only content.
- `ROADMAP.md:64` — the DoD line.
- `ROADMAP.md:187` — the summary table: "5 (per module) | Implementation + unit + integration + API tests + docs + **examples** + error handling + logging + validation".
- `scripts/load-test.ts` — the only existing script, and a good template for tone and structure.
- `ROADMAP.md` §5 module status table — all twelve marked ✅ Done.

**Impact**
A DoD item was recorded as met without being met, across twelve modules. More practically, the event-driven half of the system — the indexer and everything downstream of it — has no way to be demonstrated or explored locally. That gap compounds with #55 (no seed data): a new contributor can neither seed state nor simulate the events that would create it.

**Expected behavior**
At least one runnable example per non-HTTP flow, executable against a local stack with no live chain.

**Proposed scope / implementation direction**
1. `scripts/examples/publish-event.ts` — publish a synthetic blockchain event through `publishBlockchainEvent` and show the resulting read-model change, reusing the shared fixtures from #80.
2. `scripts/examples/full-flow.ts` — register, link a wallet with a real ed25519 signature, build a transaction, and print each response, so the HTTP side is demonstrable end to end.
3. `scripts/examples/README.md` explaining what each script does and what it needs running.
4. Add `make examples` and reference the directory from `README.md` and `docs/EVENT_INDEXER.md`.

**Acceptance criteria**
- [ ] At least two runnable examples exist and work against `make docker-up` plus `pnpm seed`.
- [ ] Each is documented and requires no live Soroban deployment.
- [ ] `ROADMAP.md`'s DoD claim is either satisfied or amended honestly.

**Verification / testing requirements**
- Run each example against a fresh local stack and confirm the described output.

---

### #87 — No `CHANGELOG.md`, despite Conventional Commits and release automation being mandated

- **Labels:** `documentation`, `devops`
- **Area / component:** repository root, `.github/workflows/release.yml`

**Problem**
`CONTRIBUTING.md` and `ROADMAP.md` §13 both require Conventional Commits explicitly "to drive changelog/release automation". No changelog exists and no automation generates one.

**Current behavior**
`ls CHANGELOG*` finds nothing. `release.yml` uses `softprops/action-gh-release` with `generate_release_notes: true`, which produces GitHub's own commit-derived notes on the Release page — useful, but not a repository-tracked changelog, not grouped by Conventional Commit type, and not visible to anyone reading the source tree or a package tarball.

**Evidence / code location**
- Repository root — no `CHANGELOG.md`.
- `CONTRIBUTING.md` § Commit Messages — "Used to drive changelog/release automation."
- `ROADMAP.md` §13 — "Conventional Commits; semantic-release-style versioning for tagged releases."
- `.github/workflows/release.yml:24-28` — `generate_release_notes: true`, `draft: true`.
- Git history — commits do follow the convention consistently (`feat(escrow):`, `fix(disputes):`, `docs:`, `chore:`), so the input data is clean and well-formed.

**Impact**
The discipline is being paid for — every contributor formats every commit message — and the payoff is not collected. Anyone assessing the project's release history from the source tree, or diffing between versions, has nothing to read.

**Expected behavior**
A `CHANGELOG.md` grouped by version and change type, generated from the existing Conventional Commit history and updated automatically on release.

**Proposed scope / implementation direction**
1. Generate an initial `CHANGELOG.md` from the existing history (`conventional-changelog-cli`, `git-cliff`, or `changesets`) covering everything up to `v1.0.0`.
2. Add a release-workflow step that regenerates it, commits it, and uses its latest section as the release body instead of GitHub's auto-generated notes.
3. Alternatively adopt `semantic-release` outright, which `ROADMAP.md` §13 already names — note this also changes how versions are chosen, so agree the scope before starting.
4. Link the changelog from `README.md`.

**Acceptance criteria**
- [ ] `CHANGELOG.md` exists and covers history through `v1.0.0`.
- [ ] Entries are grouped by version and by Conventional Commit type.
- [ ] A new tag updates it without manual editing.
- [ ] `README.md` links it.

**Verification / testing requirements**
- Verify generation against the current history and on a scratch pre-release tag.

---

### #88 — No documented procedure for rotating `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`

- **Labels:** `documentation`, `security`, `deployment`
- **Area / component:** `docs/SECURITY.md`, `docs/AUTHENTICATION.md`, `shared/jwt`

**Problem**
Both documents describe how the JWT secrets are validated and used, and `docs/SECURITY.md` names secret handling as a core control — but neither describes how to rotate a secret, and the implementation supports only a single active secret per token type, so rotation is inherently disruptive.

**Current behavior**
`signAccessToken`/`verifyAccessToken` and their refresh counterparts each read one secret from config. Rotating `JWT_ACCESS_SECRET` immediately invalidates every outstanding access token, every unconsumed email-verification token (24h TTL), every unconsumed password-reset token (1h TTL), and every outstanding wallet-link challenge (5m TTL) — because all four token types are signed with that one secret. Rotating `JWT_REFRESH_SECRET` logs out every user. There is no dual-secret verification window, so a graceful rotation is not possible even in principle.

**Evidence / code location**
- `src/shared/jwt/index.ts:23-47` — one secret per operation.
- `src/modules/auth/infrastructure/jwt-token-service.ts:72,78,92,98` — verification and reset tokens on `JWT_ACCESS_SECRET`.
- `src/modules/users/infrastructure/jwt-challenge-service.ts:25,30` — wallet-link challenges on the same secret.
- `docs/SECURITY.md` § Secrets — covers validation and storage, not rotation.
- `docs/AUTHENTICATION.md` § JWT Details — covers algorithm and claims, not rotation.
- `docs/DEPLOYMENT.md` — no rotation step in the release process.

**Impact**
Secret rotation is a routine security operation and a standard requirement after any suspected compromise. Today it is an undocumented, unavoidably user-visible outage of unknown blast radius. An operator faced with a suspected key leak has no runbook.

**Expected behavior**
A documented rotation procedure stating the blast radius honestly, and — preferably — support for verifying against a previous secret during a bounded overlap window so rotation can be graceful.

**Proposed scope / implementation direction**
1. Document the current blast radius precisely in `docs/SECURITY.md`: which token types each secret governs, and what breaks when each is rotated.
2. Add a rotation runbook to `docs/DEPLOYMENT.md`: the ordering, the expected user impact, and how to communicate it.
3. Optionally implement graceful rotation: add `JWT_ACCESS_SECRET_PREVIOUS` / `JWT_REFRESH_SECRET_PREVIOUS`, sign with the current secret, and verify against current-then-previous. Keep it a small, well-tested change confined to `src/shared/jwt`.
4. Consider separating the single-purpose-token secret from the session secret, which would narrow the blast radius substantially and composes well with #1's `purpose` claim.

**Acceptance criteria**
- [ ] `docs/SECURITY.md` states which tokens each secret governs and the rotation impact.
- [ ] `docs/DEPLOYMENT.md` contains a step-by-step rotation runbook.
- [ ] If graceful rotation is implemented, a token signed with the previous secret verifies during the overlap and stops verifying once the previous secret is removed.

**Verification / testing requirements**
- Unit tests in `src/shared/jwt/` for the dual-secret path, if implemented.
- Documentation review against the actual code paths.

---

## Section J — Maintainability & performance

---

### #89 — The `reputation-reconciliation` queue is declared but never produced to or consumed from

- **Labels:** `technical-debt`, `refactor`
- **Area / component:** `shared/queue/queues.ts`, `shared/queue/queue-health.ts`

**Problem**
`QueueName.ReputationReconciliation` exists as a canonical queue name, and `queue-health.ts` carries a paragraph explaining why it is excluded from monitoring. Nothing anywhere adds a job to it or creates a worker for it.

**Current behavior**
The constant is referenced in exactly two places: its own declaration and the health module's exclusion comment. `reputation` performs a synchronous full refresh in its event handler instead — which the exclusion comment correctly documents. The result is a named queue that exists solely to be explained away.

**Evidence / code location**
- `src/shared/queue/queues.ts:13` — `ReputationReconciliation: 'reputation-reconciliation'`.
- `src/shared/queue/queue-health.ts:12-20` — the exclusion and its rationale.
- `src/modules/reputation/application/sync-reputation-from-event.ts:67-94` — the synchronous full-refresh approach that replaced it.
- `src/workers/index.ts:28-31` — two workers registered; no reputation worker.
- No `getQueue(QueueName.ReputationReconciliation)` call exists.

**Impact**
A reader encountering the constant reasonably expects a reconciliation flow to exist. `CONTRIBUTING.md` § Code Standards explicitly prohibits leaving "duplicate or parallel implementation of an existing entity/module" in the tree, and `ROADMAP.md` §13 calls removing superseded implementations "the single most important lesson from Phase 2". This is a small, clean instance of exactly that.

**Expected behavior**
The dead queue name is removed, along with the paragraph explaining its absence.

**Proposed scope / implementation direction**
1. Delete `ReputationReconciliation` from `QueueName`.
2. Simplify `queue-health.ts`'s `MONITORED_QUEUES` comment to state positively what is monitored and why, rather than explaining an exclusion that no longer needs explaining.
3. Update `docs/OBSERVABILITY.md` § Health Checks, which repeats the same explanation.
4. If a reconciliation flow is genuinely planned, record it in `ROADMAP.md` §9 instead of leaving a placeholder constant in the code.

**Acceptance criteria**
- [ ] `grep -r ReputationReconciliation src` returns nothing.
- [ ] `/health/queue` still reports both real queues.
- [ ] `docs/OBSERVABILITY.md` no longer references the removed queue.

**Verification / testing requirements**
- `src/shared/queue/queue-health.integration.spec.ts` passes unchanged.

---

### #90 — `Fleet.ownerId` and its `User` relation are never written or read

- **Labels:** `technical-debt`, `database`
- **Area / component:** `prisma/schema.prisma`, `modules/fleet`

**Problem**
The `Fleet` model declares a nullable `ownerId` foreign key and an `owner User?` relation, with a matching `ownedFleets Fleet[]` back-relation on `User`. No code in the repository ever sets or queries either.

**Current behavior**
`grep -r ownerId src` returns nothing. `createPrismaFleetRepository.create` writes only `chainFleetId`, `ownerAddress` and `treasuryAddress`. `toFleet` maps only those plus timestamps. The `FleetWithDrivers` domain entity has no notion of a local owner account. The column is therefore always `NULL`, and the relation is unreachable from any query path.

**Evidence / code location**
- `prisma/schema.prisma:272,278` — `ownerId String? @map("owner_id")` and `owner User? @relation(...)`.
- `prisma/schema.prisma:127` — `ownedFleets Fleet[]` on `User`.
- `src/modules/fleet/infrastructure/prisma-fleet-repository.ts:57-66` — `create` omits it.
- `src/modules/fleet/domain/entities.ts:4-13` — the domain `Fleet` has no owner-account field.
- `src/modules/fleet/application/sync-fleet-from-event.ts:35-41` — the sync path has only the on-chain owner *address*, not a local user id.

**Impact**
Dead schema surface implying a capability that does not exist — a fleet owner cannot be resolved to a local account, so no "my fleets" endpoint or owner-scoped authorization is possible today despite the schema suggesting otherwise. It also constrains future migrations for no benefit.

**Expected behavior**
Either the link is populated (resolving `ownerAddress` to a local account via `wallet_addresses`, as `notifications` already does for its own lookups), or the column and relation are removed.

**Proposed scope / implementation direction**
Decide which in the issue thread first.
- **Remove:** drop `ownerId`, `owner` and `ownedFleets` in a migration; smallest change, honest schema.
- **Populate:** in `syncFleetFromEvent`'s `fleet_registered` branch, resolve `ownerAddress` through a narrow wallet-lookup port (mirroring `notifications`' `UserContactLookup` precedent) and set `ownerId` when a linked account exists; re-resolve on `fleet_treasury_updated`. This unlocks owner-scoped fleet endpoints later.

**Acceptance criteria**
- [ ] The schema contains no permanently-null column implying an unimplemented capability.
- [ ] A migration exists for whichever direction is chosen.
- [ ] `docs/DATABASE.md` reflects the outcome.

**Verification / testing requirements**
- Integration test in `prisma-fleet-repository.integration.spec.ts` for the populate path, or a schema assertion for the remove path.

---

### #91 — ScVal decode helpers are copy-pasted across four module mapping files

- **Labels:** `refactor`, `technical-debt`, `backend`
- **Area / component:** `modules/{deliveries,escrow,disputes,reputation}/infrastructure/*-scval-mapping.ts`

**Problem**
Four mapping files each define their own private copies of the same set of decode helpers: `unwrapTupleStruct`, `unwrapUnitEnum`, `requireString`, `requireRecord`, `u64StringToDate`, `optionalU64StringToDate`, and in some cases `requireNumber`, `requireBoolean`, `optionalString`, `requireArray`.

**Current behavior**
The implementations are byte-identical where they overlap. Each file's header comment justifies keeping *contract-specific* encoding local to the module — which is right, and not what this issue proposes changing. The generic, contract-agnostic scaffolding around it is what has been duplicated. #22 is a concrete bug living in three of the four copies simultaneously.

**Evidence / code location**
- `src/modules/deliveries/infrastructure/delivery-scval-mapping.ts:103-161` — nine helpers.
- `src/modules/escrow/infrastructure/escrow-scval-mapping.ts:47-92` — seven of the same.
- `src/modules/disputes/infrastructure/disputes-scval-mapping.ts:79-130` — seven, plus `base64ToHex` and `requireArray`.
- `src/modules/reputation/infrastructure/reputation-scval-mapping.ts` — the same pattern again.
- `eslint.config.js:60-63` — `infrastructure` may import from `blockchain`, so a shared home already exists and is already permitted.
- `CONTRIBUTING.md` § Code Standards — "No duplicate or parallel implementation of an existing entity/module left in the tree."

**Impact**
Any fix to a decode helper — like #22's `Invalid Date` bug, or #71's hex validation — must be applied four times or it is applied inconsistently. Four copies also means four places where a subtle divergence can appear unnoticed, in the layer that translates untrusted on-chain data into database writes.

**Expected behavior**
The generic helpers live once under `src/blockchain/xdr/`, and each module's mapping file contains only its own contract's type knowledge.

**Proposed scope / implementation direction**
1. Create `src/blockchain/xdr/decode.ts` exporting the shared helpers with clear names and thorough doc comments.
2. Have each helper accept a field-name argument so error messages stay as specific as they are today.
3. Replace the four sets of local copies with imports; leave every contract-specific mapping (`CARGO_CATEGORY_FROM_RUST`, `ESCROW_STATUS_FROM_RUST`, `deliveryIdToScVal`, and so on) exactly where it is.
4. Export the module from `src/blockchain/index.ts` alongside the existing encoders.

**Acceptance criteria**
- [ ] No decode helper is defined in more than one place.
- [ ] Error messages remain as specific as before.
- [ ] All four modules' existing mapping specs pass unchanged.
- [ ] ESLint boundary rules still pass.

**Verification / testing requirements**
- New unit tests for the shared module.
- All four `*-scval-mapping.spec.ts` files green with no assertion changes.

---

### #92 — `createUnconfiguredContractClient` is reimplemented in five module composition roots

- **Labels:** `refactor`, `technical-debt`, `backend`
- **Area / component:** `modules/{deliveries,escrow,fleet,disputes,reputation}/index.ts`

**Problem**
Five modules each define a private `createUnconfiguredContractClient()` that builds an object whose every method throws a `BlockchainError` naming the missing environment variable. The five implementations differ only in the variable name and the method list.

**Current behavior**
Each is roughly ten lines of identical structure: a `fail` closure throwing `new BlockchainError('<VAR> is not configured — this environment has no <contract> deployment to call.')`, then an object literal mapping every port method to it. Four of the five carry a comment saying "same 'fail loudly, not at boot' fallback as [the other modules]" — the duplication is acknowledged in the code itself.

**Evidence / code location**
- `src/modules/deliveries/index.ts:20-38`.
- `src/modules/escrow/index.ts:19-34`.
- `src/modules/fleet/index.ts:20-37`.
- `src/modules/disputes/index.ts:24-41`.
- `src/modules/reputation/index.ts:24-39` (plus a sixth, `createUnconfiguredLegacyReader`, at lines 41-57).
- `eslint.config.js:66-75` — `module-root` may import from `shared` and `blockchain`, so a shared helper is permitted.

**Impact**
Six near-identical implementations of one idea. Adding a method to any contract port requires remembering to extend the corresponding fallback, and forgetting produces a `TypeError: fail is not a function`-class runtime failure rather than the intended clear `BlockchainError`. The pattern is sound; the repetition is not.

**Expected behavior**
One shared helper produces a fully-typed "unconfigured contract" stub for any port shape.

**Proposed scope / implementation direction**
1. Add `createUnconfiguredContractClient<T extends object>(envVarName: string, contractName: string): T` to `src/blockchain/` (or `src/shared/errors/`), implemented with a `Proxy` whose `get` trap returns a throwing function for any property — so it cannot fall out of sync with a port's method list.
2. If a `Proxy` is judged too implicit, take an explicit method-name array and keep the object-literal construction, retaining full type safety.
3. Replace all six call sites.
4. Ensure the thrown message still names the specific environment variable and contract.

**Acceptance criteria**
- [ ] One implementation, six call sites.
- [ ] Calling any port method on an unconfigured client still throws a `BlockchainError` naming the variable and contract.
- [ ] Adding a method to a port requires no change to the fallback.
- [ ] The existing `502 BLOCKCHAIN_ERROR` behaviour for unconfigured contracts is unchanged.

**Verification / testing requirements**
- Unit tests on the helper.
- Existing route integration specs, which already exercise the unconfigured path, pass unchanged.

---

### #93 — Seven modules define a byte-identical event-subscription wrapper

- **Labels:** `refactor`, `technical-debt`, `backend`
- **Area / component:** `modules/*/infrastructure/event-subscription.ts`

**Problem**
`deliveries`, `escrow`, `fleet`, `disputes`, `reputation`, `notifications` and `fraud-detection` each contain an `infrastructure/event-subscription.ts` that is the same six lines: subscribe to the shared bus, invoke the module's async handler, catch and log the rejection.

**Current behavior**
Each file differs only in the logger's `module` label, the handler's type, and the log message. Several carry a comment noting they mirror "every other module's own infrastructure/event-subscription.ts". This is the layer where #15's missing failure tracking would need to be added — meaning that fix currently has to be applied seven times.

**Evidence / code location**
- `src/modules/deliveries/infrastructure/event-subscription.ts:15-23` — the canonical version.
- The same shape in `escrow`, `fleet`, `disputes`, `reputation`, `notifications` and `fraud-detection`.
- `src/shared/events/index.ts:36-41` — `onBlockchainEvent(handler): () => void`, the shared primitive they all wrap.
- `eslint.config.js:60-63` — `infrastructure` may import from `shared`.

**Impact**
Seven copies of the codebase's only error-handling boundary for event processing. Any cross-cutting improvement — failure tracking (#15), retry, metrics, tracing — must be made seven times, and a module added later can silently omit the `.catch`, turning one bad event into an unhandled rejection that takes down the worker process.

**Expected behavior**
One shared subscription helper that every module uses, with per-module labelling passed in.

**Proposed scope / implementation direction**
1. Add `subscribeToBlockchainEvents(moduleName: string, handler: (e: BlockchainEventEnvelope) => Promise<void>): () => void` to `src/shared/events/`, containing the catch-and-log logic once.
2. Replace all seven module files with a one-line call, or delete them and call the shared helper directly from each composition root.
3. Add the metrics/failure hooks #15 needs in the shared helper only.
4. Keep the per-module `module` log label so log filtering is unchanged.

**Acceptance criteria**
- [ ] One implementation of the catch-and-log wrapper.
- [ ] Log output retains its per-module label.
- [ ] A throwing handler still cannot crash the process.
- [ ] All seven modules' event handling behaves identically to before.

**Verification / testing requirements**
- Unit test on the shared helper asserting a rejecting handler is caught and logged.
- Existing module sync specs pass unchanged.

---

### #94 — Module factories discard their unsubscribe handles, and are called twice per deployment

- **Labels:** `technical-debt`, `reliability`, `backend`
- **Area / component:** `modules/*/index.ts`, `src/app.ts`, `src/workers/index.ts`

**Problem**
Every `subscribeXEventSync(...)` returns an unsubscribe function that every `createXModule` discards. Because each factory both registers HTTP routes and subscribes to the event bus as a side effect, and both processes construct every module, subscriptions are created with no way to remove them.

**Current behavior**
`src/app.ts` builds all twelve modules for their routes; `src/workers/index.ts` builds seven of them purely to wire subscriptions. In the worker process that means each handler is registered once — correct. In the API process it means seven handlers are registered that will never fire, because nothing in the API process publishes. `workers/index.ts`'s header comment explains this at length and calls it "redundant, not wrong". That is true for production, where each process is separate — but in tests, where `buildApp()` is called once per integration spec file within a single process, every call adds another permanent listener to the same module-level `EventEmitter`.

**Evidence / code location**
- `src/shared/events/index.ts:25-29` — a module-level `EventEmitter` with `setMaxListeners(50)`.
- `src/shared/events/index.ts:36-41` — `onBlockchainEvent` returns an unsubscribe function, documented as "call it on module/test teardown".
- `src/modules/deliveries/index.ts:51` — `subscribeDeliveryEventSync(syncDeliveryFromEvent);` — return value dropped. Same in the other six modules.
- `src/workers/index.ts:33-56` — the explanatory comment and the seven `void createXModule(...)` calls.
- Sixteen `*.integration.spec.ts` files each call `buildApp()`.

**Impact**
The 50-listener ceiling is a real bound: seven modules times sixteen integration spec files is well past it, and Node emits a `MaxListenersExceededWarning` once crossed. More importantly, the design makes it impossible to tear a module down, and it conflates two unrelated responsibilities — HTTP route registration and event-bus subscription — in one factory, which is why the API process ends up wiring subscriptions it does not want.

**Expected behavior**
Route registration and event subscription are separately invocable, and subscriptions return a handle callers can use to detach.

**Proposed scope / implementation direction**
1. Split each module's factory into `createXRoutes(prisma)` and `wireXEventSubscriptions(prisma): () => void`.
2. Have `app.ts` call only the former and `workers/index.ts` call both (or only the latter, plus whatever else it needs).
3. Return and retain the unsubscribe handles in `workers/index.ts`, invoking them in the `closeWithGrace` handler.
4. Update `src/workers/index.ts`'s header comment, which currently documents the workaround rather than the design.

**Acceptance criteria**
- [ ] The API process registers no blockchain-event subscriptions.
- [ ] The worker process registers exactly one per module and detaches them on shutdown.
- [ ] The integration suite produces no `MaxListenersExceededWarning`.
- [ ] Route behaviour is unchanged.

**Verification / testing requirements**
- Assert listener count on the shared bus after `buildApp()` is called repeatedly.
- Full `pnpm test` run with no listener warnings.

---

### #95 — `registerUser` accepts a `role` that no caller supplies and no route exposes

- **Labels:** `security`, `technical-debt`, `authentication`
- **Area / component:** `modules/auth/application/register-user.ts`, `modules/auth/interface/schemas.ts`

**Problem**
`RegisterUserInput` includes an optional `role?: UserRole` which the use case honours (`role: input.role ?? 'CUSTOMER'`). The registration route's Zod schema exposes only `email` and `password`, so nothing can currently reach it — but the parameter sits one careless spread away from being a privilege-escalation vector.

**Current behavior**
The route handler calls `useCases.registerUser(request.body)`, where `request.body` is typed and validated to `{ email, password }`. The `role` path is exercised only by a unit test that passes it directly. Adding any field to `registerBodySchema` and continuing to pass `request.body` wholesale would immediately expose it: a caller could then register themselves as `ADMIN`. Given that #5 establishes there is no other way to create an `ADMIN` at all, that would be the only such path in the system.

**Evidence / code location**
- `src/modules/auth/application/register-user.ts:17-21,40` — the optional `role` and its use.
- `src/modules/auth/interface/schemas.ts:6-9` — `registerBodySchema` with two fields.
- `src/modules/auth/interface/routes.ts:47` — `await useCases.registerUser(request.body)` — a direct pass-through.
- `src/modules/auth/application/register-user.spec.ts:39-50` — "respects an explicit role", the only caller.
- `prisma/schema.prisma:118` — `role UserRole @default(CUSTOMER)`.
- `docs/AUTHENTICATION.md` § Local Account Auth — "`role` defaults to `CUSTOMER`", with no mention that the use case accepts an override.

**Impact**
A latent mass-assignment hazard in the account-creation path. It is not currently exploitable — that is worth stating plainly — but it is unused, undocumented, and positioned exactly where a routine schema addition turns it into a critical vulnerability.

**Expected behavior**
Registration cannot assign a role. Role assignment happens only through the admin endpoint, which is audited and role-gated.

**Proposed scope / implementation direction**
1. Remove `role` from `RegisterUserInput` and hardcode `'CUSTOMER'` in `registerUser`.
2. Update the "respects an explicit role" test to assert the opposite: a supplied role is ignored.
3. If seeding genuinely needs to create an `ADMIN` (see #55), give it a distinct, clearly-named path rather than a general-purpose parameter on the public registration use case.
4. Note in `docs/AUTHENTICATION.md` that role is never client-supplied.

**Acceptance criteria**
- [ ] `registerUser` always creates a `CUSTOMER`.
- [ ] A test asserts that a supplied role is ignored.
- [ ] Any legitimate need to create elevated accounts uses a separate, explicit path.

**Verification / testing requirements**
- Updated unit tests in `register-user.spec.ts`.
- API test confirming an extra `role` field in the request body cannot change the created user's role.

---

### #96 — Ordered list queries lack supporting composite indexes

- **Labels:** `performance`, `database`
- **Area / component:** `prisma/schema.prisma`

**Problem**
Several read paths filter on one column and sort on another, but the schema provides only single-column indexes on the filter column. Postgres can use those for the filter but must then sort the matched rows.

**Current behavior**
- `notifications`: `findMany({ where: { userId, status? }, orderBy: { createdAt: 'desc' }, take })` against `@@index([userId])` and `@@index([status])` — no `(user_id, created_at)`.
- `audit_logs`: `findMany({ orderBy: { createdAt: 'desc' }, take })` against indexes on `(entityType, entityId)` and `(actorId)` — nothing on `createdAt`, so this is a full scan plus sort on every admin request.
- `deliveries`: `findMany({ where: { …addresses, status? }, orderBy: { createdAtChain: 'desc' } })` against four single-column indexes — no composite covering filter-plus-sort, and currently no `take` at all (#11).
- `escrows` / `driver_profiles`: the analytics `groupBy` predicates have no supporting index (also noted in #38).

**Evidence / code location**
- `prisma/schema.prisma:409-410` — `@@index([userId])`, `@@index([status])` on `Notification`.
- `prisma/schema.prisma:426-427` — `@@index([entityType, entityId])`, `@@index([actorId])` on `AuditLog`.
- `prisma/schema.prisma:187-190` — four single-column indexes on `Delivery`.
- `src/modules/notifications/infrastructure/prisma-notification-repository.ts:36-43`.
- `src/modules/admin/infrastructure/prisma-audit-log-repository.ts:34-40`.
- `src/modules/deliveries/infrastructure/prisma-delivery-repository.ts:30-42`.

**Impact**
Every one of these endpoints degrades as its table grows, and the audit-log endpoint in particular does a full table scan today. `audit_logs` is append-only and unbounded, so this worsens monotonically.

**Expected behavior**
Each ordered list query is backed by a composite index matching its filter-and-sort shape.

**Proposed scope / implementation direction**
1. Add in one migration: `@@index([userId, createdAt])` on `Notification`; `@@index([createdAt])` on `AuditLog`; `@@index([status, createdAtChain])` on `Delivery`; `@@index([status, token])` on `Escrow`; `@@index([tier])` on `DriverProfile`.
2. Verify each against `EXPLAIN ANALYZE` on a seeded dataset before committing — add only indexes the planner actually uses.
3. Drop any single-column index made fully redundant by a new composite, to keep write cost down.
4. Note the index rationale in `docs/DATABASE.md`.

**Acceptance criteria**
- [ ] Each named query uses an index scan rather than a sequential scan plus sort, verified by `EXPLAIN`.
- [ ] A migration exists and applies cleanly via `pnpm prisma:migrate:deploy`.
- [ ] No redundant indexes are left behind.
- [ ] `docs/DATABASE.md` explains the composite index choices.

**Verification / testing requirements**
- `EXPLAIN ANALYZE` output for each query, before and after, recorded in the PR.
- CI's `prisma:migrate:deploy` step passes.

---

### #97 — Expired and revoked refresh tokens accumulate forever

- **Labels:** `database`, `reliability`, `performance`, `security`
- **Area / component:** `prisma/schema.prisma`, `modules/auth/infrastructure/prisma-refresh-token-repository.ts`

**Problem**
Every login creates a `refresh_tokens` row, and every refresh creates another while revoking the old one. Nothing ever deletes a row, and there is no retention policy.

**Current behavior**
`RefreshTokenRepository` exposes `create`, `findByTokenHash`, `revoke` and `revokeAllForUser` — no delete, no prune. Rotation-on-use means an active user generates one row per refresh cycle indefinitely: at the default 15-minute access TTL, that is roughly 96 rows per user per day. Rows remain long past both their `expiresAt` (30 days) and their revocation, retaining a SHA-256 token hash and a user id for every session that ever existed.

**Evidence / code location**
- `src/modules/auth/infrastructure/prisma-refresh-token-repository.ts:15-36` — the four methods.
- `src/modules/auth/application/refresh-session.ts:53-61` — revoke-then-create on every refresh.
- `prisma/schema.prisma:132-144` — the model; `@@index([userId])`, no TTL, no cleanup.
- `src/shared/queue/queues.ts:10-14` — no maintenance queue exists to hang a job on.
- `docs/AUTHENTICATION.md` § Local Account Auth — describes rotation but not retention.

**Impact**
Unbounded growth in a table on the hot path of every authenticated request's refresh cycle, with an ever-growing unique index on `token_hash`. It is also a data-minimisation concern: retaining a per-session record indefinitely after both expiry and revocation serves no operational purpose.

**Expected behavior**
Rows that are both expired and revoked are removed on a schedule, with a configurable grace period.

**Proposed scope / implementation direction**
1. Add `deleteExpiredBefore(date)` to `RefreshTokenRepository`, deleting rows where `expiresAt < date` (optionally also revoked rows older than a shorter grace period, since a revoked token can never be reused).
2. Add a repeatable BullMQ maintenance job in the worker process, batched to avoid long locks — the same mechanism #40 needs for `actor_activities`, so consider one shared maintenance queue for both.
3. Add `REFRESH_TOKEN_RETENTION_DAYS` to the env schema and `.env.example`.
4. Register the queue in `MONITORED_QUEUES` so failures surface, and document the policy in `docs/DATABASE.md` and `docs/AUTHENTICATION.md`.

**Acceptance criteria**
- [ ] Expired rows are removed on a schedule.
- [ ] A currently valid refresh token is never removed.
- [ ] Deletion is batched.
- [ ] Retention is configurable and documented.

**Verification / testing requirements**
- Integration test in `prisma-repositories.integration.spec.ts` seeding expired, revoked and active rows and asserting only the intended ones are removed.

---

### #98 — Graceful shutdown does not wait for in-flight event handlers

- **Labels:** `reliability`, `backend`, `deployment`
- **Area / component:** `src/workers/index.ts`, `shared/events`

**Problem**
The worker's `closeWithGrace` handler closes the BullMQ workers, then the queues, then disconnects Prisma and Redis. Event handlers already dispatched through the in-process bus are fire-and-forget promises that nothing tracks or awaits, so shutdown can disconnect the database out from under a handler mid-write.

**Current behavior**
`pollContractEvents` calls `eventPublisher.publish(stored)`, which is a synchronous `EventEmitter.emit`. Each subscriber starts an async handler and attaches a `.catch`, returning immediately. The poll job's promise resolves as soon as the loop finishes, so BullMQ considers the job complete while handlers are still running. On shutdown, `worker.close()` waits for the *job*, not for the handlers, and `disconnectPrisma()` follows immediately afterwards.

**Evidence / code location**
- `src/workers/index.ts:67-76` — the shutdown sequence.
- `src/modules/indexer/application/poll-contract-events.ts:64-68` — `deps.eventPublisher.publish(stored)`, not awaited.
- `src/shared/events/index.ts:31-33` — `bus.emit(CHANNEL, event)`, synchronous dispatch of async handlers.
- `src/modules/deliveries/infrastructure/event-subscription.ts:18-22` — the fire-and-forget `.catch` pattern, repeated in all seven modules.
- `src/server.ts:13-22` — the API process has the same structure, though it publishes nothing.

**Impact**
A deployment rollout — the routine, documented operation in `docs/DEPLOYMENT.md` § Scaling — can interrupt a read-model write partway. Combined with #15 (no reprocessing for failed handlers) and #13 (checkpoint already advanced), an interrupted handler means an event that is stored, marked as consumed by the checkpoint, and never applied. The `closeWithGrace({ delay: 10_000 })` window helps only if something actually waits within it.

**Expected behavior**
Shutdown waits for in-flight event handlers to settle, up to the grace period, before disconnecting shared resources.

**Proposed scope / implementation direction**
1. Have the shared subscription helper (#93) track in-flight handler promises in a set, removing each on settle.
2. Export a `drainBlockchainEvents(timeoutMs)` from `src/shared/events/` that awaits the outstanding set with a bound.
3. Call it in the worker's `closeWithGrace` handler after `worker.close()` and before `disconnectPrisma()`.
4. Better still, have `pollContractEvents` await handler completion so the BullMQ job itself does not complete until its events are applied — which also gives #15 the natural place to record `processedAt`.

**Acceptance criteria**
- [ ] Shutdown waits for in-flight handlers up to a bounded timeout.
- [ ] A handler still running at the timeout is logged, not silently abandoned.
- [ ] Prisma and Redis are disconnected only after the drain.
- [ ] Normal (non-shutdown) throughput is unaffected.

**Verification / testing requirements**
- Unit test on the drain helper with a deliberately slow handler.
- Integration test asserting no handler runs after `disconnectPrisma()`.

---

### #99 — The `Decimal` → `BigInt` conversion and its explanatory comment are duplicated across two modules

- **Labels:** `refactor`, `technical-debt`, `database`
- **Area / component:** `modules/escrow/infrastructure/prisma-escrow-repository.ts`, `modules/analytics/infrastructure/prisma-analytics-reader.ts`

**Problem**
Both files convert a Prisma `Decimal` to a `BigInt` via `.toFixed()`, and both carry the same multi-line comment explaining that `.toString()` switches to exponential notation past 21 digits and that `BigInt()` cannot parse the result. The knowledge is real and important; the duplication means the next module that touches an amount will have to rediscover it.

**Current behavior**
`prisma-escrow-repository.ts` does `BigInt(record.amount.toFixed())` and `record.platformFee === null ? null : BigInt(record.platformFee.toFixed())`. `prisma-analytics-reader.ts` does `BigInt(row._sum.amount?.toFixed() ?? '0')` and cross-references the escrow file by path in its comment — an explicit acknowledgement that the logic is shared and the reference is manual.

**Evidence / code location**
- `src/modules/escrow/infrastructure/prisma-escrow-repository.ts:12-17` — the comment and both conversions.
- `src/modules/analytics/infrastructure/prisma-analytics-reader.ts:21-24` — the same comment, citing the escrow file by path.
- `prisma/schema.prisma:205-209` — `Decimal(39, 0)` and the comment explaining why 39 digits.
- `docs/DATABASE.md` § Money/Amounts — the third place this reasoning is written down.

**Impact**
A genuinely subtle correctness detail — silently producing an unparseable string for large `i128` values — is protected by convention and a manual cross-reference rather than by a shared function. The failure mode if someone uses `.toString()` is a runtime `SyntaxError` on exactly the largest, most valuable escrows.

**Expected behavior**
One helper performs the conversion, with the reasoning documented once at its definition.

**Proposed scope / implementation direction**
1. Add `decimalToBigInt(value: Decimal): bigint` and `decimalToBigIntOrNull(value: Decimal | null): bigint | null` to `src/shared/database/`, carrying the explanatory comment.
2. Add the inverse (`bigIntToDecimalString`) if the write side would benefit — `prisma-escrow-repository.ts` currently does `record.amount.toString()` on the way in, which is safe for `bigint` but worth co-locating for symmetry.
3. Replace both call sites; keep a one-line pointer to the helper where the comments were.
4. Cross-reference the helper from `docs/DATABASE.md` § Money/Amounts.

**Acceptance criteria**
- [ ] One implementation, used by both modules.
- [ ] The reasoning is documented at the definition, not duplicated at call sites.
- [ ] A unit test covers an `i128::MAX`-magnitude value round-tripping correctly.
- [ ] Existing escrow and analytics specs pass unchanged.

**Verification / testing requirements**
- Unit tests on the helper with a 39-digit value, zero, and null.
- Existing integration specs green.

---

### #100 — Read-model status transitions have no ledger-ordering guard, so a late event can overwrite newer state

- **Labels:** `bug`, `reliability`, `database`, `backend`
- **Area / component:** all `sync-*-from-event.ts` handlers and their repositories

**Problem**
Every read-model write applies its event's state unconditionally. No handler compares the incoming event's ledger sequence against what produced the row's current state, so an event processed out of order silently overwrites newer state with older.

**Current behavior**
Ordering is guaranteed only *within* one contract's poll cycle. Across contracts it is not guaranteed at all — five independent repeatable jobs poll five contracts on independent schedules, and their events reach the shared bus interleaved. A concrete case: `escrow_contract`'s `delivery_disputed` and its `escrow_released` are handled by the same `syncEscrowFromEvent`, and both call `updateStatus` with no ordering check — so if a `delivery_disputed` from an earlier ledger is processed after an `escrow_released` from a later one (possible after a retry, a replay, or the multi-page truncation in #13), the escrow reverts from `RELEASED` to `PAUSED`. The same applies to `deliveries` (a late `driver_assigned` reverting `DELIVERED` to `ACTIVE`), `disputes` and `fleet`.

**Evidence / code location**
- `src/modules/escrow/application/sync-escrow-from-event.ts:36-94` — every branch calls `updateStatus` unconditionally.
- `src/modules/escrow/infrastructure/prisma-escrow-repository.ts:52-64` — a plain `update`, no predicate on current state.
- `src/modules/deliveries/application/sync-delivery-from-event.ts:30-92` — same pattern.
- `src/modules/disputes/infrastructure/prisma-dispute-repository.ts:29-42` — `upsert` with an unconditional `update`.
- `src/shared/events/index.ts:10-21` — `BlockchainEventEnvelope` already carries `ledgerSeq`, which no handler reads.
- `prisma/schema.prisma` — no read-model table stores the ledger sequence that last wrote it.
- `src/modules/indexer/infrastructure/queue.ts:53-56` — five independent poll schedules.

**Impact**
Silent, hard-to-reproduce corruption of the read model for exactly the state transitions that matter most — escrow status and delivery status. It is also the amplifier for several other issues in this backlog: any retry, replay (#15), or truncation-driven re-fetch (#13) becomes a potential state regression rather than a harmless no-op. The envelope already carries the field needed to prevent it.

**Expected behavior**
Each read-model row records the ledger sequence of the event that last modified it, and a write from an older ledger is ignored rather than applied.

**Proposed scope / implementation direction**
1. Add a `last_event_ledger_seq BigInt?` column to the chain-derived read models (`deliveries`, `escrows`, `disputes`, `fleets`, `fleet_drivers`, `driver_profiles`) in one migration.
2. Thread `event.ledgerSeq` from the envelope through each sync handler into its repository patch — the value is already on `BlockchainEventEnvelope` and needs no new plumbing upstream.
3. Make each status write conditional: `updateMany({ where: { chainDeliveryId, OR: [{ lastEventLedgerSeq: null }, { lastEventLedgerSeq: { lte: incoming } }] }, data: { …, lastEventLedgerSeq: incoming } })`, logging at `debug` when a write is skipped as stale.
4. Note the ordering guarantee — and its limits — in `docs/EVENT_INDEXER.md`.

**Acceptance criteria**
- [ ] An event from an older ledger cannot overwrite state written by a newer one.
- [ ] Events arriving in order behave exactly as today.
- [ ] Skipped stale writes are logged, not silent.
- [ ] A migration exists and backfills the column as null (treated as "unknown, accept the write").

**Verification / testing requirements**
- Unit tests in each `sync-*-from-event.spec.ts` applying events in reverse ledger order and asserting the newer state survives.
- Integration test for the conditional update predicate.

---

## Backlog validation summary

- **Total issues remaining:** 70, numbered #31–#100 with no gaps and no duplicates. (The backlog was authored as 100 issues, #1–#100; items #1–#30 were published as GitHub issues #9–#38 and removed from this file.)
- **Numbering:** sequential and stable; remaining items keep their original backlog numbers rather than being renumbered, so cross-references from already-published issues stay resolvable. (`planned.md` is an untracked local draft of Wave candidates, not an established backlog, and is not continued here.)
- **Structure:** every issue carries the same eleven elements — title, topical labels, area/component, Problem, Current behavior, Evidence / code location, Impact, Expected behavior, Proposed scope / implementation direction, Acceptance criteria, Verification / testing requirements.
- **Verification:** every referenced file, function, route, schema field, config variable and documentation section was read in this repository at commit `ec15e93` before being cited.
- **Duplicate check:** GitHub issues #9–#38 are this backlog's already-published first batch (original items #1–#30, removed from this file); the eight open PRs are all Dependabot version bumps, and no issue here proposes any of those bumps.

### Candidates examined and rejected

| Candidate | Why it was rejected |
|---|---|
| "`.env.example` has drifted from the config schema (25 vars vs 20 schema fields)" | Not true on `main`. Both list the same 25 keys. Only the *unused* `SETTLEMENT_CONTRACT_ID` is a real finding, filed narrowly as backlog #50. |
| "`docs/API_REFERENCE.md`'s planned-endpoints table is stale, listing shipped `analytics`/`admin` as planned" | Already fixed. The table now contains one accurate row (`POST /transactions/submit`), filed as backlog #72. |
| "Evidence upload/download has no ownership check (IDOR)" | Already fixed in Phase 6 (`docs/SECURITY.md` § Security Review History). The residual gaps are different and narrower: GitHub #14 (content type), #15 (size), #17 (ownership transfer on wallet unlink). |
| "Rate limiting breaks the API when Redis is down" | Already fixed — `skipOnError: true` is set deliberately in `security.ts` with an explanatory comment. |
| "Prisma client is copied incorrectly in the Dockerfile under pnpm" | Already fixed in Phase 6, with the reasoning preserved in `Dockerfile` comments. |
| "Analytics `disputeRate` can exceed 1" | Not reachable — `Dispute` holds a foreign key to `Delivery`, so a dispute cannot exist without a counted delivery. (That same FK is the subject of #29 for a different reason.) |
| "`local-evidence-storage.read` is vulnerable to path traversal" | Not reachable — `path.resolve` plus the `startsWith(resolvedBaseDir + path.sep)` guard correctly rejects both absolute and `..`-relative escapes. |
| "`scValToNative` decodes bytes to base64 while `bytesToScVal` expects hex" | Handled deliberately — `disputes-scval-mapping.ts`'s `base64ToHex` normalises at the boundary with an explanatory comment. The narrower real defect (silent truncation of invalid hex) is filed as #71. |
| Bumping `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `actions/upload-artifact`, `softprops/action-gh-release`, the `node` base image, or the npm minor/patch group | Each is already an open Dependabot PR (#1–#8). |
| "`docs/DEPLOYMENT.md` says 'three real bugs' then lists four" | A single-word typo with no behavioural consequence — below the bar for a standalone contributor issue. |
