# V-Pulse — remediation evidence, đợt đầu

## Latest verification — create identity and fail-closed replay

2026-10-18, base `aa7d603` plus local changes. This section supersedes the earlier timeout-replay behavior and missing-create-identity limitations below. No commit, push or deployment. Disposable local PostgreSQL 17.6/Redis 8.2; simulated rail, not a payment provider.

Commands and results:

- Backend: `cd backend; ./mvnw.cmd -q spotless:apply verify` exit 0; **29 tests**, zero failures/errors/skips (19 integration, 1 validation, 9 replay-policy cases). Log: `backend/target/payment-replay-safety-final-verify.log`; Surefire XML records the assertions.
- Frontend: `npm run verify` exit 0; **25 tests**, ESLint, TypeScript and production build passed. Log: `backend/target/payment-replay-safety-final-frontend.log`.
- Browser fixtures: `npm run test:e2e` exit 0, **6 tests** on desktop/mobile Chromium. Log: `backend/target/payment-replay-safety-fixture-e2e.log`; these are UI contracts, not independent backend proof.
- Real browser: `pwsh -NoProfile -File tools/verify-operator-session.ps1` exit 0; Next production server → BFF → packaged Java → disposable DB/Redis, no API fixture. Log: `backend/target/payment-replay-safety-browser.log`. Owned processes and containers stopped in finally; no JAR/build replacement while running.
- `git diff --check`, `docker compose config --quiet`, `helm lint infra/helm/vpulse` passed (Helm icon recommendation only).

### Create identity evidence

V3 atomically stores canonical merchant/key/request hashes, instruction and received audit. Per-key transaction advisory locking serializes duplicate claims; unique constraints are the backstop. Matching duplicates reuse the instruction without a new gateway call or quota unit; changed content returns 409. PROCESSING duplicates return 202, terminal duplicates 200, new completed creates 201. Historical rows receive no invented identity; the ledger has no expiry that silently permits execution again.

Browser typed Spec/Handler persists UUID plus canonical payload before POST; storage failure/corruption or unresolved edited payload fails closed. It retains identity on unknown responses. A same-handler in-flight guard returns BUSY rather than allowing another completion to clear the pending intent. Regression before the guard failed the first request's success assertion; after it both state and result are correct. Logs: `payment-client-inflight-red.log` / `payment-client-inflight-green.log` under backend/target. This is not cross-tab locking or account recovery.

The real browser runner intercepts a create only after the real BFF/Java response has committed, aborts delivery, then reloads and explicitly resubmits the original input/key. Result: duplicate 200 with the same instruction; SQL asserts exactly one instruction, identity and attempt. This is local operation evidence, not provider settlement evidence. Earlier phase logs: `payment-ingress-identity-verify.log` (17 backend tests), `payment-ingress-frontend-verify.log` (24 frontend tests), `payment-ingress-browser-verify.log` and `payment-ingress-fixture-e2e.log` (6 fixture tests).

### Replay regression evidence

| Scenario | Before fix | After fix |
| --- | --- | --- |
| TIMEOUT, then healthy rail, then replay | 200 and another authorization call | 409 PAYMENT_RECONCILIATION_REQUIRED; PARKED, one attempt, unchanged replay count/calls |
| Replay blocked behind instruction lock while previous worker revokes permission | Joined stale permission snapshot allowed 200 | Fresh permission query after lock returns 409; no gateway call |
| Interrupted recovery with old replay permission | Old permission could survive recovery | PROCESS_INTERRUPTED and permission false; replay refused |
| Definitive simulator rejection, then healthy rail | Controlled retry supported | Still succeeds with two recorded attempts |
| Upgrade historical parked rejection | Reason alone might imply safe retry | V4 default false; history preserved, no invented create key |

RED/GREEN logs: `payment-unknown-replay-red.log` / `payment-unknown-replay-green.log`, `payment-replay-permission-race-red.log` / `payment-replay-permission-race-green.log`, all in ignored backend/target. The lock race uses a real PostgreSQL blocker and pg_stat_activity/pg_blocking_pids to verify waiting before revocation, not a guessed sleep. The full suite passes after both fixes.

