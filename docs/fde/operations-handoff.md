# Operations handoff — current V-Pulse

## Triage and permitted operation

1. Check readiness, rail/circuit state, parking depth and oldest parked age. Dashboard “SLO BREACH” is a demo heuristic, not a contractual production SLO.
2. Inspect the local payment drawer: state, attempt outcome, latency and parked reason. These are application observations, not independent provider evidence.
3. Retain the original merchant/key/payload after an uncertain **create response**. An identical create retry reads the same local instruction; a replacement key can create a different operation.
4. For TIMEOUT, unknown or interrupted outcomes, stop at PARKED. NORMAL does not grant permission. Replay 409 is an expected safety decision, not a failure to bypass.
5. Only the documented simulator no-execution/prevented-call path may carry explicit permission. OPERATOR replay rereads it after locking and consumes it atomically. The current UI has no complete provider-evidence investigation workflow; a replay button does not establish eligibility.
6. Preserve payment number, rail, timestamps, response code and request ID. Escalate uncertainty; never set permission/status by SQL, delete identities, replace keys or bulk replay to force progress.

## Authorization and audit

Business POSTs require a current OPERATOR session and CSRF; replay/fault controls additionally require BFF-injected operations credentials. Service secrets alone are not user authorization. Keep credentials out of browser code and reports.

Current create/finalization audit events retain the authenticated principal. This is not a complete reconciliation investigation/claim audit. A future workflow needs initiation, failed lookup, evidence provenance, confirmation actor and interrupted/stale-decision records.

## Observability inventory

| Available now | Meaning / limit |
| --- | --- |
| `vpulse.rail.requests` | success/failure/bulkhead rejection counters, not reconciliation metrics |
| `vpulse.rate_limit` | allowed/rejected/redis_error; Redis failure is fail-open |
| Overview oldestParkedSeconds | Queue-entry age from parked_at, not necessarily original unresolved instruction age |
| Actuator / Grafana configuration | Existing readiness/telemetry definitions, not proof of a connected live cloud dashboard |
| RequestIdFilter | Backend request correlation, not provider operation identity |

**Future, not implemented:** reconciliation counts, lookup failures/latency, unsafe-replay rejection count and unresolved-age metric with a defined origin. No payment/merchant IDs, keys or payloads should be metric labels.

## Acceptance thresholds — proposed demo criteria, not production SLOs

- Unknown/unproven replay authorizations: zero in the relevant test scenarios.
- Identical local create: one instruction, no additional gateway call.
- Late finalization overwrites: zero in the controlled local recovery test.
- Future accepted-lost reconciliation: zero additional provider authorizations; not evaluable today.
- No lookup latency/availability target is reported achieved: lookup does not exist. Define timeout, sample size and environment before measuring it.

## Rollout / rollback

This documentation-only delivery requires no deploy, migration or cloud credentials.

For existing V3/V4 safety changes: back up data, pause old writers, apply additive migrations, then coordinate backend/BFF/client rollout. Old writers must not bypass explicit permission. Preserve Flyway, identity, attempt, parking and audit history. Never roll back to permissive TIMEOUT replay or rewrite historical permission. Future provider reconciliation needs a separately reviewed rollout and failure-test plan.

See [runbook](../RUNBOOK.md), [contract](payment-reconciliation-contract.md) and [acceptance](acceptance-tests.md). Historical hosting artifacts do not establish the current live revision.
