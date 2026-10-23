# Implementation record — provider reconciliation

Base: `0e92e450e314805d3054e01b4a8fa882aa524dd9`. Branch: `feat/provider-reconciliation`.

The preceding documentation-only audit remains a historical baseline, not a claim of implemented provider lookup. The user subsequently authorized the full mission. Existing baseline commands passed 29 backend tests (real PostgreSQL/Redis Testcontainers), 25 frontend tests, lint/typecheck and Next production build.

## Audit / reuse

Reuse PaymentService create identity, parking permission/claim, version fence, RailGateway timeout/bulkhead/circuit, StalledPaymentRecovery, operator sessions/CSRF, BFF allowlist, metrics/Grafana and existing browser infrastructure. No second payment queue, real provider credentials or real financial operation.

## Invariants and API design before implementation

- Persist a stable per-authorization-claim provider reference before external-like I/O. Historical rows retain NULL; never invent their outcome or reference.
- Independent simulator ledger commit and no FK to local payment state. Same reference/payload is idempotent; mismatches fail closed. This still shares demo database availability and is not a real distributed provider.
- Read-only lookup interface: verified success/rejection, incomplete/unknown, unavailable and NOT_FOUND. NOT_FOUND never means permission to retry.
- POST `/api/payments/{number}/reconciliation` commits a bounded IN_PROGRESS evidence record and revokes replay permission, releases business locks, then looks up the original operation. No authorization is called. Repeated/concurrent verified observations may reuse evidence.
- POST `/api/payments/{number}/reconciliation/{id}/resolve` is separate explicit operator confirmation. Under locks, require matching original reference/version and verified evidence. Success resolves local state; rejection can only grant controlled retry permission under the simulator's final-no-execution contract. Neither action authorizes automatically.
- GET `/api/payments/{number}/investigation` returns permitted next action, bounded evidence/audit history. All new reads/mutations require OPERATOR and server ops/BFF trust; mutations also require CSRF.
- Expired in-progress lookup records become INTERRUPTED when reinvestigated. New lookup is safe to repeat; old finalization checks run state/lease/reference/version and cannot overwrite a replacement. No replay shortcut or fake historical reference.
- Additive V5 only. Existing V1–V4 unchanged. No automatic push, merge or deployment.

## Delivered and verified

Implemented the provider interface/simulator, reference persistence, durable lookup/explicit resolution, protected investigation API, existing-dashboard investigation drawer and reconciliation metric panels. Final local backend verification: 42 tests (32 real PostgreSQL/Redis integration, 1 validation, 9 replay-policy), all passed. Frontend: 29 tests, lint/typecheck/production build passed; existing desktop/mobile Playwright fixtures: 6 passed. Audit reported zero vulnerabilities at the run; narrow approved policy was unchanged. Cloudflare adapter build passed, without deployment.

The real-server runner passed existing session/create/replay smoke and synthetic A–E, including actual owned Java process kill/restart. [Results and screenshots](acceptance-tests.md), [recorded UTC timeline](incident-report.md), [machine-readable game-day](evidence/game-day.json). No remote CI or live-feature claim. Shared database availability, simulated finality, historical unknowns and explicit operator recovery limits are documented in [handoff](operations-handoff.md).
