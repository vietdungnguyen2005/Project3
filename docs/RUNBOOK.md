# Runbook — payment rail degradation

## Trigger

- SLO status is `BREACH`, a circuit is `OPEN`, parking depth increases, or oldest parked age exceeds the team threshold.

## Triage

1. Confirm backend readiness and check the Grafana “Payment Reliability” dashboard.
2. Identify the affected `rail` and `outcome` in `vpulse_rail_requests_total`.
3. Stop sending controlled demo traffic. Do not bulk replay while the circuit is open.
4. Inspect a parked payment’s attempt timeline and correlation/request ID in service logs.

## Containment

1. Keep the unhealthy rail isolated; the circuit breaker rejects fast and the bulkhead caps concurrency.
2. Verify new uncertain instructions enter `PARKED` and that parking age/depth are visible.
3. Escalate to the rail provider with timestamps and outcomes. Never mark a timeout as succeeded without confirmation.

## Recovery

1. Inspect the recorded outcome and replay permission. A healthy rail is necessary, but not sufficient, for safe replay.
2. `TIMEOUT`, unknown outcomes, interrupted processing and historical rows without explicit permission require investigation. Blind replay returns 409 `PAYMENT_RECONCILIATION_REQUIRED`; do not bypass it with SQL or a new create key. For a known original provider reference, use the protected investigation drawer to perform read-only lookup, then explicitly confirm current verified evidence. Verified success resolves locally without authorization; unknown/unavailable/NOT_FOUND stays parked. Historical missing references require manual review. Restoring `NORMAL` never establishes the prior outcome. See the [decision matrix](fde/recovery-decision-matrix.md).
3. Only explicit final/no-execution simulator rejection or a call prevented by the circuit/bulkhead can grant replay permission. A reconciliation lookup revokes existing permission while investigating; verified rejection must be separately confirmed before a new replay. Return the demo fault profile to `NORMAL` and confirm health with separate controlled traffic.
4. Request replay of one eligible instruction and confirm an `AUTHORIZED` attempt and `SUCCEEDED` state. Permission is consumed at claim; a later uncertain outcome cannot reuse the earlier permission.
5. Continue only with eligible instructions while watching failure rate, latency, and parking age. Preserve audit events and open a post-incident review.

## Rollback

Application rollback uses the previously known-good immutable image tag. Flyway migrations must remain forward-compatible; never delete the schema history table or manually rewrite payment states during rollback.

Do not restore an old writer that permits blind timeout replay or cannot maintain provider references. V5 is additive but requires coordinated backend/BFF/frontend rollout and pausing older writers. Preserve the simulator ledger, reconciliation evidence and audit history; never remove migrations to roll back. See the [handoff](fde/operations-handoff.md) and [acceptance evidence](fde/acceptance-tests.md). This feature has not been deployed by this task.

## Interrupted lookup

Lookup persists IN_PROGRESS before I/O. After a process crash, refresh the original investigation; wait for its 30-second database-clock lease, then explicitly repeat lookup. Old evidence becomes INTERRUPTED. Do not replay authorization or manually expire production claims. A database/transaction 503 is unconfirmed local work: refresh the original resource, not a replacement payment. The [game-day](fde/incident-report.md) used an actual owned Java process kill and accelerated lease expiry only in a disposable DB.
