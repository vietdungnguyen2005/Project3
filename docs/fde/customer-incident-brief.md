# Customer incident brief — simulated payment uncertainty

## Fictional customer problem

A fictional merchant sees intermittent authorization responses. Operations must distinguish accepted, rejected and unknown original operations with evidence and attributable decisions. Retrying a timeout is not a safe substitute for investigation.

This portfolio case implements **simulated provider lookup and separate operator resolution**. It is not a real customer engagement, provider integration, production incident or exactly-once financial settlement.

## Audit and bounded delivery

Base `0e92e45` already had merchant create identity, short business transactions, a 250 ms response wait, eight-permit rail bulkhead, circuit breaker, replay permissions, version fences, sessions, CSRF and BFF trust. It lacked provider identity/ledger, lookup evidence, confirmation UI and reconciliation crash proof. This implementation supersedes the documentation-only proposal; [implementation record](implementation-record.md) retains provenance.

| Addition | Operational value | Boundary |
| --- | --- | --- |
| Stable per-attempt reference + independently committed simulator ledger | Distinguishes local TIMEOUT from prior authorization | Same PostgreSQL availability domain; synthetic authorization |
| Read-only lookup + durable evidence | Verified/unknown/error observations without authorizing | NOT_FOUND and unknown never imply permission |
| Explicit confirmation + instruction version lock | Local success resolution; stale/concurrent decisions fenced | No arbitrary manual success or SQL permission override |
| Investigation drawer + audit timeline | Review reference, evidence and permitted action | Latest 20 investigations/50 audits; global demo dataset |
| Bounded lookup + expiring durable claim | Resume investigation after interruption | Explicit operator action; no automatic financial retry |
| Low-cardinality metrics + repeatable game-day | Inspectable failure and recovery behavior | Local acceptance criteria, not production SLOs |

## Source map

- [Provider interface](../../backend/src/main/java/dev/vpulse/payment/ProviderOutcomeLookup.java), [simulator](../../backend/src/main/java/dev/vpulse/payment/SimulatedPaymentProvider.java), [gateway](../../backend/src/main/java/dev/vpulse/payment/RailGateway.java).
- [Reconciliation service](../../backend/src/main/java/dev/vpulse/payment/PaymentReconciliationService.java), [controller](../../backend/src/main/java/dev/vpulse/payment/PaymentReconciliationController.java), [V5](../../backend/src/main/resources/db/migration/V5__provider_reconciliation.sql).
- [Payment service](../../backend/src/main/java/dev/vpulse/payment/PaymentService.java), [stale processing recovery](../../backend/src/main/java/dev/vpulse/payment/StalledPaymentRecovery.java).
- [Investigation UI](../../components/payment-investigation.tsx), [BFF](../../lib/backend-proxy.ts), [security](../../backend/src/main/java/dev/vpulse/shared/SecurityConfiguration.java).
- [Tests](acceptance-tests.md), [decisions](recovery-decision-matrix.md), [operations](operations-handoff.md), [demo](customer-demo-script.md).
