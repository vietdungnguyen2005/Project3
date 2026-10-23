# Simulated incident game-day report

Executed locally on 2026-10-24 Asia/Bangkok (2026-10-23 UTC), on feature work based on `0e92e45`. Java 21/Spring Boot, Next production server, disposable PostgreSQL 17.6 and Redis 8.2. No real customer, payment credentials or financial transaction.

Authoritative recorded results: [game-day.json](evidence/game-day.json). Timestamps below are **UTC result timestamps**, not production outage or start timestamps.

| Scenario | Recorded result at UTC | Actual result |
| --- | --- | --- |
| A accepted / response lost | 18:33:59.078878 | Local TIMEOUT/PARKED; provider AUTHORIZED. Browser lookup then explicit confirmation → SUCCEEDED. Repeated lookup/resolve reused evidence; provider calls stayed 1. |
| B final rejection | 18:34:01.279302 | Lookup VERIFIED_REJECTION; replay 409 until explicit resolution granted permission. Separate replay under NORMAL succeeded. Two total provider calls: one rejection, one new authorization. |
| C unknown | 18:34:03.497119 | UNKNOWN evidence, PARKED, resolve/replay 409, original provider call count 1. Lookup HTTP sample 0.047 s. |
| C unavailable | 18:34:05.293020 | PROVIDER_UNAVAILABLE evidence, PARKED, resolve/replay 409, provider calls 1. Lookup HTTP sample 0.062 s. |
| C not found | 18:34:05.657096 | Test-only removal of one synthetic ledger record; NOT_FOUND remained PARKED, replay 409. Absence did not grant permission. |
| D concurrent requests | 18:34:06.814628 | Two requests returned 200/202 with the same investigation ID. Concurrent confirmations both returned RESOLVED; one resolution audit and one provider invocation. |
| E actual process kill/restart | Prepared 18:34:08.614994; result 18:34:24.759001 | Runner observed durable IN_PROGRESS, force-terminated its Java process, and verified the waiting BFF request saw 503. Restart retained the claim/payment. Explicit lookup after test-accelerated lease expiry marked old evidence INTERRUPTED; verified success resolved without another authorization. |

D uses two concurrent requests from the same real authenticated QA account; the separate integration test uses distinct operator-a/operator-b actors. Both establish serialization; neither simulates distinct human actions in production.

E is a real process termination, not an exception mock. The preparation/result interval includes startup/login/screenshots, and the 30-second lease was deliberately expired in the disposable DB. It is **not MTTR, lease duration measurement or a production recovery SLA**.

## Independent transaction failure proof

`providerCommitSurvivesLocalFinalizationRollbackAndRecoveryNeverReauthorizes` injects a PostgreSQL trigger failure in local attempt finalization. The API returns sanitized 503, provider AUTHORIZED survives in its independent transaction, stale PROCESSING recovery parks the instruction, and lookup + resolution succeeds with one gateway call. This is a real DB rollback test, separate from process-kill scenario E.

## Root cause illustrated

A response timeout is loss of knowledge, not proof that a provider declined or did not execute. A healthy dependency later does not reconstruct the earlier outcome. The original operation identity and authoritative evidence are required; reconciliation must not be disguised re-execution.

## Controls and limits

Lookup never authorizes. Explicit confirmation is fenced by payment version/reference and authenticated operator policy. Unknown/error/NOT_FOUND stays parked. Final rejection permits a new attempt only under the simulator's strong final/no-execution contract. Historical missing-reference records remain manual review.

The simulator ledger shares PostgreSQL availability; all traffic and actors are synthetic. No real distributed-provider availability, production reliability improvement, settlement, exactly-once or customer MTTR claim.

## Screenshots

- [Accepted-lost evidence before confirmation](evidence/accepted-lost-evidence.png)
- [Successfully resolved](evidence/resolved-success.png)
- [Final rejection awaiting confirmation](evidence/verified-rejection.png)
- [Unknown remains parked](evidence/unknown.png)
- [Provider unavailable remains parked](evidence/provider_unavailable.png)
- [Restart recovery with interrupted history](evidence/crash-recovered.png)

See [acceptance tests](acceptance-tests.md), [contract](payment-reconciliation-contract.md), and [handoff](operations-handoff.md).
