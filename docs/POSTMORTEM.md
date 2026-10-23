# Simulated incident review — timeout is not replay permission

> Documentation correction, 2026-10-24. This is a local simulator/test case, not a real customer incident or a newly executed game-day.

## Correction to the earlier narrative

An earlier version described CARD TIMEOUT → NORMAL → successful replay. That example is obsolete and unsafe under the current policy. Restoring a rail does not establish whether a timed-out operation executed. Current behavior is TIMEOUT → PARKED → replay 409 PAYMENT_RECONCILIATION_REQUIRED, without another gateway call.

## Test-backed timeline

Logical sequence, not measured elapsed time:

1. Configure CARD TIMEOUT and create a synthetic instruction.
2. The simulated response wait expires; TIMEOUT and PARKED are recorded with replay permission false.
3. Restore NORMAL and request replay as an authorized operator.
4. The backend refuses replay; the instruction remains PARKED, replay count stays zero and gateway call count is unchanged.

Proof: `aTimedOutInstructionCannotBeBlindlyAuthorizedAgain` in [integration tests](../backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java).

A separate test, `parksADefinitivelyRejectedPaymentThenAllowsAnAuthorizedReplay`, proves the REJECT → NORMAL → controlled replay path under this simulator's no-execution semantics. It is not timeout reconciliation.

## Established controls

Local create identity avoids another instruction/gateway call for the same merchant operation. Replay locks the instruction and rereads permission. Interrupted recovery revokes permission; version fencing prevents late finalization from overwriting recovery. Session/CSRF/trust controls protect mutations.

## Limits

There is no independent provider ledger, stable external reference, outcome lookup or evidence-backed resolution workflow. A local timeout does not prove an accepted-but-response-lost authorization. No real process-kill reconciliation timeline, production MTTR, provider deduplication or exactly-once settlement is claimed.

See the [scenario report](fde/incident-report.md), [future contract](fde/payment-reconciliation-contract.md) and [actual acceptance evidence](fde/acceptance-tests.md). Unknown instructions remain parked until a trustworthy resolution path exists.
