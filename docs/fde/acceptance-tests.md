# Acceptance tests and evidence

## Provenance

Local feature work on `feat/provider-reconciliation`, based on `0e92e450e314805d3054e01b4a8fa882aa524dd9`, verified 2026-10-24 Asia/Bangkok. Supersedes the documentation-only proposal at that base. No remote push, CI run, merge or deployment was initiated. Historical [free-tier](../evidence/live-deployment.md) and [AWS](../evidence/aws-deployment.md) artifacts are not evidence that reconciliation is live.

Persistent [verification summary and source/evidence SHA-256](evidence/verification.json) identifies the verified local implementation, gates and deployment boundary.

## Commands and actual results

| Gate | Result |
| --- | --- |
| `backend/mvnw.cmd -q spotless:apply verify` | 42 tests passed: 32 PostgreSQL/Redis integration + 1 validation + 9 replay-policy cases; 0 failures/errors/skipped; original regressions retained |
| `npm run verify` | 29 tests across 11 files; lint, TypeScript and Next production build passed |
| `npm run test:e2e` | 6 passed: existing desktop/mobile browser fixtures updated for investigation entry |
| `npm run audit:dependencies` | Passed; runtime audit and full audit reported 0 vulnerabilities at this run. Existing narrow approved lint-path exception was not broadened; a zero-finding snapshot does not remove future audit risk |
| `npm run cf:build` | OpenNext worker build passed, no upload/deploy |
| `docker build --tag vpulse-backend:reconciliation-local backend` | Passed; runtime image user verified as vpulse (non-root); no registry push |
| `tools/verify-operator-session.ps1 -Reconciliation` | Existing real browser session/create/replay smoke + A–E reconciliation game-day passed, including actual owned Java kill/restart |
| Docker Compose / Helm / Terraform | Compose config passed; Helm lint/template passed (optional icon recommendation); Terraform fmt/validate passed, no apply |

Transient raw logs: `backend/target/recon-backend-verify.log`, `recon-frontend-verify.log`, `recon-e2e.log`, `recon-audit.log`, `recon-cloudflare-build.log`, `recon-game-day.log`; JUnit XML in `backend/target/surefire-reports`. Persistent [game-day JSON](evidence/game-day.json) and screenshots are committed evidence, not test fixtures.

## Requirement → actual regression

Tests are in [PaymentReliabilityIntegrationTest](../../backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java) unless noted.

| Requirement | Test |
| --- | --- |
| Accepted response lost has independent provider AUTHORIZED while local PARKED | acceptedButLostResponseHasAnIndependentProviderRecordWhileLocalPaymentIsParked |
| Lookup reads original operation, persists evidence, never resolves/authorizes | providerLookupRecordsEvidenceWithoutResolvingOrAuthorizingAgain |
| Explicit success resolution is repeatable and never authorizes | explicitResolutionOfVerifiedSuccessIsIdempotentAndNeverAuthorizesAgain |
| Final rejection requires separate confirmation before replay after investigation | verifiedRejectionNeedsExplicitResolutionBeforeExistingControlledReplay |
| Unknown, unavailable and NOT_FOUND remain blocked with durable evidence | unknownNotFoundAndUnavailableLookupResultsNeverGrantResolutionOrReplay |
| Concurrent lookup reuses one claim; concurrent resolution one audit/decision | concurrentInvestigationsAndResolutionsProduceOneConsistentDecision |
| Expired claim interrupted, repeated verified lookup reused, stale resolution denied, historical missing ref manual | expiredLookupIsRecoveredAndHistoricalOrStaleEvidenceCannotResolve |
| Provider commit survives local attempt rollback; recovery does not reauthorize | providerCommitSurvivesLocalFinalizationRollbackAndRecoveryNeverReauthorizes |
| Lookup deadline persists unavailable/error evidence, no permission | slowProviderLookupHasABoundedDeadlineAndLeavesDurableFailureEvidence |
| New lookup/resolve reject anonymous, missing CSRF, wrong ops trust and role revocation | reconciliationAndResolutionRequireCurrentRoleCsrfAndOperationsTrust |
| Protected investigation and backend-derived permitted action | investigationIsOperatorOnlyAndShowsPermittedActionAndAudit |
| Controlled simulator lookup configuration requires operator | lookupFaultConfigurationRequiresOperatorCsrfAndOperationsTrust |
| Unsafe replay metric increments with no identity labels | unsafeReplayRejectionHasALowCardinalityCounter |
| Original timeout remains unsafe after NORMAL | aTimedOutInstructionCannotBeBlindlyAuthorizedAgain |
| Replay rereads permission after lock wait | replayRechecksPermissionAfterWaitingForTheInstructionLock |
| Interrupted work revokes old permission; late gateway cannot overwrite recovery | interruptedRecoveryRevokesPreviouslyRecordedReplayPermission; aLateGatewayResultCannotOverwriteARecoveredInstruction |
| Historical migration preserves data and false permission | identityMigrationPreservesHistoricalInstructionsWithoutInventingKeys |
| Original identity staging failure rolls back before gateway | aFailedIdentityInsertRollsBackTheInstructionBeforeAnyGatewayCall |
| Create identity races/duplicate behavior, session/logout/role, Redis limiter | Original integration suite, retained |
| Timeout/unknown/circuit/bulkhead replay policy | [RailReplayPolicyTest](../../backend/src/test/java/dev/vpulse/payment/RailReplayPolicyTest.java) |

The original identity-failure test now expects a sanitized 503 API response rather than a propagated SQL exception; its zero instruction/identity/gateway-call assertions remain unchanged. ControlledGateway signature changed only to pass the original provider operation through; existing race/version assertions were retained.

## Browser and game-day proof

[QA script](../../tools/qa_reconciliation.py) uses real BFF, Java and database, not route fixtures. It verifies checkbox-gated success confirmation, repeat decisions, explicit rejection/replay separation, unavailable/unknown/NOT_FOUND and concurrent requests. The [runner](../../tools/verify-operator-session.ps1) observes durable IN_PROGRESS then force-kills its owned Java process; a 503 is observed, the same DB survives restart, and a new lookup/confirmation succeeds without authorization.

Scenario D real HTTP requests share one QA account; the integration test also uses distinct actor names. Scenario E accelerates lease expiry **only in the disposable database**. It proves interruption/restart safety, not a measured 30-second recovery SLA. Scenario C NOT_FOUND explicitly removes only one synthetic ledger record. No real data is deleted.

- [Accepted-lost evidence](evidence/accepted-lost-evidence.png)
- [Resolved success](evidence/resolved-success.png)
- [Verified rejection](evidence/verified-rejection.png)
- [Unknown](evidence/unknown.png)
- [Provider unavailable](evidence/provider_unavailable.png)
- [Crash recovery](evidence/crash-recovered.png)
- [Actual UTC result timeline](incident-report.md)

[Frontend tests](../../tests/reconciliation-api.test.ts) verify CSRF-protected lookup without an authorization payload. [Render test](../../tests/payment-investigation.test.ts) verifies the signed-out boundary. [Dashboard test](../../tests/reconciliation-dashboard.test.ts) checks identity-free reconciliation metric queries. These support UI/config contracts; they do not replace database/real-server proofs.

## Remaining boundaries

Simulation only, same PostgreSQL availability domain, global demo dataset, no real provider contract or financial settlement. Unknown/historical missing-reference results intentionally remain unresolved. No external audit immutability, automatic unknown recovery or production availability/load/MTTR claim. New metrics/Grafana queries are configured/tested locally; no connected cloud dashboard screenshot is claimed.
