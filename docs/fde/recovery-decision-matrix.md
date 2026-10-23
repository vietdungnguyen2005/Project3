# Recovery decision matrix

The UI displays backend-derived next actions. A healthy rail never establishes an earlier outcome. These are simulated authorizations, not settlement.

| Current evidence | Permitted next action | Financial-like operation |
| --- | --- | --- |
| PARKED / TIMEOUT, OUTCOME_UNKNOWN or PROCESS_INTERRUPTED, known reference | RECONCILE_PROVIDER: explicit lookup | None |
| Live IN_PROGRESS claim | WAIT_FOR_LOOKUP: GET refresh only | None |
| Expired lookup claim | New explicit lookup marks old evidence INTERRUPTED | None |
| Current OBSERVED VERIFIED_SUCCESS | CONFIRM_SUCCESS: checkbox + explicit resolution | Local SUCCEEDED only; no authorization |
| Current OBSERVED VERIFIED_REJECTION | CONFIRM_REJECTION under final/no-execution simulator semantics | Grant permission only; no authorization |
| Resolved final rejection / explicit prevented-call permission | CONTROLLED_REPLAY_ALLOWED: separate confirmed replay | Atomic claim consumes permission; new reference/attempt |
| UNKNOWN, incomplete, PROVIDER_UNAVAILABLE, NOT_FOUND | Keep PARKED; may explicitly repeat lookup | No inferred permission; resolve/replay 409 |
| Historical missing reference, no permission | MANUAL_REVIEW; lookup records HISTORICAL_REFERENCE_MISSING | No invented reference or replay |
| Stale version/reference or another payment's evidence | Resolution 409; refresh original investigation | None |
| Resolved success | ALREADY_RECONCILED; repeat confirmation returns same evidence | None |
| Duplicate create acknowledgement unconfirmed | Retain merchant/key/payload; explicit identical create retry | Original instruction; no extra gateway call |
| Late original gateway result after recovery | Claimed-version fence discards finalization | Cannot overwrite recovered state |

New reconciliation claims revoke existing replay permission while investigating. Existing explicit rejection/circuit/bulkhead permission remains supported when no investigation revoked it; a reason label alone never grants permission.

The simulator defines rejection as final, with no execution or late acceptance. Do not transfer that assumption to a real provider without independent contract validation. **NOT_FOUND never substitutes for a no-execution guarantee.** See [contract](payment-reconciliation-contract.md).
