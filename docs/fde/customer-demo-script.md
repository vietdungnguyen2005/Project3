# Customer demo and English incident walkthrough

## Reproduce locally

After backend packaging and frontend production build, run:

```powershell
.\tools\verify-operator-session.ps1 -Reconciliation
```

The runner creates disposable PostgreSQL/Redis, fake local credentials, Java/Next servers, then verifies existing session/create/replay behavior and game-day A–E. It kills **only its owned Java process**, restarts against the same disposable DB and cleans its process trees/containers. It does not read payment credentials or deploy.

## Five-minute operator demo

1. Set CARD ACCEPT_LOST and create synthetic traffic. Show local PARKED/TIMEOUT, distinct original reference and the independently committed AUTHORIZED provider ledger.
2. Open investigation. Explain lookup is read-only; choose Look up original operation. Review OBSERVED / VERIFIED_SUCCESS, evidence code, actor and request ID. The payment is still PARKED.
3. Check confirmation and choose Confirm verified success. Show local SUCCEEDED / ALREADY_RECONCILED and the audit. Repeated lookup/confirmation returns the same evidence; provider invocation count stays one.
4. Use a separate REJECT instruction. Lookup revokes prior replay permission. Confirm the final rejection to grant permission, then explicitly replay under NORMAL. Explain the second provider invocation is intentional and safe only under the simulator's documented no-execution rejection contract.
5. Show UNKNOWN, unavailable and NOT_FOUND examples. They remain parked; unsafe replay/resolve returns 409. A healthy rail does not change the past.
6. Show concurrent tests and [crash evidence](incident-report.md): a real Java kill while lookup was IN_PROGRESS, retained claim after restart, interrupted old evidence and read-only recovery. Lease expiry was accelerated only in the disposable DB.

Screenshots and machine-readable results: [acceptance](acceptance-tests.md). Do not present the screenshots as a live deployed feature.

## 90-second English walkthrough

> V-Pulse is a simulated payment-reliability project. The problem is an uncertain authorization: a provider may accept an operation even when the application receives a timeout. Blindly retrying could duplicate an external operation.
>
> I separated authorization, lookup and operator resolution. Each authorization claim stores a stable reference before I/O. The simulated provider commits an independent ledger transaction, so an accepted-but-lost response can be investigated even if local finalization fails.
>
> An operator first performs read-only lookup. The application persists evidence with the original reference, version and actor, but does not mark success or authorize again. Explicit confirmation resolves verified success locally. Final rejection can grant controlled replay permission only because the simulator guarantees no execution; replay remains a separate action.
>
> Unknown, unavailable and not-found results stay parked. PostgreSQL instruction locks, version checks and atomic permission consumption prevent stale or concurrent decisions. A durable expiring lookup claim supports safe investigation after process interruption.
>
> I verified these behaviors with PostgreSQL/Redis integration tests, real browser confirmation and a local process-kill game-day. The simulator shares the application's database availability domain, so I would not claim real provider integration, production incident experience or exactly-once settlement.

## Two accurate CV bullets

Use only if you understand and can explain the implementation; project capability is not personal production experience.

- Built a Java/Spring Boot simulated payment investigation flow with stable provider references, durable lookup evidence and explicit operator confirmation; resolved accepted-but-response-lost authorizations without a second provider call.
- Verified fail-closed unknown outcomes, concurrent recovery decisions and process-interruption recovery using PostgreSQL/Redis integration tests and a reproducible local browser game-day, with audited actions and low-cardinality metrics.

If your contribution was analysis/documentation rather than implementation, replace “Built/Verified” with the work you actually performed. No real charges, customer engagement or production SRE claims.
