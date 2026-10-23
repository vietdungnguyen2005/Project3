# Simulated incident review — timeout is not replay permission

> Updated 2026-10-24. This section retains the original fail-closed timeout regression; a separate newly executed **synthetic** reconciliation game-day is recorded below. Neither is a real customer incident.

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

The feature branch now adds a stable reference, independently committed simulator ledger, read-only lookup and separate evidence-backed confirmation. A local TIMEOUT alone still does not prove acceptance. The ledger shares application PostgreSQL availability; no real provider or settlement guarantees are claimed.

See the [executed A–E scenario report](fde/incident-report.md), [implemented contract](fde/payment-reconciliation-contract.md) and [acceptance evidence](fde/acceptance-tests.md). Accepted-lost lookup/confirmation and real Java kill/restart recovery each retained one provider invocation. The crash test accelerated lease expiry in its disposable DB; it is not production MTTR. Unknown/unavailable/NOT_FOUND results still remain parked.
