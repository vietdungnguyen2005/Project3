# Operations handoff — simulated provider reconciliation

## Investigation workflow

1. Check readiness, circuit state, parked depth/age and existing rail metrics. Dashboard SLO BREACH is a heuristic, not a contractual rolling-window SLO.
2. Open **Investigate payment** in the existing drawer. Review attempts and original provider reference. Sign in as OPERATOR to access protected evidence.
3. Retain the original merchant/create key/payload when the create acknowledgement was lost. Do not create a replacement key to force progress.
4. For a known-reference uncertain instruction, choose **Look up original operation**. This performs no authorization. A live lookup is shown as WAIT_FOR_LOOKUP; UI polling is GET only.
5. Review evidence and next action. VERIFIED_SUCCESS may be explicitly confirmed as local success. VERIFIED_REJECTION may be explicitly confirmed to grant controlled replay under the simulator's final/no-execution semantics. Neither confirmation calls authorization.
6. Only CONTROLLED_REPLAY_ALLOWED plus explicit permission offers a separate confirmed replay. Restore the simulator rail to NORMAL first. Permission is consumed by the atomic claim; a new uncertain outcome stays blocked.
7. UNKNOWN, NOT_FOUND, unavailable, historical missing-reference or conflicting evidence: keep parked, preserve audit and escalate. Never mutate status/permission through SQL, delete identity records, replace keys or bulk retry.

A stale decision/replay 409 is expected safety behavior. Refresh evidence before deciding again. The API checks current permissions/version even if a browser has old controls.

## Crash / database failure

A reconciliation claim commits before lookup. After a crash, wait for its 30-second database-clock lease and explicitly look up again; expired evidence becomes INTERRUPTED. Repeated lookup is read-only. There is no background financial replay or automatic resolution. Do not accelerate lease expiry outside a disposable test environment.

Stale PROCESSING payment recovery remains separate: the existing scheduler parks instructions older than two minutes with permission false and increments version. A late authorization result cannot finalize the old version. Reconciliation then uses the retained original provider reference.

503 DATABASE_UNAVAILABLE means local database work could not be confirmed. Refresh the original instruction/investigation. If observation could not commit, the durable claim still supports investigation after expiry. Do not assume failure means non-execution.

## Authentication and evidence

Session, current role and CSRF protect business POSTs. Investigation GET and all reconciliation actions also require BFF/ops server trust. Secrets stay server-side. Evidence records actor, original reference/version, observation code, request ID, timestamps and resolution actor. Audit records request/observation/resolution/interruption. The browser shows the latest 20 investigations and 50 audits; older records remain in PostgreSQL, with no export UI in scope.

## Metrics / existing Grafana dashboard

| Metric (Micrometer name) | Meaning |
| --- | --- |
| vpulse.reconciliation.attempts{outcome} | Completed owned lookup lifecycle observations, including interrupted finalization; reused evidence/live claims do not increment |
| vpulse.reconciliation.lookup.failures | PROVIDER_UNAVAILABLE observations: upstream fault, capacity, error or deadline |
| vpulse.reconciliation.latency | Lookup plus observation-finalization lifecycle duration, not financial authorization latency |
| vpulse.reconciliation.oldest.unresolved.seconds | Oldest PARKED instruction measured from original payment created_at, not queue-entry age; 0 if empty, NaN on DB read error |
| vpulse.replay.unsafe.rejected | Explicit replay requests blocked because permission is false; not every possible 409 |
| Existing vpulse.rail.requests / vpulse.rate_limit | Dependency outcomes and merchant budget; Redis limiter remains fail-open |

The existing [Grafana JSON](../../infra/grafana/dashboards/payment-reliability.json) adds outcome counts, oldest age, lookup failures, mean lifecycle latency and blocked replay panels. Prometheus converts dotted names to underscores with counter/timer suffixes. No payment, merchant, reference, key or request ID labels. Config/tests are not proof of a connected cloud dashboard. A process killed before observation cannot emit a completed counter; inspect durable IN_PROGRESS evidence too.

## Local acceptance thresholds — not production SLOs

- Accepted-lost reconciliation: exactly one provider invocation for the original operation, zero additional calls from lookup/resolution.
- Unknown/unverified replay: zero authorization calls beyond the initial attempt; HTTP 409.
- Concurrent resolution: one RESOLVED audit, consistent final state.
- Lookup response deadline: configured 3 seconds; four actual workers per JVM. Overall HTTP latency also includes session/DB/lock work.
- Selected local normal/error game-day lookups: less than 5 seconds each, sample size one per recorded C outcome. This is not an availability or performance SLA.
- Crash recovery: preserve claim and safely repeat lookup. Test lease expiry is accelerated; no measured recovery-time promise.

## Rollout / rollback

No push, merge, deployment or real provider infrastructure change is part of this delivery.

For a later rollout: back up data, pause older writers, apply additive V5, deploy matching backend/BFF/frontend, verify protected lookup and fail-closed cases with synthetic data. V1–V4 remain unchanged. Historical rows keep NULL reference and default-false permission. Simulator fault configuration affects the whole demo rail, not a single merchant.

Do not roll back to an old writer while accepting new traffic: it cannot maintain provider references/evidence semantics. Pause writes and retain a compatible binary or forward fix. Preserve Flyway, payment/create identity, ledger, evidence and audit history; never drop V5 or backfill permission to force recovery.

## Remaining limits

Same-database simulator; no real provider availability/finality or settlement guarantees. Global demo dataset, not multi-tenant merchant authorization. No automatic unknown-outcome resolution, payment capture/refund, external ledger retention protocol, cross-device create recovery or tamper-evident audit. Business I/O is outside business locks, but DB/session/config waits are not a blanket guarantee against pool exhaustion. See [contract](payment-reconciliation-contract.md) and [acceptance](acceptance-tests.md).
