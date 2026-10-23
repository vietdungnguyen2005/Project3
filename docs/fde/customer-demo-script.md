# Honest demo and English incident walkthrough

## Demonstrate the current system

Use a disposable local environment and synthetic data. The existing runner is `tools/verify-operator-session.ps1` after backend packaging/frontend build; it owns its test PostgreSQL/Redis and temporary credentials. This documentation task did not rerun it or create screenshots.

1. Show dashboard health and local attempt details. Explain that the rail is a delay/rejection simulator, not an external provider.
2. Demonstrate healthy authorization and merchant-key deduplication: repeated create must not call the gateway again.
3. Inject TIMEOUT, show PARKED, restore NORMAL and demonstrate replay 409. Explain why safe refusal is the correct outcome.
4. Use a separate synthetic REJECT operation, restore NORMAL and request authorized replay. Explain its no-execution contract and atomic permission consumption.
5. Explain version-fenced stale-work recovery using the integration tests; do not call it a reconciliation process-crash game-day.
6. Show the [future contract](payment-reconciliation-contract.md) and its missing provider reference, ledger, lookup evidence and confirmation workflow. Do not manufacture a successful reconciliation screenshot.

Existing reproduction commands: `backend/mvnw.cmd verify`, `npm run verify`, `npm run test:e2e`. Fixture browsers/local-state tests do not prove external financial effects. [Acceptance evidence](acceptance-tests.md) records what actually ran for this task.

## 90-second English walkthrough

> V-Pulse is a simulated payment-reliability portfolio project. The operational problem is uncertainty: a timeout does not establish whether a provider executed an authorization, so blindly retrying could duplicate a financial operation.
>
> The application separates local create identity from execution. Merchant-scoped keys and payload hashes prevent an identical create request from generating another local instruction or gateway call. Uncertain attempts are parked instead of recursively retried.
>
> Replay permission is explicit and fail-closed. Timeouts, unknown outcomes and interrupted instructions remain blocked even when the rail becomes healthy. For a documented simulator rejection or a prevented call, an authorized operator can request replay. The backend locks the instruction, rereads permission and consumes it atomically.
>
> Short database transactions and a version check prevent a late gateway response from overwriting a recovered instruction. PostgreSQL and Redis integration tests cover these local safeguards and operator session controls.
>
> The important limitation is that the current simulator has no independent provider ledger or lookup. I would not claim accepted-but-response-lost reconciliation or exactly-once settlement. The documentation defines the future contract: stable provider identity, bounded lookup, durable evidence, explicit confirmation and stale-decision fencing. Until that is implemented and tested, uncertain payments remain parked.

## Two accurate CV bullets

Only use wording that reflects your actual contribution and understanding; repository capability is not personal production experience.

- Implemented local payment-recovery safeguards in a Java/Spring Boot simulation using merchant-scoped idempotency, PostgreSQL atomic replay claims and version-fenced finalization; kept timeout/unknown outcomes non-replayable.
- Documented incident triage, recovery decisions and provider-reconciliation design boundaries, backed by existing PostgreSQL/Redis integration coverage for permission races, interrupted processing and session/CSRF protections.

If you authored only documentation, use “analyzed/documented” rather than “implemented” for the first bullet. Do not claim real provider integration, customer incidents or provider-confirmed settlement/recovery.
