# Pain-point evidence: payment rail failure containment

## Problem

Japanese payment and enterprise systems must integrate with slow or failure-prone dependencies while preserving traceability and controlled recovery. Blind retries can amplify an outage or create duplicate financial effects. V-Pulse focuses on the operational requirement: make uncertain work visible, bounded, recoverable, and auditable.

## Implemented control

| Failure mode | Preventive control | Recovery control | Evidence |
|---|---|---|---|
| Slow rail | 250 ms deadline on a virtual-thread task | Persist `TIMEOUT` attempt and park instruction | `parksATimedOutPaymentThenAllowsAnAuthorizedReplay` |
| Repeated rejection | Per-rail circuit breaker (4-call window, 50% threshold) | Operator changes fault profile; circuit reset is explicit | `RailGateway`, rail state API, browser test |
| Concurrent overload | Per-rail eight-permit bulkhead | `BULKHEAD_FULL` is parked, not retried recursively | `RailGateway.authorize` |
| Duplicate replay | Atomic `PARKED → PROCESSING` SQL claim | Only one caller can acquire the instruction | `PaymentService.replay` |
| Process interruption | No long transaction around downstream I/O | Scheduled reconciler parks stale `PROCESSING` work | `StalledPaymentRecovery` |
| Merchant burst | Atomic Redis Lua increment + expiry | 429 after 30 requests/minute; Redis failure is metered and fail-open | `enforcesTheMerchantBudgetInRedis` |
| Browser credential theft | Same-origin BFF allow-list | Server injects BFF/ops credentials | Vitest proxy test and Playwright header assertion |

## Reproducible proof

`backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java` starts real PostgreSQL 17.6 and Redis 8.2 containers. It proves unauthorized access is rejected, a healthy payment succeeds, a timed-out payment is parked and later replayed, and the Redis budget returns HTTP 429.

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
