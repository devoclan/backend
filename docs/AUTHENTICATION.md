# Authentication

## Two Distinct Identity Concepts

Per `PHASE_1_DOMAIN_ANALYSIS.md` §1, the smart contracts have **no concept of email, password, or session** — on-chain identity is a Stellar `Address` authenticated by that address's own signature (`require_auth()`). This backend owns a *separate*, off-chain identity layer (local accounts) and links it to one or more wallet addresses. The two are related but not the same thing:

| | Off-chain account (`users` table) | On-chain identity (`Address`) |
|---|---|---|
| Created by | `POST /auth/register` | A Stellar keypair (client-side, e.g. Freighter) |
| Authenticates via | Email + password → JWT | Transaction signature |
| Used for | Login, RBAC, notifications, KYC intake | Every contract call's `require_auth()` |

## Local Account Auth

- **Registration**: email + password (bcrypt-hashed, never stored or logged in plaintext — see the logger's redaction config in `src/shared/logger/index.ts`), `role` defaults to `CUSTOMER`.
- **Email verification**: a signed, time-limited token emailed on registration; `emailVerifiedAt` gates certain actions (exact gating rules land with the `auth` module in Phase 5).
- **Login**: issues a short-lived **access token** (JWT, `JWT_ACCESS_TTL`, default 15m) and a longer-lived **refresh token** (opaque, hashed at rest in `refresh_tokens.token_hash`, `JWT_REFRESH_TTL`, default 30d). Access tokens are never persisted server-side (stateless, verified by signature); refresh tokens are persisted and revocable (`revoked_at`), so a compromised refresh token can be invalidated without waiting for expiry.
- **Password reset**: signed, time-limited token via email, same pattern as verification.
- **RBAC**: `UserRole` enum — `CUSTOMER`, `COURIER`, `FLEET_MANAGER`, `ADMIN`. Enforced via a Fastify `preHandler` guard reading the verified JWT's role claim; route-level, not scattered `if` checks inside handlers.

## Wallet Linking

A user links a Stellar address via a **challenge-response** flow (standard practice, not yet implemented as of this scaffold): the backend issues a random nonce, the client signs it with the wallet's key (off-chain signature, no transaction/fee involved), and the backend verifies the signature against the claimed address before marking `wallet_addresses.verifiedAt`. This proves address ownership without ever handling a private key.

## Transaction Signing — Never Backend-Custodied

Per `ARCHITECTURE.md` §2 and the lesson in `PHASE_2_REFERENCE_ANALYSIS.md` §5.7: **the backend never holds a sender/recipient/driver/fleet-owner private key.** Every contract call requiring that party's own `require_auth()` is exposed as a `POST /transactions/build/...` endpoint returning an unsigned XDR envelope for the client's wallet to sign. The only party whose signature the backend could ever legitimately hold is a backend-managed *admin* hot-wallet, and no such capability is assumed or implemented in this scaffold — if a future admin-automation feature needs it, that's a distinct, explicitly-scoped decision documented here and in `SECURITY.md` when it happens, not a default.

## JWT Details

- Algorithm: HS256 with `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (each ≥ 32 chars, validated at boot by `src/shared/config/env.ts` — the process refuses to start with a weak or missing secret).
- Access token claims: `sub` (user id), `role`, `iat`, `exp`. No PII beyond the user id.
- Refresh rotation: presenting a valid refresh token issues a new access + refresh token pair and revokes the old refresh token (rotation-on-use), limiting the blast radius of a leaked refresh token.

## Status

The `auth` module itself is not yet implemented (Phase 5) — this document describes the design it will be built to, so route/behavior details here are the contract, not yet a description of shipped code.