Replay permission is explicit durable evidence from this simulator contract: downstream rejection means no execution; circuit/bulkhead rejection means the call was prevented. Unknown labels default false. Claim consumes permission in the same transaction as PROCESSING/version/replay count; finalization records the next permission under its version fence, recovery revokes it. The real browser runner also asserts TIMEOUT → NORMAL → replay 409/one attempt, and REJECT → NORMAL → replay 200/two attempts.

### Remaining gates

Stable provider reference, provider-side dedup/status lookup, accepted-but-response-lost reconciliation, manual resolution workflow, full claim leases and separate stale-result observations are not implemented. Unknown instructions stay parked: do not override permission with SQL or create a new key as a workaround. DB fencing/local-create dedup is not exactly-once external execution. Global OPERATOR applies to one demo dataset, not merchant self-service. Browser storage is not cross-device recovery; detail reads are not a fully atomic multi-query snapshot. Quota/config/other dependency waits still need bounds.

Existing Next/OpenNext/toolchain dependency audit had **15 findings (3 moderate, 10 high, 2 critical)** during the create-identity phase; adding direct Zod was not an audit fix. This must be remediated before deployment; V-Market's clean audit does not apply to V-Pulse. Old deployment artifacts do not cover these changes. Rollout requires pausing old writers, backup, V3/V4, coordinated application rollout and smoke checks; no mixed-version guarantee.

Ngày: 2026-10-18 (Asia/Bangkok). Base commit `aa7d603` + local working-tree changes; chưa commit/push/deploy. Đây là bằng chứng local, không phải kết quả production.

## Verification — đợt correctness đầu tiên

Chạy từ thư mục `backend`:

```powershell
.\mvnw.cmd -q spotless:apply verify
```

Exit code **0**. Surefire: **7 tests, 0 failures, 0 errors, 0 skipped**. Integration tests dùng PostgreSQL 17.6 và Redis 8.2 Testcontainers; validation tests dùng Jakarta/Hibernate Validator thực. Spotless format/check và Maven package đã qua trong verify.

Có thể chạy lại lệnh trên để tái tạo kết quả. Reports local: `backend/target/surefire-reports/TEST-*.xml`; log `backend/target/remediation-verify.log`. Target artifacts không được đưa vào Git.

## Những thay đổi đã xác minh

- Missing/blank rail, currency hoặc fault mode bị validation chặn.
- Finalization chỉ cập nhật instruction còn PROCESSING và có đúng version lúc claim. Nếu recovery đã tăng version, result cũ không ghi đè state/attempt/audit.
- Replay claim và replay count cùng transaction; gateway call vẫn ở ngoài transaction finalize.
- Test gateway có latch giữ kết quả, chạy recovery rồi cho old worker hoàn tất. Không dùng timing sleep để hy vọng xảy ra race.

| Regression test | Trước sửa | Sau sửa |
| --- | --- | --- |
| `aLateGatewayResultCannotOverwriteARecoveredInstruction` | Recovery PARKED bị old worker ghi SUCCEEDED | Giữ PARKED, không thêm stale attempt |
| `PaymentValidationTest` | Null enum-like fields hợp lệ | Có constraint violations |
| `parksATimedOutPaymentThenAllowsAnAuthorizedReplay` | Behavior cũ cần giữ | Vẫn park rồi replay thành SUCCEEDED, hai attempts |

Source: [PaymentService](../../backend/src/main/java/dev/vpulse/payment/PaymentService.java), [PaymentModels](../../backend/src/main/java/dev/vpulse/payment/PaymentModels.java), [integration tests](../../backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java), [validation tests](../../backend/src/test/java/dev/vpulse/payment/PaymentValidationTest.java).

## Giới hạn còn lại

Version guard bảo vệ DB, không xác minh provider outcome và không ngăn real external side effect. Stale result hiện bị bỏ khỏi business history, chưa có riêng observation record. Chưa có idempotent create, lease/generation model đầy đủ, provider dedup/status reconciliation hoặc bộ test breaker/bulkhead/concurrent replay hoàn chỉnh. Rail vẫn là simulator.

## AUTH-1 — local operator sessions

