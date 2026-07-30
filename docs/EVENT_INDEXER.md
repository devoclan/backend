# Blockchain Event Indexer

The indexer is how every other module learns what happened on-chain. It is the only writer of the `deliveries`, `escrows`, `disputes`, `fleets`, `fleet_drivers`, and `driver_profiles` tables — API routes read them, but only the indexer's event handlers write them, based on confirmed on-chain events, never based on an API request "assuming" a transaction will succeed.

See `ARCHITECTURE.md` §6 for the design summary and sequence diagram this document expands on, and `PHASE_1_DOMAIN_ANALYSIS.md` §9 for the authoritative event catalog across all six contracts.

## Why Polling, Not Push

Soroban RPC exposes `getEvents(startLedger, filters)` — a pull API. There is no push/webhook mechanism from the chain itself, so the indexer runs as a **BullMQ repeatable job** (`QueueName.BlockchainIndexer`, `src/shared/queue/queues.ts`) on an interval (`INDEXER_POLL_INTERVAL_MS`, default 5s), not a long-lived subscription.

## Checkpointing

One `blockchain_checkpoints` row per `(contractName, network)`. Each poll cycle:

1. Read `lastLedgerSeq` for the contract being polled.
2. Call `getEvents({ startLedger: lastLedgerSeq + 1, filters: [{ contractIds: [contractId] }] })` via `SorobanClient.getEvents` (`src/blockchain/soroban-client.ts` — already wrapped in retry + circuit breaker, so indexer code doesn't need its own retry logic).
3. Process every returned event (see Idempotent Ingestion, below).
4. Advance `lastLedgerSeq` to the latest ledger actually returned, **only after** every event in that batch has been durably persisted — a crash mid-batch must not advance the checkpoint past unprocessed events.

Restart safety follows directly from this: the indexer always resumes from persisted state, never from "now."

## Idempotent Ingestion

Every raw event is written to `blockchain_events` first, with a unique constraint on `(contractName, txHash, eventIndex)`, **before** any domain handler runs. Re-polling an overlapping ledger range (which can happen — RPC pagination and retries are not guaranteed exactly-once) becomes a harmless upsert-or-skip instead of double-processing a payout or double-incrementing reputation. This is the single most important lesson carried over from `PHASE_2_REFERENCE_ANALYSIS.md` §3 — the reference implementation got this right and it's worth taking seriously.

## Event → Handler Mapping

Each contract gets one adapter (`src/blockchain/contracts/<contract>.ts`, Phase 5) that turns a raw RPC event into a typed domain event, isolating the raw Soroban event shape from module code. Handlers subscribe to typed events via an in-process event bus (`src/shared/events`, Phase 5) — not a distributed bus in v1 (see `ARCHITECTURE.md` §11 for why, and when that might change).

| Contract | Events | Primary consumer(s) |
|---|---|---|
| `escrow_contract` | `escrow_funded`, `escrow_released`, `escrow_refunded`, `delivery_disputed`, `dispute_resolved`, `FeeUpdated`, `AdminTransferred`, `ProtocolInitialized` | `escrow`, `disputes` |
| `delivery_contract` | `delivery_created`, `driver_assigned`, `DeliveryInTransit`, `delivery_confirmed`, `delivery_cancelled`, `delivery_disputed` | `deliveries`, `disputes`, `reputation` (legacy counter only) |
| `dispute_resolution_contract` | `dispute_raised`, `evidence_added`, `dispute_resolved_refund`, `dispute_resolved_split`, `dispute_resolved_payout` | `disputes`, `reputation` |
| `fleet_management_contract` | `fleet_registered`, `fleet_treasury_updated`, `driver_invited`, `invite_accepted`, `driver_removed` | `fleet` |
| `identity_reputation_contract` | `driver_registered`, `user_registered`, `kyc_status_updated`, `reputation_increased`, `reputation_decreased` | `reputation`, `users` |

Note from `PHASE_1_DOMAIN_ANALYSIS.md` §5: **neither dispute event stream alone tells the full story** — `dispute_resolution_contract`'s events and `escrow_contract`'s dispute-adjacent events must both feed the same `disputes` row per `chainDeliveryId`.

## Lag Monitoring

`now_ledger - lastLedgerSeq` (via `SorobanClient.getLatestLedger()` compared against the checkpoint) is exposed on `GET /health/indexer` (Phase 5) and alerted on past `INDEXER_LAG_ALERT_LEDGERS`. This is the "indexer lag as a first-class health signal" pattern adopted from `PHASE_2_REFERENCE_ANALYSIS.md` §3.

## Malformed Events

A handler that fails to parse an event logs and records the failure (not silently dropped, not a crash of the whole poll cycle) — the batch continues, and the raw event is still durably stored in `blockchain_events` for later manual inspection or reprocessing.

## Status

Not yet implemented (Phase 5, after the `shared`/`blockchain` foundations and before `deliveries`/`escrow`, per `ROADMAP.md` §5). This document is the design contract Phase 5 implements against.
