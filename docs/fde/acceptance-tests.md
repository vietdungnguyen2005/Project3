# Acceptance tests and evidence boundaries

## Verification performed during this documentation task

Before the user narrowed the scope to documents, existing commands were run against base `08e6a0170dc7d4558f8c49bd2f6d6274c991e2f3`:

| Command | Actual result |
| --- | --- |
| `backend/mvnw.cmd -q verify` | 29 tests passed: 19 PostgreSQL/Redis integration, 1 validation, 9 replay-policy cases; 0 failures/errors |
| `npm run verify` | 25 tests passed, ESLint, TypeScript and Next production build passed |

Logs are transient local artifacts: `backend/target/fde-baseline-backend.log`, `backend/target/fde-baseline-frontend.log`; JUnit XML is under `backend/target/surefire-reports`. No source/test/dependency/migration changes were made for this documentation delivery. No new game-day, browser session, screenshots, dependency audit, image build, cloud check or deployment is claimed here.

## Current traceability

Tests below are in [PaymentReliabilityIntegrationTest](../../backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java) unless noted.

| Requirement | Existing proof | Scope |
| --- | --- | --- |
| Unknown outcome cannot blindly replay | `aTimedOutInstructionCannotBeBlindlyAuthorizedAgain`; [RailReplayPolicyTest](../../backend/src/test/java/dev/vpulse/payment/RailReplayPolicyTest.java) | Local simulator policy, not provider lookup |
| Safe rejection path remains supported | `parksADefinitivelyRejectedPaymentThenAllowsAnAuthorizedReplay` | Rejection guarantees apply to this simulator only |
| Concurrent permission revocation is observed | `replayRechecksPermissionAfterWaitingForTheInstructionLock` | Real PostgreSQL lock wait and fresh permission read |
| Interrupted recovery cannot reuse permission | `interruptedRecoveryRevokesPreviouslyRecordedReplayPermission` | Version/permission safety, not external outcome discovery |
| Late finalization cannot overwrite recovery | `aLateGatewayResultCannotOverwriteARecoveredInstruction` | Controlled thread/interleaving test; not an actual process-kill game-day |
| Historical identity/permission not fabricated | `identityMigrationPreservesHistoricalInstructionsWithoutInventingKeys` | V3/V4 upgrade behavior |
| Local idempotency survives concurrent create | `aConcurrentDuplicateObservesProcessingWithoutAnotherGatewayCall`, `theSameMerchantOperationKeyReturnsItsInstructionWithoutAnotherGatewayCall` | Local instruction/gateway-call counts |
| Initial identity failure cannot call gateway | `aFailedIdentityInsertRollsBackTheInstructionBeforeAnyGatewayCall` | Real transaction rollback |
| Session, CSRF, role and trust protections | `expiredAndDisabledSessionsLoseMutationAccess`, `sessionRoleRevocationCsrfAndLogoutAreEnforced`, `serviceSecretsAloneCannotChangeARailFaultProfile` | Existing controls |
| Merchant budget | `enforcesTheMerchantBudgetInRedis` | Real Redis; failure-open behavior remains documented separately |

Existing browser tests: [Playwright suite](../../tests/e2e/reliability-control-plane.spec.ts) uses API fixtures; [real-server runner](../../tools/verify-operator-session.ps1) and [script](../../tools/qa_operator_session.py) exercise backend sessions/create/replay. Prior results are in [historical remediation evidence](../evidence/remediation-2026-10-18.md), not a new browser execution in this task.

## Future reconciliation release gates — NOT PASSED / NOT IMPLEMENTED

- Accepted-but-response-lost: independent provider ledger records one authorization; repeated/concurrent reconciliation resolves success without another authorization.
- Unknown/incomplete/not-found/unavailable: durable evidence, parked state and no newly inferred permission.
- Explicit rejection: verified finality semantics, separate operator permission decision and atomic replay claim.
- Repeated resolution: one consistent financial/local decision, no duplicate effects; every investigation/action traceable to an actor.
- Concurrent operators: conflicting evidence/versions cannot produce conflicting state changes.
- Process crash during lookup/confirmation: durable evidence survives; stale workers cannot resolve or grant permission; recovery repeats lookup only.
- Legacy rows without trustworthy external identity stay blocked; migrations preserve history without invented references.
- Unauthorized/CSRF/role-revoked requests fail before provider lookup or resolution.

These require real database concurrency tests and a deterministic provider ledger, plus real browser scenarios. Mocks alone cannot establish them.

## CI / deployment provenance

[quality.yml](../../.github/workflows/quality.yml) defines frontend, fixture browser, backend and supply-chain gates. No branch was pushed or remote CI initiated for this documentation change. [Deployment evidence](../evidence/live-deployment.md) records a historical 2026-08-20 snapshot; it does not prove current availability or reconciliation capability.
