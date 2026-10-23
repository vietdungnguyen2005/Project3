# Customer incident brief — simulated payment uncertainty

> Documentation-only assessment of source `08e6a0170dc7d4558f8c49bd2f6d6274c991e2f3`, reviewed on 2026-10-24. No payment functionality, migrations or provider integration were added for this handoff.

## Fictional customer problem

A fictional merchant experiences intermittent authorization responses. A timeout does not establish whether a provider executed the request. Operations needs to distinguish confirmed success, explicit rejection and uncertainty, preserve evidence, and avoid a second financial operation disguised as recovery.

V-Pulse currently demonstrates **failure containment and fail-closed local recovery policy**, not provider reconciliation. Its rail is a local delay/rejection simulator, not an independent financial system. Do not describe this case as a real customer incident, external provider integration or exactly-once settlement.

## Current-state audit / gaps

| Area | Implemented and inspected | Limitation |
| --- | --- | --- |
| Ingress | Merchant/key/request hashes, advisory lock, atomic create identity and audit | Global operator demo dataset; not merchant authentication or external provider idempotency |
| Gateway | 250 ms simulated response wait, per-rail eight-permit bulkhead, Resilience4j circuit breaker | No stable external operation reference or authoritative provider ledger; configuration/DB waits are outside the response-wait claim |
| Parking | Attempts, reasons, explicit durable replay permission, atomic claim and permission consumption | TIMEOUT/unknown/interrupted outcomes cannot currently be resolved through provider lookup |
| Crash handling | Two-minute stale PROCESSING detection, version increment and parking with permission false | Not a full worker lease protocol; does not discover external financial outcome |
| Operator control | Session/role/CSRF, server-only trust secrets, create/replay audit principal | Existing UI can request replay; it has no provider evidence/confirmation investigation workflow |
| Observability | Rail/rate-limit metrics, Actuator, Grafana config, parking age in overview | No reconciliation metrics or persisted lookup evidence; dashboard success ratio is not a production rolling-window SLO |
| Delivery | Docker, Helm, Terraform, CI definitions and historical deployment artifacts | Historical hosting evidence does not establish the current feature set or current availability |

## Source map

- [PaymentService](../../backend/src/main/java/dev/vpulse/payment/PaymentService.java): merchant create identity, short transactions, replay claim, permission recheck and finalization version fence.
- [RailGateway](../../backend/src/main/java/dev/vpulse/payment/RailGateway.java): simulated outcomes and replay policy.
- [StalledPaymentRecovery](../../backend/src/main/java/dev/vpulse/payment/StalledPaymentRecovery.java): stale processing parking, not provider lookup.
- [PaymentController](../../backend/src/main/java/dev/vpulse/payment/PaymentController.java): existing API and privileged controls.
- [V4 replay migration](../../backend/src/main/resources/db/migration/V4__explicit_replay_safety.sql): historical permissions default false.
- [Operator dashboard](../../components/reliability-control-plane.tsx), [BFF](../../lib/backend-proxy.ts), [security](../../backend/src/main/java/dev/vpulse/shared/SecurityConfiguration.java).
- [Integration tests](../../backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java), [CI workflow](../../.github/workflows/quality.yml).

## Scope of this delivery

Document implemented guarantees, correct obsolete timeout/replay instructions, define a **future** reconciliation contract and acceptance gates, and provide an honest demo/interview handoff. No code or new screenshots/game-day measurements are introduced. See [contract](payment-reconciliation-contract.md), [decisions](recovery-decision-matrix.md), [acceptance](acceptance-tests.md), [incident analysis](incident-report.md), [operations](operations-handoff.md), and [demo](customer-demo-script.md).
