# Pain-point evidence: payment rail failure containment

## Local remediation supersedes the historical timeout/replay example

Implementation update, 2026-10-24: the [audit and bounded delivery](fde/customer-incident-brief.md), [decision matrix](fde/recovery-decision-matrix.md) and [acceptance evidence](fde/acceptance-tests.md) now cover stable provider references, an independently committed simulator ledger, read-only reconciliation, explicit operator confirmation and actual local process-kill recovery. This supersedes the earlier documentation-only proposal. It is simulated authorization evidence, not real provider settlement.

The deployment links and original scenarios below describe an earlier revision, not the current unpushed working tree. A timeout is now parked and blind replay is refused with 409 PAYMENT_RECONCILIATION_REQUIRED. Only explicit simulator rejection or circuit/bulkhead prevention can permit replay. Integration regressions are `aTimedOutInstructionCannotBeBlindlyAuthorizedAgain`, `parksADefinitivelyRejectedPaymentThenAllowsAnAuthorizedReplay`, and `replayRechecksPermissionAfterWaitingForTheInstructionLock`. See [current local evidence](evidence/remediation-2026-10-18.md). This is not proof of provider deduplication or settlement reconciliation.

Deployment artifacts: [persistent free-tier proof](evidence/live-deployment.md), [short-lived AWS proof](evidence/aws-deployment.md), and [machine-readable AWS verification](evidence/aws-verification.json).

## Problem

Japanese payment and enterprise systems must integrate with slow or failure-prone dependencies while preserving traceability and controlled recovery. Blind retries can amplify an outage or create duplicate financial effects. V-Pulse focuses on the operational requirement: make uncertain work visible, bounded, recoverable, and auditable.

## Implemented control

| Failure mode | Preventive control | Recovery control | Evidence |
|---|---|---|---|
| Slow rail | 250 ms response wait on a virtual-thread task | Persist TIMEOUT and park; refuse blind replay after NORMAL | `aTimedOutInstructionCannotBeBlindlyAuthorizedAgain` |
| Repeated rejection | Per-rail circuit breaker (4-call window, 50% threshold) | Operator changes fault profile; circuit reset is explicit | `RailGateway`, rail state API, browser test |
| Concurrent overload | Per-rail eight-permit bulkhead | `BULKHEAD_FULL` is parked, not retried recursively | `RailGateway.authorize` |
| Duplicate replay | Atomic `PARKED → PROCESSING` SQL claim | Only one caller can acquire the instruction | `PaymentService.replay` |
| Process interruption | No long transaction around downstream I/O | Scheduled reconciler parks stale `PROCESSING` work | `StalledPaymentRecovery` |
| Merchant burst | Atomic Redis Lua increment + expiry | 429 after 30 requests/minute; Redis failure is metered and fail-open | `enforcesTheMerchantBudgetInRedis` |
| Browser credential theft | Same-origin BFF allow-list | Server injects BFF/ops credentials | Vitest proxy test and Playwright header assertion |

## Reproducible proof

`backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java` starts real PostgreSQL 17.6 and Redis 8.2 containers. In addition to the existing controls, it verifies accepted-but-response-lost lookup without reauthorization, separate resolution, concurrent decisions, stale/historical evidence, lookup failure evidence and independent provider commit surviving local finalization rollback. The [A–E game-day](fde/incident-report.md) exercises real BFF/Java and browser confirmation, including an actual owned Java process kill. Neither proves external settlement.

```bash
cd backend
./mvnw verify
```

Frontend proof checks BFF target allow-listing, server-only credentials, SLO classification, CSP/security headers, and operator-visible failure/recovery state:

```bash
npm run verify
npm run test:e2e
```

These tests are wired into `.github/workflows/quality.yml`; CI also builds the non-root image and renders the Helm chart. Evidence is code- and test-backed, not a claim that production traffic was processed.
