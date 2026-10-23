# Simulated incident analysis — uncertainty must stay visible

> Test-backed documentation, not a newly executed game-day or a real customer incident. No provider ledger/reconciliation capability was implemented in this change.

## A — Accepted but response lost: NOT DEMONSTRATED

The current rail can time out but has no independently committed provider ledger. A TIMEOUT test cannot establish that a provider accepted the request, or prove reconciliation prevented a second external authorization.

Required future proof: the original operation records one provider authorization; the response is lost; repeated/concurrent lookup verifies that same operation; explicit local resolution succeeds without another authorization. Until then, keep uncertainty parked.

## B — Explicit simulator rejection: IMPLEMENTED

`parksADefinitivelyRejectedPaymentThenAllowsAnAuthorizedReplay` proves this logical sequence, not measured wall-clock timestamps:

1. Configure CARD REJECT and create a synthetic instruction.
2. Record DOWNSTREAM_REJECTED and explicit replay permission.
3. Restore NORMAL; an authorized replay locks the instruction, rereads permission and consumes it atomically.
4. A successful simulator response finalizes SUCCEEDED with two local attempts.

The simulator defines explicit rejection as no execution. Do not transfer that assumption to a real provider without documented finality semantics.

## C — Uncertain response: SAFE REFUSAL IMPLEMENTED

`aTimedOutInstructionCannotBeBlindlyAuthorizedAgain` proves TIMEOUT → PARKED → restore NORMAL → replay 409 PAYMENT_RECONCILIATION_REQUIRED. The instruction remains parked, replay count stays zero and gateway call count does not increase.

The configured response-wait deadline is 250 ms; no precise end-to-end latency measurement is claimed. This proves refusal, not successful provider reconciliation.

## D — Concurrent operators: PARTIAL LOCAL PROOF ONLY

Provider reconciliation is not implemented. `replayRechecksPermissionAfterWaitingForTheInstructionLock` covers a narrower real-PostgreSQL race: replay waits on the instruction lock, the owner revokes permission, and the waiter reads the new permission after acquiring the lock. Result: 409 and no gateway call. This is not proof of concurrent provider-evidence resolution.

## E — Process crash: NO RECONCILIATION GAME-DAY

Current tests cover controlled local recovery:

- `reconcilesAnInstructionInterruptedBetweenClaimAndFinalize`: stale PROCESSING becomes PARKED with an audit event. Its name refers to local stale-work handling, not provider lookup.
- `interruptedRecoveryRevokesPreviouslyRecordedReplayPermission`: no old permission survives recovery.
- `aLateGatewayResultCannotOverwriteARecoveredInstruction`: late finalization cannot overwrite recovery or insert a stale attempt.

A kill/restart during reconciliation remains a future gate. No such run or screenshot is claimed here.

## Conclusion

Implemented: local ingress identity, simulated dependency containment, explicit parking, replay permission, locks/version fencing and mutation authorization. Missing: stable provider identity, independent outcome ledger, lookup evidence, operator resolution confirmation, crash-safe reconciliation claims and related metrics.

See [actual test evidence](acceptance-tests.md) and [permitted actions](recovery-decision-matrix.md). No customer MTTR reduction, real charges or settlement guarantee is claimed.
