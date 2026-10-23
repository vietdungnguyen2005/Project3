# Recovery decision matrix

## Current supported decisions

| Observation | Meaning | Current permitted next action | Evidence |
| --- | --- | --- | --- |
| SUCCEEDED / AUTHORIZED | Local simulator returned success and finalization version matched | Inspect local attempt/audit; no parked replay | `acceptsAHealthyPaymentAndPersistsItsAttempt` |
| PARKED / TIMEOUT | Response wait expired; execution cannot be established | Keep parked; replay returns 409 PAYMENT_RECONCILIATION_REQUIRED even after NORMAL | `aTimedOutInstructionCannotBeBlindlyAuthorizedAgain` |
| OUTCOME_UNKNOWN or unrecognized outcome | No explicit safe permission | Keep parked; no authorization | `RailReplayPolicyTest` |
| PROCESS_INTERRUPTED | Stale PROCESSING was parked and previous permission revoked | Keep parked; manual investigation, no SQL permission override | `interruptedRecoveryRevokesPreviouslyRecordedReplayPermission` |
| New simulator DOWNSTREAM_REJECTED with explicit permission | This simulator documents rejection as no execution | Operator may request controlled replay after containment; permission consumed atomically | `parksADefinitivelyRejectedPaymentThenAllowsAnAuthorizedReplay` |
| CIRCUIT_OPEN / BULKHEAD_FULL with permission | Gateway prevented that simulated call | Controlled operator replay may be eligible; no automatic retry | Gateway policy; `RailReplayPolicyTest` (not a complete load test) |
| Historical parked rejection reason, permission false | Label alone is not execution proof | Keep blocked; do not backfill permission from reason | V4 default false; migration/integration regressions |
| PROCESSING duplicate create | Existing operation may still be active | Retain original key/payload and observe; no second authorization | `aConcurrentDuplicateObservesProcessingWithoutAnotherGatewayCall` |
| Recovery changed version while old gateway call returns | Old response no longer owns local state | Discard stale finalization; remain parked | `aLateGatewayResultCannotOverwriteARecoveredInstruction` |
| Response lost after local create committed | Client acknowledgement unknown, not necessarily provider outcome unknown | Explicit identical create retry retains the same local instruction; never generate a replacement key | Local create identity tests / historical real-browser evidence |

Changing a fault profile to NORMAL affects future simulator calls; it does not establish what happened to a timed-out request. The method named `parkStalledInstructions` and a test using “reconciles” in its name do not implement provider reconciliation.

## Proposed provider decisions — unavailable today

| Future lookup evidence | Required local decision | Authorization permission |
| --- | --- | --- |
| Verified success for original operation | Resolve local success with evidence/audit | No new authorization |
| Verified final rejection | Record rejection according to documented contract; explicit operator review | Only a separately proven safe path may grant a new attempt |
| Unknown, incomplete, unavailable or not found | Retain parked and record failed/unknown lookup | None inferred |
| Definitively not executed | Require strong no-late-execution guarantee and identity binding | Controlled policy decision only, never inferred from absence |
| Conflicting/stale evidence or historical missing reference | Preserve state, escalate | None |
| Crash during investigation | Preserve durable in-progress/uncertain evidence; safely repeat lookup | No financial replay shortcut |

The future rows are acceptance requirements, not demonstrations or implemented features.
