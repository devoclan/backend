# FaniLab Backend — Contributor Issue Backlog

A contributor-ready backlog of **47 unpublished issues** (#81–#127) for [`fanilabs/backend`](https://github.com/fanilabs/backend), authored against `main` at commit `ec15e93` (`v1.0.0`) across two independent mining passes.

> **Published:** backlog items #1–#80 have been filed as GitHub issues **#9–#88** and removed from this file. Backlog numbering of the remaining items is unchanged — item #81 below is GitHub-unpublished, not GitHub issue #81.
>
> **Second pass:** items #101–#127 were added in a second, independent mining pass over the same repository and are freshly discovered — none is a reword, split, or restatement of #1–#100 or of GitHub #9–#88. See Section K and its closing validation summary for the methodology and the specific hypotheses that were investigated and ruled out.

Every entry below was verified against the actual implementation — file, function, and behaviour — not inferred from documentation. Where a doc and the code disagree, the code was treated as authoritative and the disagreement is itself recorded as part of the issue.

## How to use this backlog

- Each issue is independently solvable and scoped to a single contributor-sized change.
- Labels are ordinary topical GitHub labels (`bug`, `security`, `enhancement`, `performance`, `testing`, `documentation`, `refactor`, `backend`, `database`, `api`, `authentication`, `authorization`, `devops`, `ci`, `deployment`, `reliability`, `validation`, `dependencies`, `technical-debt`, `observability`).
- Every issue uses the same structure: title, labels, area/component, then **Problem**, **Current behavior**, **Evidence / code location**, **Impact**, **Expected behavior**, **Proposed scope / implementation direction**, **Acceptance criteria**, **Verification / testing requirements**.
- Nothing below duplicates existing tracker content: GitHub issues #9–#88 are the already-published batches from this same backlog, and PRs #1–#8 are Dependabot version bumps that no issue here proposes.

## Index

| Section | Issues | Theme |
|---|---|---|
| H | #81 | Testing |
| I | #82–#88 | Documentation |
| J | #89–#100 | Maintainability & performance |
| K | #101–#127 | Second-pass findings — validation/blockchain-encoding bugs, security & deployment, documentation drift, CI & dependencies, test-coverage gaps, and duplication/maintainability |

---

## Section H — Testing

---

### #81 — CI has no scheduled run, so nothing catches environment drift or newly disclosed advisories

- **Labels:** `ci`, `testing`, `devops`
- **Area / component:** `.github/workflows/ci.yml`

**Problem**
CI runs only on pushes to `main` and on pull requests. `ROADMAP.md` §10 specifies that end-to-end tests should run "on a schedule and on release branches given its higher cost/flakiness surface", and there is no scheduled workflow at all.

**Current behavior**
`on: { push: { branches: [main] }, pull_request: { branches: [main] } }`. A repository with no merges for a week runs no CI for a week. Nothing detects a newly published advisory against a pinned dependency (see GitHub #64), a broken public Soroban testnet RPC that the network-gated integration tests would surface, or a base-image change.

**Evidence / code location**
- `.github/workflows/ci.yml:3-7` — the two triggers.
- `.github/workflows/release.yml:3-6` — tag trigger only.
- `ROADMAP.md` §10 — the scheduled-e2e commitment.
- `src/modules/indexer/infrastructure/soroban-event-source.integration.spec.ts` — gated on `isSorobanRpcAvailable`, so it skips silently rather than reporting upstream breakage.
- `.github/dependabot.yml` — weekly, but it opens PRs rather than running the suite.

**Impact**
Time-dependent breakage — advisories, upstream RPC changes, base-image updates — is discovered by whoever happens to open the next PR, at the worst possible moment. The network-gated tests, which are the only ones exercising a real Soroban RPC, effectively never report anything.

**Expected behavior**
A scheduled workflow runs the full suite (including e2e once GitHub #82 lands) on a regular cadence and reports failures visibly.

**Proposed scope / implementation direction**
1. Add `schedule: [{ cron: '0 6 * * 1' }]` (or daily) to CI, or create a separate `nightly.yml` reusing the CI jobs.
2. Include the audit job from GitHub #64 and the Docker build from GitHub #66.
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
A DoD item was recorded as met without being met, across twelve modules. More practically, the event-driven half of the system — the indexer and everything downstream of it — has no way to be demonstrated or explored locally. That gap compounds with GitHub #63 (no seed data): a new contributor can neither seed state nor simulate the events that would create it.

**Expected behavior**
At least one runnable example per non-HTTP flow, executable against a local stack with no live chain.

**Proposed scope / implementation direction**
1. `scripts/examples/publish-event.ts` — publish a synthetic blockchain event through `publishBlockchainEvent` and show the resulting read-model change, reusing the shared fixtures from GitHub #88.
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
4. Consider separating the single-purpose-token secret from the session secret, which would narrow the blast radius substantially and composes well with GitHub #9's `purpose` claim.

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
The implementations are byte-identical where they overlap. Each file's header comment justifies keeping *contract-specific* encoding local to the module — which is right, and not what this issue proposes changing. The generic, contract-agnostic scaffolding around it is what has been duplicated. GitHub #30 is a concrete bug living in three of the four copies simultaneously.

**Evidence / code location**
- `src/modules/deliveries/infrastructure/delivery-scval-mapping.ts:103-161` — nine helpers.
- `src/modules/escrow/infrastructure/escrow-scval-mapping.ts:47-92` — seven of the same.
- `src/modules/disputes/infrastructure/disputes-scval-mapping.ts:79-130` — seven, plus `base64ToHex` and `requireArray`.
- `src/modules/reputation/infrastructure/reputation-scval-mapping.ts` — the same pattern again.
- `eslint.config.js:60-63` — `infrastructure` may import from `blockchain`, so a shared home already exists and is already permitted.
- `CONTRIBUTING.md` § Code Standards — "No duplicate or parallel implementation of an existing entity/module left in the tree."

**Impact**
Any fix to a decode helper — like GitHub #30's `Invalid Date` bug, or GitHub #79's hex validation — must be applied four times or it is applied inconsistently. Four copies also means four places where a subtle divergence can appear unnoticed, in the layer that translates untrusted on-chain data into database writes.

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
Each file differs only in the logger's `module` label, the handler's type, and the log message. Several carry a comment noting they mirror "every other module's own infrastructure/event-subscription.ts". This is the layer where GitHub #23's missing failure tracking would need to be added — meaning that fix currently has to be applied seven times.

**Evidence / code location**
- `src/modules/deliveries/infrastructure/event-subscription.ts:15-23` — the canonical version.
- The same shape in `escrow`, `fleet`, `disputes`, `reputation`, `notifications` and `fraud-detection`.
- `src/shared/events/index.ts:36-41` — `onBlockchainEvent(handler): () => void`, the shared primitive they all wrap.
- `eslint.config.js:60-63` — `infrastructure` may import from `shared`.

**Impact**
Seven copies of the codebase's only error-handling boundary for event processing. Any cross-cutting improvement — failure tracking (GitHub #23), retry, metrics, tracing — must be made seven times, and a module added later can silently omit the `.catch`, turning one bad event into an unhandled rejection that takes down the worker process.

**Expected behavior**
One shared subscription helper that every module uses, with per-module labelling passed in.

**Proposed scope / implementation direction**
1. Add `subscribeToBlockchainEvents(moduleName: string, handler: (e: BlockchainEventEnvelope) => Promise<void>): () => void` to `src/shared/events/`, containing the catch-and-log logic once.
2. Replace all seven module files with a one-line call, or delete them and call the shared helper directly from each composition root.
3. Add the metrics/failure hooks GitHub #23 needs in the shared helper only.
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
The route handler calls `useCases.registerUser(request.body)`, where `request.body` is typed and validated to `{ email, password }`. The `role` path is exercised only by a unit test that passes it directly. Adding any field to `registerBodySchema` and continuing to pass `request.body` wholesale would immediately expose it: a caller could then register themselves as `ADMIN`. Given that GitHub #13 establishes there is no other way to create an `ADMIN` at all, that would be the only such path in the system.

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
3. If seeding genuinely needs to create an `ADMIN` (see GitHub #63), give it a distinct, clearly-named path rather than a general-purpose parameter on the public registration use case.
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
- `deliveries`: `findMany({ where: { …addresses, status? }, orderBy: { createdAtChain: 'desc' } })` against four single-column indexes — no composite covering filter-plus-sort, and currently no `take` at all (GitHub #19).
- `escrows` / `driver_profiles`: the analytics `groupBy` predicates have no supporting index (also noted in GitHub #46).

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
2. Add a repeatable BullMQ maintenance job in the worker process, batched to avoid long locks — the same mechanism GitHub #48 needs for `actor_activities`, so consider one shared maintenance queue for both.
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
A deployment rollout — the routine, documented operation in `docs/DEPLOYMENT.md` § Scaling — can interrupt a read-model write partway. Combined with GitHub #23 (no reprocessing for failed handlers) and GitHub #21 (checkpoint already advanced), an interrupted handler means an event that is stored, marked as consumed by the checkpoint, and never applied. The `closeWithGrace({ delay: 10_000 })` window helps only if something actually waits within it.

**Expected behavior**
Shutdown waits for in-flight event handlers to settle, up to the grace period, before disconnecting shared resources.

**Proposed scope / implementation direction**
1. Have the shared subscription helper (#93) track in-flight handler promises in a set, removing each on settle.
2. Export a `drainBlockchainEvents(timeoutMs)` from `src/shared/events/` that awaits the outstanding set with a bound.
3. Call it in the worker's `closeWithGrace` handler after `worker.close()` and before `disconnectPrisma()`.
4. Better still, have `pollContractEvents` await handler completion so the BullMQ job itself does not complete until its events are applied — which also gives GitHub #23 the natural place to record `processedAt`.

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
Ordering is guaranteed only *within* one contract's poll cycle. Across contracts it is not guaranteed at all — five independent repeatable jobs poll five contracts on independent schedules, and their events reach the shared bus interleaved. A concrete case: `escrow_contract`'s `delivery_disputed` and its `escrow_released` are handled by the same `syncEscrowFromEvent`, and both call `updateStatus` with no ordering check — so if a `delivery_disputed` from an earlier ledger is processed after an `escrow_released` from a later one (possible after a retry, a replay, or the multi-page truncation in GitHub #21), the escrow reverts from `RELEASED` to `PAUSED`. The same applies to `deliveries` (a late `driver_assigned` reverting `DELIVERED` to `ACTIVE`), `disputes` and `fleet`.

**Evidence / code location**
- `src/modules/escrow/application/sync-escrow-from-event.ts:36-94` — every branch calls `updateStatus` unconditionally.
- `src/modules/escrow/infrastructure/prisma-escrow-repository.ts:52-64` — a plain `update`, no predicate on current state.
- `src/modules/deliveries/application/sync-delivery-from-event.ts:30-92` — same pattern.
- `src/modules/disputes/infrastructure/prisma-dispute-repository.ts:29-42` — `upsert` with an unconditional `update`.
- `src/shared/events/index.ts:10-21` — `BlockchainEventEnvelope` already carries `ledgerSeq`, which no handler reads.
- `prisma/schema.prisma` — no read-model table stores the ledger sequence that last wrote it.
- `src/modules/indexer/infrastructure/queue.ts:53-56` — five independent poll schedules.

**Impact**
Silent, hard-to-reproduce corruption of the read model for exactly the state transitions that matter most — escrow status and delivery status. It is also the amplifier for several other issues in this backlog: any retry, replay (GitHub #23), or truncation-driven re-fetch (GitHub #21) becomes a potential state regression rather than a harmless no-op. The envelope already carries the field needed to prevent it.

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

- **Total issues remaining:** 47, numbered #81–#127 with no gaps and no duplicates. (The backlog was authored as 100 issues in a first pass, #1–#100, then extended to 127 in a second pass; items #1–#80 have since been published as GitHub issues #9–#88 and removed from this file.)
- **Numbering:** sequential and stable; remaining items keep their original backlog numbers rather than being renumbered, so cross-references from already-published issues stay resolvable. (`planned.md` is an untracked local draft of Wave candidates, not an established backlog, and is not continued here.)
- **Structure:** every issue carries the same eleven elements — title, topical labels, area/component, Problem, Current behavior, Evidence / code location, Impact, Expected behavior, Proposed scope / implementation direction, Acceptance criteria, Verification / testing requirements.
- **Verification:** every referenced file, function, route, schema field, config variable and documentation section was read in this repository at commit `ec15e93` before being cited.
- **Duplicate check:** GitHub issues #9–#88 are this backlog's already-published batches (original items #1–#80, removed from this file); the eight open PRs are all Dependabot version bumps, and no issue here proposes any of those bumps.

### Candidates examined and rejected

| Candidate | Why it was rejected |
|---|---|
| "`.env.example` has drifted from the config schema (25 vars vs 20 schema fields)" | Not true on `main`. Both list the same 25 keys. Only the *unused* `SETTLEMENT_CONTRACT_ID` is a real finding, filed narrowly as GitHub #58. |
| "`docs/API_REFERENCE.md`'s planned-endpoints table is stale, listing shipped `analytics`/`admin` as planned" | Already fixed. The table now contains one accurate row (`POST /transactions/submit`), filed as GitHub #80. |
| "Evidence upload/download has no ownership check (IDOR)" | Already fixed in Phase 6 (`docs/SECURITY.md` § Security Review History). The residual gaps are different and narrower: GitHub #14 (content type), #15 (size), #17 (ownership transfer on wallet unlink). |
| "Rate limiting breaks the API when Redis is down" | Already fixed — `skipOnError: true` is set deliberately in `security.ts` with an explanatory comment. |
| "Prisma client is copied incorrectly in the Dockerfile under pnpm" | Already fixed in Phase 6, with the reasoning preserved in `Dockerfile` comments. |
| "Analytics `disputeRate` can exceed 1" | Not reachable — `Dispute` holds a foreign key to `Delivery`, so a dispute cannot exist without a counted delivery. (That same FK is the subject of GitHub #37 for a different reason.) |
| "`local-evidence-storage.read` is vulnerable to path traversal" | Not reachable — `path.resolve` plus the `startsWith(resolvedBaseDir + path.sep)` guard correctly rejects both absolute and `..`-relative escapes. |
| "`scValToNative` decodes bytes to base64 while `bytesToScVal` expects hex" | Handled deliberately — `disputes-scval-mapping.ts`'s `base64ToHex` normalises at the boundary with an explanatory comment. The narrower real defect (silent truncation of invalid hex) is filed as GitHub #79. |
| Bumping `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `actions/upload-artifact`, `softprops/action-gh-release`, the `node` base image, or the npm minor/patch group | Each is already an open Dependabot PR (#1–#8). |
| "`docs/DEPLOYMENT.md` says 'three real bugs' then lists four" | A single-word typo with no behavioural consequence — below the bar for a standalone contributor issue. |

---

## Section K — Second-Pass Findings (#101–#127)

A second, independent mining pass over the same repository at the same commit (`ec15e93`, `v1.0.0`), performed after backlog items #1–#100 (of which #1–#80 are now published as GitHub issues #9–#88). Every item below was freshly discovered against the current implementation — none is a reword, split, or restatement of #1–#100 or of GitHub #9–#88. Verification for this pass additionally included live execution of the actual `@stellar/stellar-sdk`/`bcrypt`/`jsonwebtoken` packages installed in `node_modules`, a `pnpm audit` run against the committed lockfile, a `gh api` query against the live repository's security settings, and `git log --follow` against the migration files — not code-reading alone.

---

### #101 — `escrow`'s `token` field is validated as an account address, rejecting every real Soroban token-contract address

- **Labels:** `bug`, `validation`, `api`, `backend`
- **Area / component:** `modules/escrow/interface/schemas.ts`, `modules/escrow/domain/ports.ts`

**Problem**
`createEscrowBodySchema.token` reuses the same `stellarAddress` constant used for `senderAddress`/`recipientAddress`/`driverAddress` — a regex matching only the StrKey format for an ed25519 **account** public key (`G` + 55 base32 characters). `escrow_contract.create_escrow`'s `token` parameter, per its own documented behavior, is a Soroban **token contract** address (`create_escrow` "transfers `amount` from sender to contract" via the token's SEP-41 `transfer` interface) — and every Soroban contract address uses the entirely different `C` + 55-character StrKey format.

**Current behavior**
`const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, 'Not a valid Stellar public key');` is applied verbatim to `token` in `createEscrowBodySchema` (`token: stellarAddress`). A real Soroban contract StrKey — verified directly against the installed SDK — is 56 characters starting with `C`, e.g. `CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526` (`StrKey.isValidContract(...)` returns `true` for this, `/^G[A-Z2-7]{55}$/.test(...)` returns `false`). Every real token address — including the native XLM Stellar Asset Contract, which is itself a `C...` contract — therefore fails Zod validation with `400 VALIDATION_ERROR` before the request ever reaches the handler.

**Evidence / code location**
- `src/modules/escrow/interface/schemas.ts:4,36` — the shared `stellarAddress` const and `token: stellarAddress`.
- `src/modules/escrow/domain/ports.ts:37` — `CreateEscrowTxInput.token: string`, no comment distinguishing it from the account-address fields around it.
- `PHASE_1_DOMAIN_ANALYSIS.md:56-57` — `init(admin, token, platform_fee_bps)` and `create_escrow(sender, recipient, driver, delivery_id, token, amount)` — "transfers `amount` from sender to contract" is a token-contract `transfer` call, not an account-to-account payment.
- Verified live against `@stellar/stellar-sdk@12.3.0`: `StrKey.encodeContract(Buffer.alloc(32,1))` produces a 56-character `C`-prefixed StrKey that fails the `stellarAddress` regex, and `StrKey.isValidEd25519PublicKey()` correctly rejects it as an account key.

**Impact**
`POST /api/v1/transactions/build/create-escrow` — the endpoint that funds every delivery's escrow, the financial core of the product — cannot be called with any real token address under the standard Soroban convention. This is not a partial degradation; it is a complete rejection of the intended input for the endpoint's primary use case, currently masked only by the fact that no FaniLab contract is deployed anywhere reachable from this repository's environment to have exposed it against real traffic.

**Expected behavior**
`token` accepts a Soroban contract address (`C...`), matching what `escrow_contract.create_escrow` actually expects.

**Proposed scope / implementation direction**
1. Add a `contractAddress` (or similarly named) Zod constant validating the `C[A-Z2-7]{55}` StrKey shape, mirroring `stellarAddress`'s pattern.
2. Change `createEscrowBodySchema.token` to use it instead of `stellarAddress`.
3. Add a doc comment on `CreateEscrowTxInput.token` in `domain/ports.ts` stating explicitly that this is a contract address, not an account address, so the distinction isn't lost again.
4. Update `docs/API_REFERENCE.md`'s escrow section to state the expected format.
5. Consider using the SDK's own `StrKey.isValidContract()` in a `.refine()` for checksum validation too, rather than a bare regex (see #103 for the parallel account-address checksum gap).

**Acceptance criteria**
- [ ] A real Soroban contract address (`C...`) passes `createEscrowBodySchema` validation.
- [ ] A `G...` account address is rejected for `token` with a clear validation message.
- [ ] `docs/API_REFERENCE.md` states the expected format.

**Verification / testing requirements**
- Unit test on `createEscrowBodySchema` asserting a `C...` address is accepted and a `G...` address is rejected for `token`.
- API test on `POST /api/v1/transactions/build/create-escrow` with a real contract-format `token`.

---

### #102 — Unbounded numeric inputs silently overflow (or unhandled-crash) Soroban integer encoders, with no validation anywhere in the pipeline

- **Labels:** `security`, `bug`, `validation`, `api`, `backend`
- **Area / component:** `blockchain/xdr/sc-val.ts`, `modules/escrow/interface/schemas.ts`, `modules/deliveries/interface/schemas.ts`

**Problem**
`u32ToScVal`, `u64ToScVal`, and `i128ToScVal` perform no range checking on their input, and none of the three request schemas that feed them (`weightGrams`, `chainDeliveryId`/`chainFleetId`, `amount`) bound the numeric magnitude of what a client can submit. The failure modes differ by encoder, and the worst of them produces no error at all.

**Current behavior**
Verified live against the installed `@stellar/stellar-sdk@12.3.0`:
- `xdr.ScVal.scvU32(value)` constructs successfully for any JS number, including negative values and values far above `2**32-1`; the out-of-range value is only caught when `.toXDR()` is later called, which throws a plain `XdrWriterError: XDR Write Error: invalid u32 value` — **not** an `AppError`, so it becomes an unmapped `500 INTERNAL_ERROR` (see `error-handler.ts`'s generic fallback).
- `xdr.ScVal.scvU64(new xdr.Uint64(value))` and `i128ToScVal`'s hand-rolled `hi`/`lo` split (`src/blockchain/xdr/sc-val.ts:120-125`) **do not throw at all** for out-of-range input — `.toXDR()` succeeds and silently produces a 128-bit/64-bit two's-complement bit pattern that does **not** represent the decimal value the client submitted. Verified live: encoding `10n**60n` (a number a client could type into `amount` — the field has no length or magnitude cap, only `/^\d+$/`) through the exact `i128ToScVal` logic in this file produces a 20-byte XDR value with no error, no warning, and no way for either the backend or the caller to detect that the encoded amount does not match the requested one.
- `weightGrams: z.number().int().positive()` (deliveries) has no `.max()`, so a value above `4294967295` reaches `u32ToScVal` → the unhandled-500 path above.
- `amount: z.string().regex(/^\d+$/)` (escrow) has no length/magnitude cap at all, so an arbitrarily large decimal string reaches `i128ToScVal` → the silent-corruption path above.

**Evidence / code location**
- `src/blockchain/xdr/sc-val.ts:105-125` — `u32ToScVal`, `u64ToScVal`, `i128ToScVal`, none bounds-checked.
- `src/modules/deliveries/interface/schemas.ts:52` — `weightGrams: z.number().int().positive()`, no max.
- `src/modules/escrow/interface/schemas.ts:6` — `const amount = z.string().regex(/^\d+$/, ...)`, no max.
- `src/modules/deliveries/infrastructure/delivery-scval-mapping.ts:66` — `weight_grams: u32ToScVal(input.weightGrams)`.
- `src/modules/escrow/infrastructure/escrow-scval-mapping.ts:43` — `i128ToScVal(input.amount)`.
- Live-tested against the installed SDK in this session: `xdr.ScVal.scvU32(9999999999999).toXDR()` throws `XdrWriterError`; the equivalent test for `i128ToScVal(10n**60n).toXDR()` succeeds with no error.

**Impact**
For `amount` — the field controlling how much value gets locked in escrow — a client input that is too large (a plausible unit-conversion bug on a frontend, e.g. sending stroops where whole units were expected, scaled up further by a decimal-shift error) is silently corrupted into an unrelated 128-bit value with **no error at any layer**: not Zod, not `BigInt()`, not ScVal construction, not XDR serialization. The backend returns `200 OK` with a syntactically valid but semantically wrong unsigned transaction for the client's wallet to sign. For `weightGrams`, the same class of client mistake instead surfaces as an opaque `500 INTERNAL_ERROR`, masking a client input error as a server fault.

**Expected behavior**
Every numeric field is bounded to the actual width of the Soroban integer type it will be encoded into, and the shared encoders themselves reject out-of-range input with a clear, mapped error rather than either crashing with a plain `Error` or silently wrapping.

**Proposed scope / implementation direction**
1. Add explicit range validation to `u32ToScVal`, `u64ToScVal`, and `i128ToScVal` in `src/blockchain/xdr/sc-val.ts` itself (throwing a descriptive `Error` naming the expected range), so every current and future caller is protected at the one shared boundary rather than requiring each Zod schema to independently get the bound right.
2. Add `.max(4_294_967_295)` to `weightGrams`.
3. Add a `.refine()` on escrow's `amount` bounding it to i128's 39-digit maximum (`170141183460469231731687303715884105727`).
4. Map the encoders' thrown error to a `400`-class `AppError` (e.g. a new `InvalidOnChainValueError extends ValidationError`) at the point the build use case catches it, rather than letting it fall through to the generic 500 handler.

**Acceptance criteria**
- [ ] `i128ToScVal`/`u64ToScVal`/`u32ToScVal` throw a descriptive error for out-of-range input; none silently produces a wrong-value encoding.
- [ ] `amount` and `weightGrams` reject out-of-range client input with `400 VALIDATION_ERROR` before reaching the encoders.
- [ ] In-range values continue to encode exactly as before.

**Verification / testing requirements**
- Unit tests in `src/blockchain/xdr/sc-val.spec.ts` for each encoder at its boundary and just past it, both above and below zero where applicable.
- API tests asserting `400` for an oversized `amount`/`weightGrams`.

---

### #103 — Regex-only Stellar address validation lets checksum-invalid addresses reach unguarded `Address` construction, crashing both build and public read endpoints with a 500

- **Labels:** `bug`, `validation`, `api`, `reliability`
- **Area / component:** `blockchain/xdr/sc-val.ts`, `modules/fleet/infrastructure/soroban-fleet-contract-client.ts`, `modules/reputation/infrastructure/soroban-reputation-contract-client.ts`

**Problem**
`stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, ...)` checks only the StrKey *shape* (length and alphabet), never the embedded CRC16 checksum. `addressToScVal` passes whatever shape-valid string it receives straight into `new Address(address)`, which throws a plain `Error` for a checksum-invalid value — verified live against the installed SDK (`new Address('GAAAAAAA...WHF')` throws `Error: Unsupported address type: ...` for a 59-character, alphabet-valid, checksum-invalid string). This is not an `AppError`, so it falls through `handleError`'s final generic branch to an unmapped `500 INTERNAL_ERROR`.

**Current behavior**
Every one of the seventeen `/transactions/build/*` endpoints that takes a Stellar address parameter is affected. So are two **public, unauthenticated `GET` endpoints** that also call `addressToScVal` on a path parameter with no auth in front of them: `GET /api/v1/fleets/:chainFleetId/payout-address/:driverAddress` (`soroban-fleet-contract-client.ts`'s `getPayoutAddress`) and `GET /api/v1/drivers/:address/reputation` (`soroban-reputation-contract-client.ts`'s equivalent read). A trivially-craftable, shape-valid, checksum-invalid address (flip one character of any real address) sent to either produces an opaque 500 with no authentication required.

**Evidence / code location**
- `src/blockchain/xdr/sc-val.ts:101-103` — `addressToScVal` calls `new Address(address).toScVal()` with no try/catch.
- `src/modules/fleet/interface/schemas.ts:31` and `src/modules/fleet/interface/routes.ts:65-80` — the unauthenticated `GET .../payout-address/:driverAddress` route.
- `src/modules/reputation/interface/schemas.ts:18` and `src/modules/reputation/interface/routes.ts:36-48` — the unauthenticated `GET /drivers/:address/reputation` route.
- `src/shared/errors/error-handler.ts:103-117` — the generic 500 fallback that catches the plain `Error`.
- Live-verified against `@stellar/stellar-sdk@12.3.0`: `new Address('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')` (59 chars, valid alphabet, invalid checksum) throws synchronously.

**Impact**
Two unauthenticated public endpoints can be crashed to a 500 with a single, trivially-constructed request and zero authentication — a low-severity but genuinely free denial-of-noise vector, and — combined with every build endpoint — a systemic pattern of client input errors being reported as server faults.

**Expected behavior**
A checksum-invalid address is rejected with `400 VALIDATION_ERROR` at the API boundary, before it ever reaches `Address` construction.

**Proposed scope / implementation direction**
1. Replace the bare regex with a `.refine()` using the SDK's own `StrKey.isValidEd25519PublicKey(value)` (already imported transitively via `@stellar/stellar-sdk`), which validates the checksum, not just the shape.
2. Apply the same treatment to the `contractAddress` validator proposed in #101, using `StrKey.isValidContract`.
3. As defense in depth, also wrap `addressToScVal`'s `new Address(...)` call in a try/catch that rethrows a mapped `AppError`, so a checksum-invalid value that somehow bypasses schema validation still fails cleanly.

**Acceptance criteria**
- [ ] A checksum-invalid, shape-valid address returns `400 VALIDATION_ERROR` from every affected route, including the two public `GET` endpoints.
- [ ] A genuinely valid address is unaffected.
- [ ] `addressToScVal` no longer relies solely on its caller having pre-validated the value.

**Verification / testing requirements**
- Unit test on the shared `stellarAddress` schema for a checksum-invalid, shape-valid input.
- API tests on the two named public `GET` routes and at least one build route.

---

### #104 — `trustProxy: true` combined with `@fastify/rate-limit`'s default IP-based key makes every rate limit trivially bypassable

- **Labels:** `security`, `backend`, `api`
- **Area / component:** `src/app.ts`, `shared/http/plugins/security.ts`

**Problem**
`buildApp()` constructs Fastify with `trustProxy: true`. Fastify's own documentation states plainly that this means the process "will know that it is sitting behind a proxy and that the `X-Forwarded-*` header fields may be trusted" — for **all** peers, not only a known, trusted reverse proxy — and explicitly warns that the derived `request.ip` "must be treated as untrusted input... without explicit validation." `@fastify/rate-limit`'s default key generator is `(req) => req.ip`.

**Current behavior**
Verified directly against the installed `@fastify/rate-limit@10.3.0` source: `const defaultKeyGenerator = (req) => req.ip`. With `trustProxy: true` and no allow-listed proxy range, any direct client — not just a real upstream proxy — can set its own `X-Forwarded-For` header, and Fastify will use that attacker-supplied value as `request.ip`. Sending a different fake `X-Forwarded-For` value on every request gives each request a fresh rate-limit bucket, defeating the limiter entirely for `/auth/login`, every `/transactions/build/*` endpoint, and the global bucket alike — with no code change needed on the attacker's side beyond a header.

**Evidence / code location**
- `src/app.ts:47` — `trustProxy: true`.
- `src/shared/http/plugins/security.ts:36-45` — `@fastify/rate-limit` registered with no `keyGenerator` override.
- `node_modules/.pnpm/@fastify+rate-limit@10.3.0/node_modules/@fastify/rate-limit/index.js:29` — `const defaultKeyGenerator = (req) => req.ip`.
- Fastify's own `Server.md` reference, `trustProxy` section: "`true`/`false`: Trust all proxies... These values... must be treated as untrusted input unless your proxy chain is explicitly trusted and validated."
- `grep -rn "request\.ip" src/` returns no results — rate limiting is the only consumer of this attacker-influenceable value, but it is a security-relevant one.

**Impact**
Every rate limit in the application — including the ones proposed for auth endpoints and RPC-backed build endpoints elsewhere in this backlog — provides no real protection against a client willing to vary one header per request. Credential stuffing, account enumeration, and RPC-cost amplification are all effectively unthrottled.

**Expected behavior**
`request.ip` reflects a trustworthy value: either the app is not deployed directly behind an untrusted network path, or `trustProxy` is scoped to the actual, specific reverse proxy address(es)/CIDR the deployment uses.

**Proposed scope / implementation direction**
1. Change `trustProxy` from `true` to a specific trusted proxy address, CIDR list, or hop count (Fastify supports `string | string[] | number | Function` for exactly this), sourced from a new `TRUSTED_PROXY_IPS` config value with a safe default (e.g., disabled/`false` unless explicitly configured).
2. Document in `docs/DEPLOYMENT.md` that any reverse proxy/load balancer in front of the API must be named here, and that leaving it unconfigured disables `X-Forwarded-*` trust rather than trusting everyone.
3. Note the fix in `docs/SECURITY.md`.

**Acceptance criteria**
- [ ] A request with a forged `X-Forwarded-For` header does not receive a fresh rate-limit bucket when the app is not configured to trust that peer.
- [ ] A request from a configured, trusted proxy still has its real client IP correctly forwarded and rate-limited.
- [ ] The behavior is documented.

**Verification / testing requirements**
- API test sending varying `X-Forwarded-For` values from an untrusted peer and asserting they share one rate-limit bucket.

---

### #105 — `docker compose up`'s `env_file: .env` silently reverts the API and worker to `NODE_ENV=development`, defeating the Dockerfile's production setting

- **Labels:** `bug`, `deployment`, `devops`, `reliability`
- **Area / component:** `docker-compose.yml`, `Dockerfile`, `.env.example`

**Problem**
The `Dockerfile`'s `api` and `worker` final stages both bake `ENV NODE_ENV=production`. `docker-compose.yml`'s `api`/`worker` services load `env_file: .env` and only override `DATABASE_URL`/`REDIS_URL` in their own `environment:` block — `NODE_ENV` is left to whatever `.env` sets. `.env.example` — the file `README.md`'s own documented quick start says to `cp` directly to `.env` — sets `NODE_ENV=development`.

**Current behavior**
Docker's environment precedence means a runtime environment variable supplied via `env_file`/`environment` overrides a Dockerfile's baked `ENV` default. Following `README.md`'s exact documented steps (`cp .env.example .env && make docker-up`) therefore boots both containers with `NODE_ENV=development`, not `production` — the opposite of what the Dockerfile was written to guarantee. This flips two behaviors: `src/shared/logger/index.ts:34-38` enables the `pino-pretty` colorized transport (breaking the structured-JSON-log premise `docs/OBSERVABILITY.md` is built on) and `src/shared/database/prisma-client.ts:14` enables Prisma's `warn`+`error` query logging instead of `error`-only.

**Evidence / code location**
- `.env.example:5` — `NODE_ENV=development`.
- `docker-compose.yml:32-46` (`api`), `:48-60` (`worker`) — `env_file: .env`, no `NODE_ENV` override in `environment:`.
- `Dockerfile:54,65` — `ENV NODE_ENV=production` in both final stages.
- `src/shared/logger/index.ts:34-38` — the `NODE_ENV === 'development'` transport gate.
- `src/shared/database/prisma-client.ts:14` — the same gate for Prisma logging.
- `README.md` § Full stack via Docker Compose — the exact two-line quick start.
- `docs/DEPLOYMENT.md` § Status — describes `docker compose up` as "verified for real" in Phase 6, without this discrepancy being caught.

**Impact**
The one deployment path this project explicitly verified as working ("Status" section) never actually ran with `NODE_ENV=production`, meaning the production-specific code paths (log format, Prisma verbosity, and any future `NODE_ENV`-gated behavior such as the mailer/notification-sender hardening proposed elsewhere in this backlog) have never been exercised by that verification.

**Expected behavior**
The Docker Compose stack runs with `NODE_ENV=production`, matching the Dockerfile's intent, unless an operator deliberately overrides it for a documented local-development reason.

**Proposed scope / implementation direction**
1. Add `NODE_ENV: production` to the `api` and `worker` services' `environment:` block in `docker-compose.yml`, alongside the existing `DATABASE_URL`/`REDIS_URL` overrides — this takes precedence over both the Dockerfile default and anything `.env` sets, matching the intent of a compose file meant to demonstrate the production image.
2. Alternatively (or additionally), change `.env.example`'s comment to clarify it is for the `pnpm dev` local flow, and provide a separate `.env.docker.example` for the compose flow with `NODE_ENV=production`.
3. Re-verify `docker compose up` end-to-end with the fix and update `docs/DEPLOYMENT.md`'s "Status" section to note it.

**Acceptance criteria**
- [ ] Following `README.md`'s documented Docker Compose quick start boots both containers with `NODE_ENV=production`.
- [ ] Logs from the compose stack are structured JSON, not pretty-printed.
- [ ] `pnpm dev`'s local (non-Docker) development experience is unaffected.

**Verification / testing requirements**
- Manual `docker compose up` followed by inspecting a log line's format and `docker exec ... printenv NODE_ENV`, recorded in the PR.

---

### #106 — `.env.example`'s placeholder JWT secrets pass boot-time validation silently, and the Docker Compose quick start never instructs replacing them

- **Labels:** `security`, `deployment`, `validation`
- **Area / component:** `.env.example`, `shared/config/env.ts`, `README.md`

**Problem**
`.env.example`'s `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` placeholder values (`replace-with-a-random-64-char-hex-string`, `replace-with-a-different-random-64-char-hex-string`) are 40 and 50 characters respectively — both comfortably above the env schema's `.min(32)` requirement. `README.md`'s "Full stack via Docker Compose" section instructs `cp .env.example .env && make docker-up` with no mention of replacing the secrets, unlike the "Local development" section immediately above it, which does say "fill in JWT secrets at minimum."

**Current behavior**
A contributor who follows only the Docker Compose section literally boots a fully working stack signing every access token, refresh token, email-verification token, password-reset token, and wallet-link challenge with a secret value that is printed, unchanged, in this public repository's own `.env.example` — identical across every clone. The boot-time fail-fast validation (`src/shared/config/env.ts`) checks only length, so it has no way to detect and reject this specific, extremely common case.

**Evidence / code location**
- `.env.example:18-19` — the two placeholder values (40 and 50 characters, both `.min(32)`-passing, confirmed by direct count).
- `src/shared/config/env.ts:19-20` — `.min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')`, length-only.
- `README.md` § Local development — "fill in JWT secrets at minimum — see .env.example for what's required."
- `README.md` § Full stack via Docker Compose — `cp .env.example .env` / `make docker-up`, with no equivalent instruction.

**Impact**
A deployment left with the placeholder secret is fully compromised: anyone who has ever read this public repository can forge a valid access token with `role: "ADMIN"` for any user id, bypassing every authentication and authorization control in the API. This is exactly the kind of "fail fast, don't guess" scenario `src/shared/config/env.ts`'s own header comment says the schema exists to prevent — the length check alone doesn't achieve that goal for this specific, realistic misconfiguration.

**Expected behavior**
Booting with the literal example secret values is rejected at startup, and the Docker Compose quick start explicitly instructs replacing them, matching the local-dev section.

**Proposed scope / implementation direction**
1. Add a `.refine()` to the `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` schema entries rejecting the two known literal placeholder strings (and, defensively, rejecting a value equal to the *other* secret, preventing a copy-paste-once mistake).
2. Add the same "fill in JWT secrets" instruction to the Docker Compose section of `README.md`, and consider having `make docker-up` shell out to a small pre-flight check (e.g., `grep` for the placeholder string in `.env` and abort with a clear message) as a second line of defense.
3. Note the hardening in `docs/SECURITY.md` § Secrets.

**Acceptance criteria**
- [ ] Booting with either placeholder value verbatim fails at startup with a clear, specific message (not just "too short").
- [ ] A genuinely random 32+ character secret still boots normally.
- [ ] `README.md`'s Docker Compose section instructs replacing the secrets.

**Verification / testing requirements**
- Unit test in the env-schema test suite (see the existing backlog's env-schema testing item) asserting the two literal placeholder strings are rejected.

---

### #107 — Helmet's default `Cross-Origin-Resource-Policy: same-origin` blocks a cross-origin frontend from embedding evidence downloads that CORS is configured to allow

- **Labels:** `security`, `bug`, `api`
- **Area / component:** `shared/http/plugins/security.ts`

**Problem**
`securityPlugin` registers `@fastify/helmet` with an explicit `contentSecurityPolicy` override but leaves every other Helmet directive at its default — including `crossOriginResourcePolicy`, whose documented and installed-version-confirmed default is `same-origin`. This header is enforced by browsers independently of CORS: it governs whether a *different* origin may load this origin's response at all via a no-CORS-mode request (`<img src>`, `<iframe>`, `<embed>`), regardless of what `Access-Control-Allow-Origin` says.

**Current behavior**
Verified directly against the installed `helmet@7.2.0` source: the `crossOriginResourcePolicy` middleware defaults to `getHeaderValueFromOptions$4({policy = "same-origin"})` whenever the option is `undefined` — exactly this app's configuration. Every response, including `GET /api/v1/disputes/evidence/:evidenceId/download`, therefore carries `Cross-Origin-Resource-Policy: same-origin`. `CORS_ORIGIN` is a configurable, presumably-different-origin frontend (per `.env.example`'s own comment structure and `docs/SECURITY.md`'s "explicit allow-listed origins" language) — a browser will refuse to render that origin's `<img src="…/download">` or similarly embed a fetched evidence file, even though CORS headers permit the cross-origin *fetch* itself.

**Evidence / code location**
- `src/shared/http/plugins/security.ts:21-29` — `helmet` registered with only `contentSecurityPolicy` overridden; no `crossOriginResourcePolicy` option set.
- `node_modules/.pnpm/helmet@7.2.0/node_modules/helmet/index.cjs:355-363` — the `switch (options.crossOriginResourcePolicy) { case undefined: case true: result.push(crossOriginResourcePolicy()) }` default-application logic, confirmed by direct inspection.
- `node_modules/.pnpm/helmet@7.2.0/node_modules/helmet/index.cjs:167-172` — `getHeaderValueFromOptions$4({policy = "same-origin"})`.
- `src/modules/disputes/interface/routes.ts:104-116` — the evidence download route this most directly affects.

**Impact**
A dispute-resolution UI on a different origin/subdomain than the API (the normal deployment shape implied by a configurable `CORS_ORIGIN`) cannot directly display evidence images/PDFs inline — the most natural way to review evidence — even though every other access control on that endpoint (auth, ownership) is satisfied. The failure is silent in the network tab in some browsers and easy to misdiagnose as a CORS misconfiguration when it is a different header entirely.

**Expected behavior**
Cross-origin embedding of evidence downloads works when the requesting origin is one this backend's own CORS configuration already trusts.

**Proposed scope / implementation direction**
1. Set `crossOriginResourcePolicy: { policy: 'cross-origin' }` on the evidence-download route specifically (Fastify supports per-route header overrides via a route-level hook), rather than weakening the global default — matching this backend's own existing pattern of relaxing specific headers locally for a specific route (`docs.ts` for Swagger UI) rather than loosening the global policy.
2. Document the decision and its scope in `docs/SECURITY.md`.

**Acceptance criteria**
- [ ] The evidence-download response carries `Cross-Origin-Resource-Policy: cross-origin` (or an equivalent value permitting the configured frontend origin).
- [ ] Every other route's `Cross-Origin-Resource-Policy: same-origin` is unchanged.
- [ ] The change is documented.

**Verification / testing requirements**
- API test asserting the header value specifically on the evidence-download route and its default value on an unrelated route.

---

### #108 — `ARCHITECTURE.md` §9's "Idempotency-Key header support on all `/transactions/build/*` … endpoints" is entirely unimplemented

- **Labels:** `documentation`, `api`, `reliability`
- **Area / component:** `ARCHITECTURE.md`, all `modules/*/interface/routes.ts`

**Problem**
`ARCHITECTURE.md` § API Design Principles states as a design principle: "Idempotency-Key header support on all `/transactions/build/*` and `/transactions/submit` endpoints, given retries are expected around blockchain submission." No route, schema, or middleware anywhere in the codebase reads, validates, or acts on an `Idempotency-Key` header.

**Current behavior**
`grep -rin "idempotency" src/` matches nothing except one unrelated line in `docs/EVENT_INDEXER.md` about the *indexer's* event-ingestion idempotency (a different concept — deduplicating already-observed chain events, not deduplicating client build requests). Every one of the seventeen `/transactions/build/*` endpoints builds a fresh transaction (a live `getAccount` call plus a full `prepareTransaction` simulation) on every request with no request-level deduplication of any kind. A client retry after a timeout — the exact scenario this principle exists to address — simply produces a second, independent build.

**Evidence / code location**
- `ARCHITECTURE.md` § 9 — the exact claim.
- Confirmed absent from `docs/API_REFERENCE.md`, which does not repeat this claim anywhere in its per-endpoint documentation.
- `src/blockchain/xdr/build-invoke-transaction.ts:27-45` — no idempotency-key parameter or header of any kind in the shared build path every module's contract client goes through.
- `CONTRIBUTING.md` § Before You Start — lists `ARCHITECTURE.md` as required reading for contributors, so this is a documented contract, not an internal design note.

**Impact**
A documented design principle — one specifically motivated by "retries are expected around blockchain submission," a real operational concern for this domain — does not exist in the implementation. A contributor reading `ARCHITECTURE.md` reasonably believes retry-safety is handled; it is not, beyond each individual build call's own idempotent nature (which the doc's stated mechanism is not describing).

**Expected behavior**
Either the header is implemented for the named endpoints, or `ARCHITECTURE.md` is corrected to describe the actual, current retry story (each build call is a pure function of its inputs plus live chain state, not a stateful operation requiring deduplication).

**Proposed scope / implementation direction**
1. If implementing: add an optional `Idempotency-Key` header to the `/transactions/build/*` schemas, and a short-TTL Redis-backed cache (keyed on `(userId, idempotencyKey)`) in a shared middleware that returns the previously-built response for a repeated key within the TTL, rather than rebuilding.
2. If documenting reality instead: remove the claim from `ARCHITECTURE.md` §9, replacing it with an accurate statement (e.g., "build endpoints are safe to retry because they are read-mostly and side-effect-free; the actual idempotency boundary that matters is on-chain, at submission").
3. Either way, keep `docs/API_REFERENCE.md` and `ARCHITECTURE.md` in agreement.

**Acceptance criteria**
- [ ] `ARCHITECTURE.md` accurately describes whatever retry-safety mechanism actually exists.
- [ ] If implemented, a repeated `Idempotency-Key` within the TTL returns the identical XDR envelope without a second `getAccount`/`prepareTransaction` round trip.

**Verification / testing requirements**
- If implemented: API test issuing the same build request twice with the same key and asserting one live RPC call.
- If documented instead: no code change; PR review confirms the doc no longer makes the false claim.

---

### #109 — `ROADMAP.md`'s module-status table claims `deliveries` has XDR builders for "all six" `delivery_contract` calls; only five are exposed, by the module's own design

- **Labels:** `documentation`
- **Area / component:** `ROADMAP.md`, `modules/deliveries/domain/ports.ts`

**Problem**
`ROADMAP.md`'s Phase 5 module-status table describes `deliveries` as having "unsigned-XDR builders for all six `delivery_contract` calls." `delivery_contract` has exactly six mutating functions per `PHASE_1_DOMAIN_ANALYSIS.md` (`create_delivery`, `assign_driver`, `mark_in_transit`, `confirm_delivery`, `cancel_delivery`, `raise_dispute`). The `deliveries` module exposes builders for only five of them — `raise_dispute` is deliberately, and correctly, excluded, per the module's own domain-layer documentation.

**Current behavior**
`src/modules/deliveries/interface/routes.ts` registers exactly five `/transactions/build/*` routes (`create-delivery`, `assign-driver`, `mark-in-transit`, `confirm-delivery`, `cancel-delivery`). `src/modules/deliveries/domain/ports.ts`'s own header comment explains, correctly, why `raise_dispute` is intentionally not here: it would let a client bypass `dispute_resolution_contract` and land in the Layer A/B reconciliation gap the `disputes` module exists to own. `docs/API_REFERENCE.md`'s own deliveries section correctly lists only five build endpoints. Only `ROADMAP.md`'s summary table has the wrong count.

**Evidence / code location**
- `ROADMAP.md` (Phase 5 module status table, `deliveries` row) — "unsigned-XDR builders for all six `delivery_contract` calls."
- `src/modules/deliveries/interface/routes.ts:80-153` — five `app.post('/transactions/build/...')` calls.
- `src/modules/deliveries/domain/ports.ts:77-88` — the explicit rationale for excluding `raise_dispute`.
- `PHASE_1_DOMAIN_ANALYSIS.md:76-98` — confirms six total `delivery_contract` mutating functions.
- `docs/API_REFERENCE.md` lines 42-46 — correctly lists five.

**Impact**
A stale, incorrect summary claim in the project's primary planning document, self-contradicted by the correct documentation two files away (`domain/ports.ts`'s own comment, and `docs/API_REFERENCE.md`). Low-severity but a genuine drift a new contributor could reasonably rely on.

**Expected behavior**
`ROADMAP.md` states five, with the same one-line rationale already present in `domain/ports.ts`.

**Proposed scope / implementation direction**
1. Correct the `deliveries` row in `ROADMAP.md`'s module-status table to "five of `delivery_contract`'s six calls (`raise_dispute` intentionally routed through `disputes` instead — see that module's own row)."

**Acceptance criteria**
- [ ] `ROADMAP.md` states the correct count and the reason for the sixth's exclusion.
- [ ] No other document repeats the incorrect "all six" claim for this module.

**Verification / testing requirements**
- Documentation-only change; reviewed against `docs/API_REFERENCE.md`'s already-correct count for consistency.

---

### #110 — `ROADMAP.md` §2 and `ARCHITECTURE.md` §4 claim the indexer covers "all six" FaniLab contracts; its own correct, documented scope is five

- **Labels:** `documentation`
- **Area / component:** `ROADMAP.md`, `ARCHITECTURE.md`, `docs/EVENT_INDEXER.md`

**Problem**
`ROADMAP.md` § 2 (Objectives) states: "Index every event emitted by all six FaniLab contracts." `ARCHITECTURE.md` § 4's module table lists the `indexer` module's backing contracts as "all six contracts." Both contradict `ROADMAP.md`'s own, later, correctly-detailed Phase 5 module-status table for `indexer` ("all **five** contracts with a consuming module... `settlement_contract` permanently excluded"), and `docs/EVENT_INDEXER.md`'s "Current Scope" section, which states the same five-contract scope explicitly and explains the sixth's permanent exclusion.

**Current behavior**
`getTrackedContracts()` (`src/modules/indexer/index.ts:26-35`) lists exactly five entries: `escrow`, `delivery`, `fleet`, `dispute-resolution`, `identity-reputation`. `settlement_contract` is not tracked and, per `docs/EVENT_INDEXER.md` § Current Scope, never will be — "not a gap waiting to be filled." The "all six" phrasing in the two earlier-written documents was never updated when this deliberate scope decision was made.

**Evidence / code location**
- `ROADMAP.md` § 2, objective 2 — "Index every event emitted by all six FaniLab contracts."
- `ARCHITECTURE.md` line 129 — `indexer | ... | all six contracts | See §6`.
- `ROADMAP.md` (Phase 5 module status table, `indexer` row) — "full scope, all **five** contracts with a consuming module... `settlement_contract` permanently excluded."
- `docs/EVENT_INDEXER.md` § Current Scope — the same five-contract scope and rationale, stated authoritatively.
- `src/modules/indexer/index.ts:26-35` — the actual five-entry `getTrackedContracts()`.

**Impact**
Two separate documents' headline objectives/module tables overstate the indexer's scope, directly contradicted by the more detailed, correct account two sections later in one of the very same documents. A reader who only skims the objectives or the architecture table (rather than the detailed module-status table) forms an incorrect picture of what the indexer does.

**Expected behavior**
Both statements say five, consistent with the rest of the documentation set and the actual code.

**Proposed scope / implementation direction**
1. Correct `ROADMAP.md` § 2 objective 2 to "five of the six FaniLab contracts (every contract with a consuming module; `settlement_contract` is a permanently-excluded unimplemented stub — see `PHASE_1_DOMAIN_ANALYSIS.md` §8)."
2. Correct `ARCHITECTURE.md` line 129's module table entry the same way.

**Acceptance criteria**
- [ ] Both documents state five contracts with the exclusion rationale.
- [ ] No remaining "all six" claim exists for the indexer's scope anywhere in the documentation set.

**Verification / testing requirements**
- Documentation-only change; cross-checked against `docs/EVENT_INDEXER.md` § Current Scope and `src/modules/indexer/index.ts` for consistency.

---

### #111 — `.github/workflows/ci.yml` declares no least-privilege `permissions:` block

- **Labels:** `ci`, `security`, `devops`
- **Area / component:** `.github/workflows/ci.yml`

**Problem**
None of `ci.yml`'s three jobs (`lint-and-typecheck`, `build`, `test`) declares a `permissions:` block, at either the workflow or job level. `release.yml`, by contrast, explicitly scopes its `GITHUB_TOKEN` to `permissions: contents: write` — showing the project already knows and applies this pattern elsewhere.

**Current behavior**
`grep -c "permissions" .github/workflows/ci.yml` returns `0`. Every job in `ci.yml` therefore runs with whatever the repository/organization's default `GITHUB_TOKEN` permission setting is, rather than an explicit, minimal, version-controlled grant. None of the three jobs writes to the repository, comments on PRs, or otherwise needs anything beyond reading the checked-out code.

**Evidence / code location**
- `.github/workflows/ci.yml:19-86` — three jobs, no `permissions:` key anywhere in the file.
- `.github/workflows/release.yml:11-12` — `permissions: contents: write`, the pattern this repo already uses correctly for a job that actually needs a write scope.

**Impact**
A future change to this workflow (e.g., adding a step that happens to write something, or a supply-chain-compromised action reachable via a future dependency bump) inherits whatever the ambient default grants, rather than being constrained by an explicit ceiling — the standard rationale for GitHub's own least-privilege recommendation and a common automated-scanner finding (e.g., OpenSSF Scorecard) for public repositories.

**Expected behavior**
`ci.yml` declares an explicit, minimal `permissions:` block (`contents: read` is sufficient for all three jobs today).

**Proposed scope / implementation direction**
1. Add `permissions: { contents: read }` at the top level of `ci.yml`, applying to all three jobs.
2. Re-run CI on a PR to confirm no job needs a broader grant (none currently writes anything).

**Acceptance criteria**
- [ ] `ci.yml` declares an explicit `permissions:` block.
- [ ] All three jobs continue to pass unmodified otherwise.

**Verification / testing requirements**
- Trigger the workflow on a PR and confirm all three jobs still succeed with the added restriction.

---

### #112 — The current dependency lockfile contains real, verifiable vulnerabilities, including a critical one in a directly-invoked dev tool

- **Labels:** `dependencies`, `security`, `testing`
- **Area / component:** `pnpm-lock.yaml`, `package.json`

**Problem**
Running `pnpm audit` against the committed lockfile at this commit reports multiple current advisories, including several critical- and high-severity ones, none of which any existing CI check or documented process currently catches or remediates.

**Current behavior**
`pnpm audit --audit-level=low` (run live against this repository's lockfile) reports, among others: a **critical** advisory for `vitest` (`GHSA-5xrq-8626-4rwp`, "arbitrary file read/execute when the Vitest UI server is listening," fixed in `>=3.2.6`; this project pins `vitest: ^2.1.4`, which resolves below the patched line) reachable directly from `pnpm test:watch`/local development if a contributor ever runs `vitest --ui`; a **critical** advisory for `tar` (`GHSA-23hp-3jrh-7fpw`, "decompression/parse DoS via unlimited input") reached transitively via `bcrypt > @mapbox/node-pre-gyp > tar`, plus several further **high**-severity `tar` advisories (path traversal / symlink issues) in the same chain; and a **critical**/multiple **high** advisories for `handlebars` (`GHSA-2w6w-674q-4c4q` and others, "JavaScript Injection via AST Type Confusion") reached transitively via `eslint-plugin-boundaries > @boundaries/elements > handlebars`.

**Evidence / code location**
- Live `pnpm audit --audit-level=low` output against this repository's `pnpm-lock.yaml`, captured in this session.
- `package.json` — `"vitest": "^2.1.4"`, `"@vitest/coverage-v8": "^2.1.4"`, `"bcrypt": "^5.1.1"`, `"eslint-plugin-boundaries": "^5.0.1"`.
- `package.json`'s existing `pnpm.onlyBuiltDependencies` field shows the project already uses `pnpm`'s override/allowlist mechanisms for exactly this class of transitive-dependency problem, so the tooling to fix this is already in active use here.

**Impact**
The `vitest` finding is directly reachable by any contributor who runs `vitest --ui` (a documented, normal Vitest workflow, even though not currently one of this project's own npm scripts) on an untrusted network. The `tar`/`handlebars` findings are lower-likelihood (both are build/lint-time-only transitive dependencies with no attacker-controlled input in this project's own usage) but are nonetheless real, currently-unaddressed, and — per the existing backlog's separate proposal to add a `pnpm audit` CI gate — would fail such a gate the moment it is added, so they are worth fixing in the same effort rather than immediately breaking a newly-added check.

**Expected behavior**
The lockfile contains no unaddressed advisory at or above a documented severity threshold, or each exception is explicitly recorded with a reason.

**Proposed scope / implementation direction**
1. Upgrade `vitest`/`@vitest/coverage-v8` to `^3.2.6` or later (a real major-version bump; check the Vitest 3 migration notes for any config changes `vitest.config.ts` needs).
2. Add `pnpm.overrides` (or `pnpm-workspace.yaml`'s modern equivalent) pinning `tar` to a patched version wherever it is pulled in transitively via `bcrypt`'s native-build toolchain.
3. Where a transitive advisory has no available override (e.g., if `eslint-plugin-boundaries` has not released a `handlebars`-patched version), document the accepted exception with its advisory id and rationale, ready for the `pnpm audit` CI gate this backlog separately proposes to consume.
4. Re-run `pnpm audit` after each change and record the resulting clean/exception state.

**Acceptance criteria**
- [ ] `pnpm audit --audit-level=high` (or the project's chosen threshold) reports zero un-exempted findings.
- [ ] `pnpm test`/`pnpm build` still pass after the `vitest` upgrade.
- [ ] Any accepted exception is documented with its advisory id.

**Verification / testing requirements**
- Re-run `pnpm audit` and paste the before/after output in the PR.
- Full `pnpm test`/`pnpm build`/`pnpm lint` pass after the upgrade.

---

### #113 — Password schema bounds bcrypt truncation by JS character count, not the byte count bcrypt actually truncates at

- **Labels:** `security`, `validation`, `authentication`
- **Area / component:** `modules/auth/interface/schemas.ts`, `modules/auth/infrastructure/bcrypt-password-hasher.ts`

**Problem**
`password = z.string().min(8).max(72)` — the `.max(72)` bound is justified by the inline comment "bcrypt silently truncates beyond 72 bytes," but Zod's `.max()` on a string counts UTF-16 code units (JS string length), not UTF-8 bytes. bcrypt's own truncation boundary is bytes.

**Current behavior**
The installed `bcrypt@5.1.1` package's own README states this precisely: "Per bcrypt implementation, only the first 72 bytes of a string are used... Note that this is not the first 72 *characters*. It is possible for a string to contain less than 72 characters, while taking up more than 72 bytes (e.g. a UTF-8 encoded string containing emojis)." A password using multi-byte UTF-8 characters (emoji, many non-Latin scripts) can be well under the schema's 72-*character* limit while exceeding 72 *bytes*, so bcrypt silently truncates it earlier than the schema's own stated rationale assumes — the exact failure mode the code comment shows awareness of, applied with the wrong unit.

**Evidence / code location**
- `src/modules/auth/interface/schemas.ts:4` — `const password = z.string().min(8).max(72); // bcrypt silently truncates beyond 72 bytes`.
- `src/modules/auth/infrastructure/bcrypt-password-hasher.ts:4-14` — `bcrypt.hash(plain, SALT_ROUNDS)`, no byte-length pre-check.
- `node_modules/.pnpm/bcrypt@5.1.1/node_modules/bcrypt/README.md:41` — the exact character-vs-byte distinction, quoted directly from the installed package's own documentation.

**Impact**
Two distinct passwords that differ only after their first 72 UTF-8 bytes (a realistic scenario for any password containing emoji or many non-Latin-alphabet characters, both increasingly common in real-world passwords) hash identically — a genuine, if narrow, weakening of password uniqueness for exactly the users least likely to notice, and a violation of the "what you typed is what's checked" expectation the max-length UI hint implies.

**Expected behavior**
The maximum password length is enforced in bytes, matching what bcrypt actually truncates at.

**Proposed scope / implementation direction**
1. Replace `.max(72)` with a `.refine()` computing `Buffer.byteLength(value, 'utf8') <= 72`.
2. Apply the same fix to `resetPasswordBodySchema.newPassword`, which reuses the same `password` constant.
3. Update the inline comment to state the check is now byte-accurate.

**Acceptance criteria**
- [ ] A password with fewer than 72 JS characters but more than 72 UTF-8 bytes is rejected with a clear validation message, not silently truncated.
- [ ] A password at exactly 72 bytes of pure-ASCII content is still accepted.
- [ ] Registration, login, and password-reset all use the corrected schema.

**Verification / testing requirements**
- Unit test on the `password` schema with a string containing emoji that is under 72 JS characters but over 72 UTF-8 bytes.

---

### #114 — `stellarAddress`, `chainDeliveryId`, and `transactionResponseSchema` are copy-pasted verbatim across up to seven `interface/schemas.ts` files

- **Labels:** `refactor`, `technical-debt`, `backend`, `api`
- **Area / component:** `modules/*/interface/schemas.ts`

**Problem**
Three small Zod fragments are independently redefined, character-for-character identically, in multiple modules' `interface/schemas.ts` files instead of living in one shared location.

**Current behavior**
`const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, 'Not a valid Stellar public key');` appears verbatim in `deliveries`, `disputes`, `escrow`, `fleet`, `fraud-detection`, `reputation`, and `users` — seven files. `const chainDeliveryId = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');` appears verbatim in `deliveries`, `disputes`, and `escrow` — three files. `export const transactionResponseSchema = z.object({ data: z.object({ xdr: z.string() }) });` appears verbatim in `deliveries`, `disputes`, `escrow`, `fleet`, and `reputation` — five files.

**Evidence / code location**
- `src/modules/{deliveries,disputes,escrow,fleet,fraud-detection,reputation,users}/interface/schemas.ts:4` — the seven identical `stellarAddress` definitions.
- `src/modules/{deliveries,disputes,escrow}/interface/schemas.ts:5` — the three identical `chainDeliveryId` definitions.
- `src/modules/{deliveries,disputes,escrow,fleet,reputation}/interface/schemas.ts` — the five identical `transactionResponseSchema` definitions.
- `eslint.config.js:64` — `{ from: 'interface', allow: ['application', 'domain', 'shared'] }` — the boundary rules already permit `interface` to import from `shared`, so a shared home is architecturally available today, not blocked by the lint rule this project enforces.

**Impact**
This is also the root cause enabling #101 and #103 above to exist unnoticed in one module while the identical constant in six other modules is unaffected (or, for #101, would need the identical fix applied independently at the one file where it's actually wrong) — a single shared definition would make the fix, and any future correction, apply everywhere at once rather than requiring a coordinated multi-file change.

**Expected behavior**
Each fragment is defined once, in a shared validation module, and every `interface/schemas.ts` imports it.

**Proposed scope / implementation direction**
1. Add `src/shared/http/validation.ts` (or similar) exporting `stellarAddress`, `chainId` (the digit-string pattern, generically named since it also backs `chainFleetId`), and `transactionResponseSchema`.
2. Replace all fifteen local definitions with imports.
3. Keep module-specific fragments (`evidenceHash`, `amount`, `senderShareBps`, etc.) exactly where they are — this is scoped only to the fragments proven identical above, not a general schema-consolidation effort.

**Acceptance criteria**
- [ ] No `interface/schemas.ts` file defines its own local copy of any of the three named fragments.
- [ ] All existing schema-dependent tests pass unchanged.
- [ ] The shared module is importable from `interface/` per the existing boundary rules.

**Verification / testing requirements**
- Existing per-module schema/route tests pass unchanged after the refactor — this is a pure extraction with no behavior change.

---

### #115 — `docs/SECURITY.md`'s vulnerability-disclosure process provides no direct, self-contained contact channel

- **Labels:** `documentation`, `security`
- **Area / component:** `docs/SECURITY.md`, `CODE_OF_CONDUCT.md`

**Problem**
The entirety of this repository's security disclosure instructions is: "email the maintainers (see the FaniLab organization contact in the smart contract repository's `SECURITY.md`)." No email address, GitHub Security Advisory link, or other reachable channel exists anywhere in *this* repository — a reporter must locate, trust, and read a *different* repository's file to find out how to report a vulnerability in *this* one. `CODE_OF_CONDUCT.md`'s own Enforcement section compounds this by directing code-of-conduct reports to "the contact listed in the project's `SECURITY.md`" — the same file, with the same gap.

**Current behavior**
`grep -n "email\|contact" docs/SECURITY.md` matches only the one sentence quoted above. GitHub's repository-level "Security" tab / private vulnerability reporting feature is not referenced. A security researcher who finds this repository directly (e.g., via a code search or a scanner) has no in-repository way to know who to contact or how, without independently discovering and trusting `FaniLab-SmartContract` (a sibling repository this document does not link to).

**Evidence / code location**
- `docs/SECURITY.md:5` — the full text of the disclosure instructions.
- `CODE_OF_CONDUCT.md` § Enforcement — "reported to the maintainers via the contact listed in the project's `SECURITY.md`," which itself has no contact.
- `gh api repos/fanilabs/backend` (queried live in this session) — `security_and_analysis.secret_scanning.status: "disabled"` and no evidence of GitHub's native private-vulnerability-reporting having been enabled, meaning the platform-native alternative to an email address isn't in use either.

**Impact**
The single most important document in a security policy — how to actually reach the maintainers — is not self-contained in the repository it governs, for either security reports or code-of-conduct reports.

**Expected behavior**
`docs/SECURITY.md` states a real, direct, reachable contact method (an email address, a link to enabled GitHub private vulnerability reporting, or both), and `CODE_OF_CONDUCT.md`'s reference resolves to it.

**Proposed scope / implementation direction**
1. Add a concrete contact method to `docs/SECURITY.md` — at minimum a maintainer-monitored email address, or enable and link GitHub's private vulnerability reporting for this repository.
2. Leave the cross-reference to the smart-contract repository as supplementary context if useful, but not as the sole mechanism.
3. No change needed to `CODE_OF_CONDUCT.md` itself once `docs/SECURITY.md` has a real contact — its reference will then resolve correctly.

**Acceptance criteria**
- [ ] `docs/SECURITY.md` contains at least one directly usable contact method requiring no other repository to be located first.
- [ ] `CODE_OF_CONDUCT.md`'s Enforcement section resolves to a real contact via that file.

**Verification / testing requirements**
- Documentation review confirming the contact method is live/monitored before merging.

---

### #116 — GitHub's native secret scanning and Dependabot security updates are both disabled for this public repository

- **Labels:** `devops`, `security`
- **Area / component:** repository settings (GitHub)

**Problem**
Two free, GitHub-native, zero-maintenance security features for public repositories are both off, verified via a direct query of the repository's own settings API.

**Current behavior**
`gh api repos/fanilabs/backend --jq '.security_and_analysis'` (run live in this session) reports `"secret_scanning": { "status": "disabled" }` and `"dependabot_security_updates": { "status": "disabled" }`. Secret scanning would catch a contributor accidentally committing a real credential (e.g., a genuine `.env` file, a real JWT secret, a database connection string with embedded credentials — the exact class of value `.env.example` deliberately keeps as placeholders). Dependabot security updates is a distinct feature from the already-configured weekly version-update schedule in `.github/dependabot.yml` — it opens targeted PRs specifically for security advisories (including some transitive ones regular version updates might not surface), which would have given automatic visibility into at least some of the findings in this backlog's separate `pnpm audit` item.

**Evidence / code location**
- `gh api repos/fanilabs/backend --jq '.security_and_analysis'` — live output captured in this session, both features confirmed `"disabled"`.
- `.github/dependabot.yml` — the existing, separate, already-working weekly *version-update* schedule (evidenced by PRs #1–#8), distinct from the security-update feature.

**Impact**
Two low-cost, high-value, zero-false-negative-risk safety nets are both off with no documented reason, on a repository that handles JWT secrets, database credentials, and financial transaction construction.

**Expected behavior**
Both features are enabled.

**Proposed scope / implementation direction**
1. A repository maintainer enables secret scanning and Dependabot security updates via the repository's Settings → Code security page (or the equivalent `gh api` `PATCH` call, which requires admin access this task does not have).
2. Note in `docs/SECURITY.md` that both are enabled, alongside the existing Dependency Management section's description of the version-update schedule.

**Acceptance criteria**
- [ ] `gh api repos/fanilabs/backend --jq '.security_and_analysis'` reports both features `"enabled"`.
- [ ] `docs/SECURITY.md` documents both.

**Verification / testing requirements**
- Re-query the same API endpoint after the settings change to confirm.

---

### #117 — `src/shared/events/index.ts` (the in-process blockchain-event bus every module depends on) has no dedicated test

- **Labels:** `testing`, `reliability`, `backend`
- **Area / component:** `shared/events/index.ts`

**Problem**
`publishBlockchainEvent`/`onBlockchainEvent` — the single, shared `EventEmitter`-backed mechanism every one of the seven event-consuming modules subscribes to — has no `index.spec.ts`.

**Current behavior**
`find src/shared/events -name "*.spec.ts"` returns nothing. Coverage of this file is entirely incidental, coming from each module's own `sync-*-from-event.spec.ts`, which tests the *handler function* directly (calling it with a constructed event) rather than going through the actual bus. Nothing exercises the bus's own real behavior: that `onBlockchainEvent`'s returned unsubscribe function actually detaches the listener, that multiple subscribers on the same event all receive it, that one listener throwing does not prevent the `MaxListenersExceededWarning` threshold (`bus.setMaxListeners(50)`) from being meaningful, or that publishing with zero subscribers is a genuine no-op rather than an error.

**Evidence / code location**
- `src/shared/events/index.ts` — 41 lines, no sibling `.spec.ts`.
- `src/shared/events/index.ts:29` — `bus.setMaxListeners(50)`, a specific numeric choice with no test asserting it's sufficient or exercising the unsubscribe path that keeps it from being exceeded.
- Every `src/modules/*/infrastructure/event-subscription.ts` and its accompanying `sync-*-from-event.spec.ts` — all indirect, handler-level coverage only.

**Impact**
The one piece of shared infrastructure every module's real-time correctness depends on is unverified at its own boundary. A regression in the bus itself (e.g., an accidental synchronous-throw-propagation change, or a broken unsubscribe) would not be caught by any existing test, since all of them test handlers directly rather than through the bus.

**Expected behavior**
A dedicated test file covers the bus's own contract: publish/subscribe fan-out, unsubscribe behavior, and no-subscriber safety.

**Proposed scope / implementation direction**
1. Add `src/shared/events/index.spec.ts` covering: a published event reaches all current subscribers; calling the returned unsubscribe function stops further delivery to that listener without affecting others; publishing with zero subscribers does not throw; multiple `publishBlockchainEvent` calls in sequence are each delivered independently (not batched/coalesced).

**Acceptance criteria**
- [ ] The bus's publish/subscribe/unsubscribe contract has direct test coverage, independent of any specific module's handler.

**Verification / testing requirements**
- The new test file itself is the deliverable; confirm it fails if `onBlockchainEvent`'s unsubscribe function is broken.

---

### #118 — `src/shared/http/plugins/metrics.ts` (the HTTP request-metrics hook) has no dedicated test

- **Labels:** `testing`, `observability`, `backend`
- **Area / component:** `shared/http/plugins/metrics.ts`

**Problem**
The `onResponse` hook that records `http_requests_total`/`http_request_duration_seconds` — including the specific, documented behavior of labeling by route *pattern* rather than raw URL — has no `.spec.ts`.

**Current behavior**
`find src/shared/http/plugins -name "*.spec.ts"` returns nothing. The only coverage is incidental: a full HTTP integration test happening to make a request and the metrics plugin happening to run as a side effect, with nothing asserting the resulting metric values or labels. In particular, the file's own header comment states the important, easy-to-regress property that a parameterized route like `/api/v1/deliveries/:chainDeliveryId` is labeled by its *pattern*, not the literal requested URL (to avoid label-cardinality blowup) — and a 404 (`routeOptions.url` undefined) is labeled `unmatched` rather than dropped. Neither branch has a direct test.

**Evidence / code location**
- `src/shared/http/plugins/metrics.ts` — 25 lines, no sibling `.spec.ts`.
- `src/shared/http/plugins/metrics.ts:11-12,16` — the route-pattern-vs-raw-URL rationale and the `route ?? 'unmatched'` fallback, both undocumented by any test.

**Impact**
A regression that accidentally labels metrics by raw URL instead of pattern would silently reintroduce the exact cardinality problem the code comment says the design avoids, with no test to catch it — it would only surface much later as a real production metrics-storage cost problem.

**Expected behavior**
A dedicated test asserts both the pattern-labeling behavior and the `unmatched` fallback.

**Proposed scope / implementation direction**
1. Add `src/shared/http/plugins/metrics.spec.ts` building a minimal Fastify instance with the plugin registered and one parameterized route, then asserting (via the plugin's own registry or an injected fake) that a request to a concrete URL is recorded under the route's pattern, and that a request to an unregistered path is recorded as `unmatched`.

**Acceptance criteria**
- [ ] A test directly verifies route-pattern labeling for a parameterized route.
- [ ] A test directly verifies the `unmatched` fallback for a 404.

**Verification / testing requirements**
- The new test file itself is the deliverable.

---

### #119 — `src/shared/jwt/index.ts` (the shared session-token signing/verification module) has no dedicated test

- **Labels:** `testing`, `authentication`, `security`
- **Area / component:** `shared/jwt/index.ts`

**Problem**
`signAccessToken`/`verifyAccessToken`/`signRefreshToken`/`verifyRefreshToken` — the single source of truth for session-token handling, used both by `auth`'s token issuance and by the shared HTTP auth guard on every protected route — has no `.spec.ts` of its own.

**Current behavior**
`find src/shared/jwt -name "*.spec.ts"` returns nothing. Coverage is entirely incidental, via `src/modules/auth/infrastructure/jwt-token-service.spec.ts`, which tests `auth`'s own single-purpose tokens (verification, reset) directly but only exercises `signAccessToken`/`verifyAccessToken` as a byproduct of testing `login`-adjacent behavior, and never exercises `signRefreshToken`/`verifyRefreshToken` at all outside of the auth module's own refresh-flow tests. Nothing directly tests this module's own boundary conditions: an access token verified with the wrong secret, an expired access token, a well-formed refresh token presented where an access token is expected (or vice versa), or a token with a tampered payload.

**Evidence / code location**
- `src/shared/jwt/index.ts` — 47 lines, no sibling `.spec.ts`.
- `src/modules/auth/infrastructure/jwt-token-service.spec.ts` — the only indirect coverage, scoped to `auth`'s own concerns.
- `src/shared/http/plugins/auth-guard.ts:27` — `verifyAccessToken(token)` is the one call every protected route's authorization depends on.

**Impact**
The shared function every protected route trusts is verified only as a side effect of a different module's tests, with no coverage of its own failure modes (wrong secret, expired, malformed, or access/refresh confusion) at the point where those failure modes actually matter.

**Expected behavior**
A dedicated test file exercises `shared/jwt`'s own four functions directly, independent of `auth`'s higher-level flows.

**Proposed scope / implementation direction**
1. Add `src/shared/jwt/index.spec.ts` covering: a token signed and verified round-trips with the correct claims; verification with the wrong secret throws; an expired token throws; an access token verified as if it were a refresh token (and vice versa) either throws or is caught by whatever fix is applied for the access/refresh-purpose-confusion issue elsewhere in this backlog.

**Acceptance criteria**
- [ ] All four functions have direct, dedicated test coverage independent of `auth`'s own test suite.

**Verification / testing requirements**
- The new test file itself is the deliverable.

---

### #120 — `package.json`'s `pnpm.onlyBuiltDependencies` and `pnpm-workspace.yaml`'s `allowBuilds` duplicate the same allowlist, and the former is removed entirely in pnpm v11+

- **Labels:** `dependencies`, `technical-debt`, `devops`
- **Area / component:** `package.json`, `pnpm-workspace.yaml`

**Problem**
The exact same six-package native-build-script allowlist is declared twice, in two different, non-overlapping pnpm configuration mechanisms — one of which pnpm has already announced is being replaced.

**Current behavior**
`package.json`'s `pnpm.onlyBuiltDependencies` and `pnpm-workspace.yaml`'s `allowBuilds` both list exactly `@prisma/client`, `@prisma/engines`, `bcrypt`, `esbuild`, `msgpackr-extract`, `prisma`. Verified against pnpm's own settings documentation: `allowBuilds` was added in pnpm `v10.26.0` (this project pins `pnpm@10.33.0`, so both mechanisms are currently live simultaneously) specifically as the *replacement* for `onlyBuiltDependencies`, `onlyBuiltDependenciesFile`, `neverBuiltDependencies`, `ignoredBuiltDependencies`, and `ignoreDepScripts` — all five of which are documented as **removed entirely** starting in pnpm v11. `docs/DEPLOYMENT.md` § Status records that `package.json`'s field is "the durable, version-controlled fix" for a real, previously-shipped bug (bcrypt/Prisma native build scripts silently skipped under a clean install) — meaning this exact mechanism is load-bearing, not incidental.

**Evidence / code location**
- `package.json` `pnpm.onlyBuiltDependencies` — the six-package list.
- `pnpm-workspace.yaml` `allowBuilds` — the identical six-package list.
- `package.json` — `"packageManager": "pnpm@10.33.0"`.
- pnpm's own settings documentation (`pnpm.io/settings/build`, confirmed via direct fetch in this session): `allowBuilds` "Added in: v10.26.0"; `onlyBuiltDependencies` and its four siblings "removed in v11 and replaced by `allowBuilds`."
- `docs/DEPLOYMENT.md` § Status, item 3 — the specific historical bug this exact allowlist was the fix for.

**Impact**
No live bug today — both mechanisms are currently valid under pnpm 10.x and express the identical policy. The risk is forward-looking and concrete: `package.json`'s `packageManager` field is a version string a Dependabot-style bump (the project already actively bumps toolchain pins, per its Docker base-image PR history) could move past v11 without anyone realizing that `onlyBuiltDependencies` silently stops doing anything at that point — and if `pnpm-workspace.yaml`'s copy were ever the one dropped instead (since two copies invite exactly this kind of "which one is the real one" confusion), the exact Phase 6 regression `docs/DEPLOYMENT.md` documents fixing could return with no warning.

**Expected behavior**
The allowlist is declared once, in the modern mechanism, with the deprecated one removed and the migration noted where the original fix is documented.

**Proposed scope / implementation direction**
1. Remove `pnpm.onlyBuiltDependencies` from `package.json`, keeping only `pnpm-workspace.yaml`'s `allowBuilds`.
2. Run a clean `pnpm install` (ideally in a container matching the Dockerfile's base image) to confirm the six packages still build correctly with only `allowBuilds` present.
3. Add a one-line note to `docs/DEPLOYMENT.md` § Status, item 3, cross-referencing that the allowlist now lives solely in `pnpm-workspace.yaml` and why.

**Acceptance criteria**
- [ ] The allowlist exists in exactly one file.
- [ ] A clean install (`rm -rf node_modules && pnpm install`) still builds `bcrypt` and generates the Prisma client successfully.
- [ ] `docs/DEPLOYMENT.md` reflects the current, single source of truth.

**Verification / testing requirements**
- Clean-install verification, recorded in the PR (matching the "only a real run catches this" lesson `docs/DEPLOYMENT.md` already documents for this exact area).

---

### #121 — Concurrent wallet-link confirmations for a new user can both become `isPrimary`, since the check-then-create has no database-level guard

- **Labels:** `bug`, `database`, `reliability`, `backend`
- **Area / component:** `modules/users/application/confirm-wallet-link.ts`, `prisma/schema.prisma`

**Problem**
`confirmWalletLink` decides whether a newly-linked wallet should become the user's primary by checking `currentWallets.length === 0` and then calling `create`. Nothing in the schema prevents two concurrent calls for the same user from both observing zero existing wallets and both creating a row with `isPrimary: true`.

**Current behavior**
```
const currentWallets = await deps.walletAddressRepository.findByUserId(input.userId);
return deps.walletAddressRepository.create({ ..., isPrimary: currentWallets.length === 0, ... });
```
`WalletAddress` has a global unique constraint on `address` and a plain (non-unique) index on `userId` — nothing constrains `(userId, isPrimary)`. Two concurrent confirmation requests for two *different* new addresses for the same brand-new user (e.g., two browser tabs completing two separate challenge/signature flows moments apart) can both pass the `length === 0` check before either `create` resolves, leaving the user with two rows both marked `isPrimary: true`.

**Evidence / code location**
- `src/modules/users/application/confirm-wallet-link.ts:64-70` — the check-then-create with no transaction or lock.
- `prisma/schema.prisma:148-160` (`WalletAddress` model) — `address String @unique`, `@@index([userId])`; no constraint on `isPrimary` at all.
- `prisma/migrations/20260807104052_init/migration.sql:245,248` — confirms only `wallet_addresses_address_key` (unique) and `wallet_addresses_user_id_idx` (non-unique) exist; no partial/composite index touches `is_primary`.

**Impact**
Violates the single-primary-wallet invariant the API's own design assumes (`docs/AUTHENTICATION.md`: "The first wallet a user links becomes their `isPrimary` address; subsequent ones do not"). Any future feature that assumes at most one primary wallet per user (e.g., "pay out to my primary wallet") would behave ambiguously for an affected account.

**Expected behavior**
At most one `WalletAddress` row per user can have `isPrimary: true`, enforced at the database level, not just by an application-level race-prone check.

**Proposed scope / implementation direction**
1. Add a partial unique index in a migration: `CREATE UNIQUE INDEX wallet_addresses_user_id_primary_key ON wallet_addresses(user_id) WHERE is_primary;` (Postgres partial unique index — allows any number of `isPrimary: false` rows per user, but at most one `true`).
2. In `confirmWalletLink`, catch the resulting unique-constraint violation and create the row with `isPrimary: false` instead of failing the whole request, preserving the intended "first wallet wins" semantics under a race rather than surfacing a 409 to the loser.

**Acceptance criteria**
- [ ] The database rejects a second `isPrimary: true` row for the same user.
- [ ] Two concurrent confirmations for a brand-new user result in exactly one primary wallet, with the other created successfully as non-primary.
- [ ] The existing single-request "first wallet becomes primary" behavior is unchanged.

**Verification / testing requirements**
- Integration test in `prisma-repositories.integration.spec.ts` (users module) firing two concurrent `create` calls with `isPrimary: true` for the same user and asserting the constraint holds.
- Unit test in `confirm-wallet-link.spec.ts` for the catch-and-retry-as-non-primary path.

---

### #122 — The five modules' "unconfigured contract → `502 BLOCKCHAIN_ERROR`" fallback path is untested by any integration spec, and structurally invisible to coverage

- **Labels:** `testing`, `reliability`, `api`
- **Area / component:** `modules/{deliveries,escrow,fleet,disputes,reputation}/index.ts`, `vitest.config.ts`

**Problem**
Each of five modules' composition-root `index.ts` contains a `createUnconfiguredContractClient()` whose every method throws a `BlockchainError` — the documented, load-bearing behavior for a deployment where a given `*_CONTRACT_ID` is left blank (`.env.example`'s default for all five). No integration test exercises this path, and `vitest.config.ts`'s coverage configuration excludes every `index.ts` file from coverage reporting, so the gap is invisible to the coverage metric as well as to the test suite.

**Current behavior**
`grep -rln "BLOCKCHAIN_ERROR\|not configured" src/modules/*/interface/*.integration.spec.ts` returns no results — none of the five route-integration spec files asserts the documented `502 BLOCKCHAIN_ERROR` response for a build endpoint when its contract id is unconfigured, despite `docs/API_REFERENCE.md` explicitly stating this behavior for every one of the five modules ("the build endpoints return `502 BLOCKCHAIN_ERROR` with a clear message rather than a generic failure"). `vitest.config.ts`'s `coverage.exclude: ['src/**/*.{spec,test}.ts', 'src/**/index.ts']` means the branching logic inside these five `index.ts` files (`config.X_CONTRACT_ID ? real : fallback`) is excluded from the coverage report regardless, so even a future contributor checking "is this tested" via the coverage tool would see nothing to indicate a gap.

**Evidence / code location**
- `src/modules/{deliveries,escrow,fleet,disputes,reputation}/index.ts` — the five `createUnconfiguredContractClient()` definitions and their conditional wiring.
- `vitest.config.ts:12` — `exclude: ['src/**/*.{spec,test}.ts', 'src/**/index.ts']`.
- `docs/API_REFERENCE.md` lines 48, 61, 69 (fleet's equivalent), 80, 92 — each module's documented `502 BLOCKCHAIN_ERROR`-on-unconfigured behavior.
- Confirmed via direct grep across all five `*.integration.spec.ts` files: zero matches for the response code or message this path produces.

**Impact**
A documented, cross-cutting behavior repeated in five modules' API documentation has no automated verification anywhere, and the project's own coverage tooling cannot reveal this because the relevant code is blanket-excluded. A regression (e.g., someone breaking the ternary, or the error message losing the environment-variable name it's supposed to name) would go unnoticed by both the test suite and the coverage report.

**Expected behavior**
At least one integration test per affected module asserts the `502 BLOCKCHAIN_ERROR` response when its contract id is unconfigured, and the exclusion of `index.ts` from coverage is narrowed so this kind of real branching logic isn't blanket-hidden.

**Proposed scope / implementation direction**
1. Add one test case per module's `*-routes.integration.spec.ts` building the app with the relevant `*_CONTRACT_ID` unset and asserting a `502` with `code: 'BLOCKCHAIN_ERROR'` from at least one build endpoint.
2. Narrow `vitest.config.ts`'s coverage exclusion from a blanket `src/**/index.ts` to something that still excludes pure barrel-export index files (most `modules/*/domain/index.ts`, `application/index.ts`, etc., which genuinely are just re-exports) while including composition-root files with real conditional logic — e.g., exclude by directory depth/pattern rather than filename alone, or add narrow inline `/* c8 ignore */` comments only around the genuinely trivial re-export lines.

**Acceptance criteria**
- [ ] Each of the five modules has at least one test asserting the unconfigured-contract 502 behavior.
- [ ] The five `index.ts` files' branching logic is no longer blanket-excluded from coverage.
- [ ] Coverage for genuine barrel-export files is unaffected.

**Verification / testing requirements**
- The new integration test cases themselves; confirm each fails if its module's fallback wiring is removed.

---

### #123 — Blockchain-event-payload parsing helpers (`parseAddress`, `parse*Id`) are copy-pasted across up to seven application-layer files

- **Labels:** `refactor`, `technical-debt`, `backend`
- **Area / component:** `modules/*/application/{sync-*-from-event,dispatch-notifications-from-event,record-actor-activity-from-event}.ts`

**Problem**
Every module's event-sync/dispatch handler defines its own private copy of the same two tiny parsing utilities instead of sharing one implementation.

**Current behavior**
`function parseAddress(value: unknown): string | null { return typeof value === 'string' ? value : null; }` is defined verbatim in `deliveries`, `disputes`, `escrow`, `fleet`, `fraud-detection`, `notifications`, and `reputation`'s application-layer event handlers — seven files. A parallel BigInt-ID parser (`try { return BigInt(value); } catch { return null; }`, wrapped in a function named `parseDeliveryId`/`parseFleetId`/`parseTupleWrappedDeliveryId`/`parseBareDeliveryId` depending on the module) is defined independently five times across four files (`deliveries`, `escrow`, `fleet`, `disputes` — the last of which has two variants for its two id-encoding conventions).

**Evidence / code location**
- `src/modules/{deliveries,disputes,escrow,fleet,fraud-detection,notifications,reputation}/application/*.ts` — each file's own bottom-of-file `function parseAddress(value: unknown): string | null { ... }`, confirmed identical via direct grep across all seven.
- `src/modules/deliveries/application/sync-delivery-from-event.ts:96`, `src/modules/escrow/application/sync-escrow-from-event.ts:98`, `src/modules/fleet/application/sync-fleet-from-event.ts:80`, `src/modules/disputes/application/sync-dispute-from-event.ts:163,175` — the five BigInt-parsing function definitions.
- `eslint.config.js:59` — `{ from: 'application', allow: ['domain', 'application', 'shared'] }` — a shared home is already permitted by the enforced boundary rules.

**Impact**
Twelve independent copies of two three-line functions, in the layer responsible for turning untrusted on-chain event data into typed values before it reaches every module's read-model writes. A bug fix or hardening (e.g., rejecting a `payload` element that is a non-finite number before it reaches `BigInt()`) would need to be applied up to twelve times to take full effect, and any one omission silently leaves that module's parsing subtly different from the others.

**Expected behavior**
Both helpers are defined once, in a shared location, and every module's handler imports them.

**Proposed scope / implementation direction**
1. Add `parseAddress` and `parseBigIntId` (a single, generically-named BigInt parser — the module-specific names like `parseDeliveryId` add no behavior beyond the shared logic) to `src/shared/events/` alongside `BlockchainEventEnvelope`, since this is event-payload-shape parsing, not module-specific business logic.
2. Leave `disputes`' tuple-wrapped-vs-bare distinction as thin, module-specific wrappers around the shared `parseBigIntId` (e.g., `parseTupleWrappedDeliveryId` becomes a two-line function that JSON-parses the wrapper then delegates), since that JSON-unwrapping step genuinely is contract-specific and shouldn't be generalized.
3. Replace all twelve local `parseAddress` definitions with the shared import.

**Acceptance criteria**
- [ ] `parseAddress` is defined in exactly one place.
- [ ] The generic BigInt-parsing logic is defined in exactly one place, with module-specific wrapping (where genuinely needed) kept local.
- [ ] All affected modules' existing sync/dispatch specs pass unchanged.

**Verification / testing requirements**
- Existing `sync-*-from-event.spec.ts` / `dispatch-notifications-from-event.spec.ts` / `record-actor-activity-from-event.spec.ts` files pass unchanged — this is a pure extraction with no behavior change.

---

### #124 — `requireUser`/`requireUserId` request-guard helpers are copy-pasted across four `interface/routes.ts` files

- **Labels:** `refactor`, `technical-debt`, `backend`
- **Area / component:** `modules/{admin,disputes,notifications,users}/interface/routes.ts`

**Problem**
Four separate route files each define their own near-identical helper to safely read `request.user` after an `authenticate` preHandler, including the same explanatory comment, rather than sharing one implementation next to the `authenticate`/`requireRole` guards they're built to complement.

**Current behavior**
`src/modules/admin/interface/routes.ts`, `src/modules/disputes/interface/routes.ts`, `src/modules/notifications/interface/routes.ts`, and `src/modules/users/interface/routes.ts` each define a `requireUserId`/`requireUser` function that throws `UnauthorizedError('Authentication required')` if `request.user` is unset, each carrying essentially the same "unreachable in practice — every route below attaches `authenticate` as a preHandler" comment. `shared/http/plugins/auth-guard.ts` already declares the `request.user?: { id: string; role: UserRole }` augmentation via TypeScript module declaration merging, and already exports `authenticate`/`requireRole` — the natural, single home for this fourth, closely related helper.

**Evidence / code location**
- `src/modules/admin/interface/routes.ts:52-59`, `src/modules/disputes/interface/routes.ts:57-67`, `src/modules/notifications/interface/routes.ts:33-42`, `src/modules/users/interface/routes.ts:40-49` — four independent definitions, confirmed via direct grep for the shared "Unreachable in practice" comment text.
- `src/shared/http/plugins/auth-guard.ts:6-10` — the `request.user` type augmentation already lives here, one import away from where these four copies could import a shared helper from instead.
- `src/shared/http/index.ts:1-7` — the existing barrel already re-exports `authenticate`/`requireRole` from this file, showing the established pattern for where request-guard helpers are meant to live.

**Impact**
A small, mechanical duplication with the same maintenance-drift risk as the other duplication findings in this backlog — four places to keep in sync instead of one, in code that is part of every protected route's authorization surface.

**Expected behavior**
One shared `requireUser(request)` helper, exported alongside `authenticate`/`requireRole`.

**Proposed scope / implementation direction**
1. Add `requireUser(request: FastifyRequest): { id: string; role: UserRole }` to `src/shared/http/plugins/auth-guard.ts`, exported via `shared/http/index.ts`.
2. Replace the four local definitions with imports.

**Acceptance criteria**
- [ ] The helper is defined in exactly one place.
- [ ] All four modules' existing route tests pass unchanged.

**Verification / testing requirements**
- Existing `*-routes.integration.spec.ts` files for the four affected modules pass unchanged.

---

### #125 — `pnpm lint` has no `--max-warnings` flag, so ESLint warnings never fail CI

- **Labels:** `ci`, `technical-debt`, `devops`
- **Area / component:** `package.json`, `.github/workflows/ci.yml`

**Problem**
`"lint": "eslint ."` runs with no `--max-warnings` flag. ESLint's default behavior is to exit `0` (success) for a run that produces only warnings, regardless of how many — only rule violations configured as `'error'` fail the command. `eslint.config.js` sets exactly one rule to `'warn'` severity: `'no-console': ['warn', { allow: ['warn', 'error'] }]`.

**Current behavior**
There are currently zero `console.log` calls in `src/` (confirmed by direct grep), so this gap has no live symptom today — but nothing in `pnpm lint` or CI's `lint-and-typecheck` job would fail if one were reintroduced. `pnpm format:check`, `pnpm typecheck`, and `pnpm test` are all pass/fail commands with no equivalent "warnings are silently OK" gap; `lint` is the one exception.

**Evidence / code location**
- `package.json` `scripts.lint` — `"eslint ."`, no `--max-warnings` flag.
- `eslint.config.js:96` — `'no-console': ['warn', { allow: ['warn', 'error'] }]`, the only `'warn'`-severity rule in the config.
- `.github/workflows/ci.yml:31` — `pnpm lint` run directly, inheriting the same gap.
- `grep -rn "console\.log(" src/` (excluding specs) — confirmed zero current occurrences.

**Impact**
A silent-by-design gap in an otherwise fully-enforced CI pipeline (format, lint, typecheck, build, test are all documented as required checks). Low current impact given zero existing violations, but the mechanism to catch a future reintroduction of exactly the kind of debug-logging leak that could end up printing sensitive data server-side is not actually wired to fail anything.

**Expected behavior**
`pnpm lint` fails on any warning, matching the all-or-nothing enforcement style of every other check in the pipeline.

**Proposed scope / implementation direction**
1. Change the `lint` script to `"eslint . --max-warnings=0"`.
2. Confirm `pnpm lint` still passes cleanly on the current codebase (expected, given zero current warnings) before merging.

**Acceptance criteria**
- [ ] `pnpm lint` exits non-zero if any ESLint warning is present.
- [ ] The current codebase still passes with the flag added.

**Verification / testing requirements**
- Run `pnpm lint` locally with the flag added and confirm a clean pass; optionally add a scratch `console.log` in a throwaway branch to confirm it now fails, then revert.

---

### #126 — Two of the seven `AppError` subclasses (`ValidationError`, `InternalError`) are defined but never instantiated anywhere in the codebase

- **Labels:** `technical-debt`, `refactor`, `backend`
- **Area / component:** `shared/errors/app-error.ts`, `shared/errors/error-handler.ts`

**Problem**
`shared/errors/app-error.ts` defines seven `AppError` subclasses as "the single domain error hierarchy" every module's errors extend. Two of the seven — `ValidationError` and `InternalError` — are never constructed or subclassed anywhere in the application.

**Current behavior**
Confirmed via direct grep for `new ValidationError`/`extends ValidationError` and `new InternalError`/`extends InternalError` across `src/` (excluding the definition file itself and specs): zero results for both. The `400 VALIDATION_ERROR` behavior these classes' names imply is instead produced entirely through separate code paths — Zod's own `ZodError`, and Fastify's `FST_ERR_VALIDATION`-coded validation errors — both handled by dedicated branches in `error-handler.ts` that never touch the `ValidationError` class. Similarly, every genuine `500 INTERNAL_ERROR` response is produced by `error-handler.ts`'s final generic fallback branch, which hardcodes `code: 'INTERNAL_ERROR'` as a string literal rather than constructing (or type-checking against) an `InternalError` instance — the class the hierarchy already defines for exactly this purpose sits unused one branch away from where it would apply.

**Evidence / code location**
- `src/shared/errors/app-error.ts:21-24` (`ValidationError`) and `:58-61` (`InternalError`) — both defined, neither ever instantiated per the grep above.
- `src/shared/errors/error-handler.ts:55-84` — the `ZodError`/`FST_ERR_VALIDATION` branches that produce `VALIDATION_ERROR` without going through the `ValidationError` class.
- `src/shared/errors/error-handler.ts:113-117` — the generic fallback that hardcodes `code: 'INTERNAL_ERROR'` as a literal rather than via `InternalError`.
- `docs/SECURITY.md`, `ARCHITECTURE.md` § 9 — both describe "the single domain error hierarchy" as the uniform mechanism every error maps through, which is not quite accurate for these two members.

**Impact**
Minor, but a real inconsistency in a hierarchy the project's own documentation presents as complete and uniform: two of its seven members are decorative, and the code paths that produce their exact same HTTP status/code do so without ever touching them, undermining the "one hierarchy, one mapping" design goal for those two cases specifically.

**Expected behavior**
Either both classes are put to actual use (or removed, if genuinely superfluous given Zod/the generic fallback already cover their cases), and `error-handler.ts`'s generic fallback and validation branches are internally consistent with whichever choice is made.

**Proposed scope / implementation direction**
1. For `InternalError`: have `error-handler.ts`'s final fallback branch construct one (or at least assert its `.code`/`.statusCode` match the hardcoded literal via a shared constant), so the class and the fallback can't drift independently.
2. For `ValidationError`: either find a genuine call site where a domain-level (not framework-level) validation failure should throw it — e.g., a cross-field business-rule check that Zod's schema-only validation can't express — or remove it from the hierarchy if no such call site is warranted, documenting that domain-level input shape validation is intentionally handled entirely by Zod/Fastify rather than this class.
3. Update `docs/SECURITY.md`/`ARCHITECTURE.md` if the resolution changes what "the single error hierarchy" actually covers.

**Acceptance criteria**
- [ ] Every remaining class in the hierarchy has at least one real call site, or the hierarchy's documentation is corrected to state which classes are reserved for future use and why.
- [ ] `error-handler.ts`'s fallback and validation branches are consistent with the resolution chosen.

**Verification / testing requirements**
- If a new call site is added: a unit test exercising it.
- If a class is removed: confirm no remaining reference anywhere in `src/`.

---

### #127 — Contract-name string literals are hardcoded and duplicated across at least seven files, unlike the project's own `QueueName` pattern for an equivalent concept

- **Labels:** `refactor`, `technical-debt`, `backend`
- **Area / component:** `modules/*/application/sync-*-from-event.ts`, `modules/*/index.ts`

**Problem**
Every module that filters the shared event bus by originating contract compares `event.contractName` against a bare string literal (`'escrow'`, `'delivery'`, `'dispute-resolution'`, `'fleet'`, `'identity-reputation'`) repeated independently in each consumer, and each module's own `getTrackedContracts()`-style wiring in `index.ts` independently hardcodes the same string as the value it assigns. No shared constant or literal-union type ties these together, even though the project already uses exactly that pattern for the analogous "canonical name shared between producers and consumers" concept elsewhere.

**Current behavior**
`grep -rln "contractName ===" src/modules/*/application/*.ts` confirms the pattern in at least five application-layer files (`deliveries`, `disputes`, `escrow`, `fleet`, `reputation`; `notifications`/`fraud-detection` add two more via their own `switch (event.contractName)` dispatch), each independently spelling the exact contract-name string it cares about. `src/shared/queue/queues.ts` shows the project's own preferred pattern for this exact class of problem — `QueueName` is a single, shared, `as const` object whose values producers and consumers both reference, with its own comment explaining why: "Modules reference these constants rather than hardcoding strings, so a rename is a one-line change instead of a grep-and-pray." No equivalent exists for contract names.

**Evidence / code location**
- `src/modules/deliveries/application/sync-delivery-from-event.ts:23`, `src/modules/escrow/application/sync-escrow-from-event.ts:26`, `src/modules/disputes/application/sync-dispute-from-event.ts:51,54`, `src/modules/fleet/application/sync-fleet-from-event.ts:25`, `src/modules/reputation/application/sync-reputation-from-event.ts:45` — each module's own hardcoded `event.contractName !== '...'`/`=== '...'` check.
- `src/modules/{deliveries,escrow,fleet,disputes,reputation}/index.ts`'s `getTrackedContracts()`-equivalent wiring — each independently assigns the matching literal as `contractName: '...'`.
- `src/shared/queue/queues.ts:10-14` — the `QueueName` const object, the project's own established pattern for exactly this kind of cross-file string constant, with its own header comment explaining the rationale.

**Impact**
A single-character typo in any one of these seven-plus locations (e.g., renaming `'dispute-resolution'` to `'disputes-resolution'` in the indexer's tracked-contract config without updating the `disputes` module's own comparison) would silently and permanently stop that module from ever matching any event for that contract, with no compile-time error — the strings are compared as plain values, not checked against a shared literal type the compiler could flag a mismatch on.

**Expected behavior**
Contract names are defined once, as a shared, typed constant every producer and consumer references — mirroring `QueueName`.

**Proposed scope / implementation direction**
1. Add a `ContractName` const object (mirroring `QueueName`'s shape) to `src/shared/events/` or `src/blockchain/`, with one entry per tracked contract (`Escrow: 'escrow'`, `Delivery: 'delivery'`, `DisputeResolution: 'dispute-resolution'`, `Fleet: 'fleet'`, `IdentityReputation: 'identity-reputation'`).
2. Type `BlockchainEventEnvelope.contractName` as `ContractNameValue` rather than a bare `string`, so a typo'd comparison anywhere becomes a compile-time type error rather than a silent runtime no-match.
3. Replace every hardcoded literal (both the `index.ts` tracked-contract wiring and each application-layer comparison) with the shared constant.

**Acceptance criteria**
- [ ] Contract names are defined in exactly one place.
- [ ] `BlockchainEventEnvelope.contractName` is typed against that shared set, not a bare `string`.
- [ ] All existing sync/dispatch specs and indexer tests pass unchanged.

**Verification / testing requirements**
- Existing per-module sync-from-event specs pass unchanged — this is a pure extraction with no behavior change.
- `pnpm typecheck` confirms the narrowed type doesn't break any existing call site.

---

## Second-pass validation summary

*(Historical record of the second mining pass. At the time this pass ran, only backlog items #1–#30 had been published, as GitHub #9–#38; items #31–#80 were subsequently published as GitHub #39–#88 in a later publishing round, after this pass and its findings were already finalized. The counts and duplicate-check below describe this pass's own methodology and are otherwise unchanged.)*

- **New issues added:** 27, numbered #101–#127, appended after the existing #31–#100.
- **Substantiation note:** the task requested up to 50 new issues. After an extensive, multi-technique second pass — live execution of the installed `@stellar/stellar-sdk`, `bcrypt`, and `jsonwebtoken` packages against constructed edge-case inputs; a `pnpm audit` run against the committed lockfile; a `gh api` query of the repository's own security settings; `git log --follow` against both migration files; five independent systematic greps for duplicated code across layers; and line-by-line cross-referencing of every claim in `ARCHITECTURE.md`, `ROADMAP.md`, `docs/EVENT_INDEXER.md`, `docs/AUTHENTICATION.md`, `docs/SECURITY.md`, and `docs/DATABASE.md` against the actual implementation — **27 issues met the required bar**: genuinely new, verified against real behavior (not speculation), non-duplicate against #1–#100, the then-published GitHub #9–#38, and each other, and contributor-ready at the same structural depth as the first pass. Several additional hypotheses were investigated and specifically ruled out after verification rather than filed speculatively (see below); rather than lower the quality bar or split the 27 into artificially narrower pieces to approach 50, this pass stops at the number actually substantiated, per the task's explicit instruction to do so.
- **Duplicate/false-lead check** — hypotheses investigated and rejected because verification disproved them or an existing issue (#1–#100 or the then-published GitHub #9–#38) already covers the same root cause:
  - "`jsonwebtoken` doesn't restrict verification algorithms, enabling an alg-confusion attack" — disproven: v9.0.3's `verify.js` defaults `options.algorithms` to the HMAC family whenever a plain secret (not a public key) is supplied, and explicitly rejects `alg: none` unless whitelisted.
  - "Swagger UI's assets are blocked by the strict global CSP" — disproven: `@fastify/swagger-ui@5.2.6`'s own `csp.json` declares no inline script/style requirement, and its `index.html` loads only same-origin `<script src>` tags, which `default-src 'self'` already permits.
  - "`docker-compose.yml`'s Postgres/Redis credentials are a security gap" — considered and set aside as an already-acknowledged, deliberate local-dev convenience with no production claim attached, not a genuine defect.
  - "`local-evidence-storage.ts`'s `read()` is vulnerable to path traversal" — disproven (re-confirmed): the `path.resolve` + `startsWith(resolvedBaseDir + path.sep)` guard correctly rejects both absolute and `..`-relative escapes, and the existing spec file already tests exactly this.
  - "The Grafana dashboard has fewer/more panels than `docs/OBSERVABILITY.md`'s stated seven" — disproven: direct count of the dashboard JSON confirms exactly seven panels, matching the documentation precisely.
  - "`docs/AUTHENTICATION.md`'s claim of real (non-mocked) ed25519 signature testing is inaccurate" — disproven: `stellar-signature-verifier.spec.ts` uses genuine `Keypair.random()` key generation and real `.sign()`/`.verify()` calls throughout, no mocking.
  - "The `.env.example`/env-schema key sets have drifted (25 vs 20 fields)" — disproven (consistent with the original backlog's own rejection of the same claim): both currently list the identical 25 keys.
  - Two additional single-class "dead code" candidates (`ValidationError` alone, `InternalError` alone) were merged into one combined issue (#126) rather than filed as two near-identical items, once both were confirmed unused by the same grep.
- **Referenced-path verification:** every file path, line range, and symbol cited above was confirmed to exist in the working tree at the time of writing (or, where a fix proposes a new file, is explicitly described as new).
- **#31–#100 confirmed untouched at the time:** no edit was made to any existing backlog entry during this pass; #101–#127 were a pure append. (Items #31–#80 have since been published to GitHub and removed from this file in a later, separate publishing round — see the top-of-file "Published" note and the "Backlog validation summary" above for current state.)
- **Scope discipline:** no GitHub issue was created, no commit was made, and no file other than this backlog was modified, per that pass's explicit instructions.