Verification mới nhất: `backend/./mvnw.cmd -q spotless:apply verify` exit 0, **11 tests / 0 failures / 0 errors / 0 skipped**. `npm run verify` exit 0: **9 unit tests**, lint, typecheck và Next production build. Logs: `backend/target/auth-verify.log` và `backend/target/auth-frontend-verify.log`.

`npm run test:e2e` exit 0: **6/6 browser fixture tests**, gồm desktop Chromium và mobile Chrome: inspect payment detail, operator mutation gửi CSRF nhưng không gửi service secrets, anonymous controls disabled. Log: `backend/target/auth-e2e.log`. Đây là frontend fixture evidence, không phải backend integration evidence.

- Migration V2 thêm accounts BCrypt, PostgreSQL login windows và Spring Session JDBC; session ID đổi sau login, cookie HttpOnly/Secure/SameSite=Lax, idle timeout 15 phút.
- Public GET vẫn dùng được qua BFF. Tất cả POST nghiệp vụ cần OPERATOR + CSRF. Login/logout có CSRF riêng. Service secrets không cấp quyền người dùng.
- Role được đọc lại mỗi request; VIEWER, disabled account, expired session và logout có regression coverage. Actor create/replay lấy từ principal, không dùng `system-ingress`/`operations-replay`.
- BFF allowlist theo method + pathname (bỏ query khi phân loại); wrong method trả 405 trước upstream; origin guard chặn cross-origin; cookie/CSRF/Set-Cookie được forward.
- Dashboard công khai read-only; operator sign-in mở controls. UI không phải lớp bảo vệ duy nhất: gọi API trực tiếp vẫn bị Java chặn.

| Scenario | Before | After |
| --- | --- | --- |
| Service secrets, không session, đổi fault profile | 200, đổi được cấu hình | 401 |
| Authenticated payment audit | Actor `system-ingress` | Username từ session |
| POST lên route chỉ đọc `rails?unused=true` | BFF không kiểm tra method | 405, không gọi upstream |
| Cross-origin write | Không có origin guard | 403, không gọi upstream |

### Real browser evidence

`pwsh -NoProfile -File tools/verify-operator-session.ps1` exit 0. Python Playwright dùng Next production server → BFF → Java JAR → PostgreSQL/Redis disposable, **không có API fixture**. Assertions: public GET 200; controls disabled; anonymous mutation 401; login 204; HttpOnly/SameSite cookie; mutation thiếu CSRF 403; submit qua UI 201; logout 204; mutation sau logout 401; public GET vẫn 200. Đã xem screenshot `backend/target/operator-browser/public-read-only.png`; ảnh/log tái tạo được và ignored.

Test chạy sau package/build, không rebuild JAR khi Java đang dùng nó trên Windows. Một lượt QA chạy đồng thời với Maven repackage bị file-lock/class-loading failure; đã chạy lại tuần tự thành công. Đây là lỗi orchestration local, không coi lượt fail đó là application proof.

### Scope / rollout

Chưa deploy. OPERATOR là global administrator của **một demo dataset**, được phép quản lý mọi merchant; không cung cấp merchant login/self-service. Không dùng merchantId trong request để cấp role. Cần authorization model mới trước khi mở nhiều tenant thực.

Throttle có budget PostgreSQL 10 attempts/minute/backend peer; sau shared BFF có thể là budget chung, không claim per-end-user-IP. Không có public signup/password recovery. Chỉ local HTTP được dùng insecure cookie; production cần HTTPS. PULSE-1/PULSE-3/PULSE-4 và claim lease/provider reconciliation vẫn là backlog, không được diễn giải auth session là đã giải quyết duplicate settlement.

## Session attribute concurrency follow-up

Regression `concurrentSessionAttributeInsertionDoesNotFailARequest` load hai snapshot của cùng session, mỗi snapshot thêm cùng attribute mới rồi lần lượt save: trước sửa, lần save thứ hai ném PostgreSQL duplicate key; sau sửa cả hai thành công. Dùng `PostgreSqlJdbcIndexedSessionRepositoryCustomizer` chuẩn của Spring Session để upsert attribute; không tự viết session protocol. Backend full verify chạy lại exit 0; số tests mới nhất ở phần AUTH-1 đã cập nhật. Đây là last-write-wins attribute persistence, không phải exactly-once/linearizable sessions.
