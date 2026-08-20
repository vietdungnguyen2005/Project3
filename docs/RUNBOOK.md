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

1. Confirm the rail is healthy using a controlled low-value instruction.
2. Return its demo fault profile to `NORMAL`; this explicitly resets the demo circuit.
3. Replay one parked instruction and confirm an `AUTHORIZED` attempt and `SUCCEEDED` state.
4. Drain gradually while watching failure rate, latency, and parking age.
5. Preserve audit events and open a post-incident review.

## Rollback

Application rollback uses the previously known-good immutable image tag. Flyway migrations must remain forward-compatible; never delete the schema history table or manually rewrite payment states during rollback.
