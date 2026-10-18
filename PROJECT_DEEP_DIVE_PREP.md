# V-Pulse — Java Backend & FDE Interview Prep

Snapshot: **2026-10-17**, local commit `aa7d603`. Dành cho Intern/Fresher/Junior; học P0 của một project trong khoảng 60–90 phút, không cần học cả ba project trong cùng một lượt.

**Nhãn bằng chứng:** `Confirmed in code` = đã đọc source/test; `Inferred` = suy luận từ code, chưa tái hiện; `Not verified` = chưa xác minh. Không chạy lại tests, không gọi live/downstream service, không đọc `.env` trong lần phân tích này. Số dòng theo snapshot; path tính từ gốc repo.

**Đóng góp cá nhân: Not verified.** Không có dữ liệu để nói bạn tự viết/thiết kế tất cả hoặc từng xử lý incident thật. Mẫu trả lời nói về implementation. Chỉ dùng “I implemented” cho phần đã trực tiếp làm và giải thích được; không tự nhận kinh nghiệm thanh toán production.

## 1. Project Overview

- **Confirmed in code:** Payment-reliability demo có tạo instruction, attempt history, parking, operator replay và fault controls [P1–P5].
- **Inferred:** Người dùng mục tiêu là operator cần nhìn thấy và xử lý payment đang không chắc kết quả.
- Java 21/Spring Boot + PostgreSQL (`JdbcClient`), Redis rate budget, Resilience4j circuit breaker [P2–P6,P12].
- Next.js/React/TypeScript BFF chạy theo cấu hình OpenNext/Cloudflare [P9,P12].
- Một Spring application chia package, không có nhiều microservice backend [P12].
- Gateway hiện **mô phỏng rail bằng config DB và `Thread.sleep`**, chưa gọi ngân hàng/card/SWIFT thật [P3:72–95].
- `PROCESSING → SUCCEEDED` hoặc `PARKED`; replay claim từ PARKED về PROCESSING [P2].
- PostgreSQL giữ instruction/attempt/park/audit; Redis chỉ rate limit merchant [P5–P6].
- Resilience gồm timeout 250 ms cho future mô phỏng, semaphore 8 permit/rail/process và circuit breaker/rail/process [P3].
- Scheduler đưa instruction PROCESSING quá 2 phút vào parking [P4].
- **Not verified:** ngân hàng thật, production latency/SLA/traffic, deployment đang sống, lịch sử incident, tác giả từng phần.

## 2. Architecture & Critical Flows

### Bản đồ code

| ID | File / vị trí | Trách nhiệm |
| --- | --- | --- |
| P1 | [PaymentController.java:45](backend/src/main/java/dev/vpulse/payment/PaymentController.java#L45); [PaymentModels.java:11](backend/src/main/java/dev/vpulse/payment/PaymentModels.java#L11) | Create/replay/fault endpoints, request DTO |
| P2 | [PaymentService.java:68](backend/src/main/java/dev/vpulse/payment/PaymentService.java#L68), replay:85, process:104, overview:176 | Persist ingress, claim replay, finalize attempt/state/audit |
| P3 | [RailGateway.java:20](backend/src/main/java/dev/vpulse/payment/RailGateway.java#L20), config:29, authorize:39, execution:72 | Circuit breaker, semaphore, future timeout, simulation |
| P4 | [StalledPaymentRecovery.java:17](backend/src/main/java/dev/vpulse/payment/StalledPaymentRecovery.java#L17) | Scheduled stale PROCESSING → PARKED |
| P5 | [V1__payment_reliability.sql:1](backend/src/main/resources/db/migration/V1__payment_reliability.sql#L1) | Data model, unique attempt, indexes |
| P6 | [RedisMerchantRateLimiter.java:11](backend/src/main/java/dev/vpulse/payment/RedisMerchantRateLimiter.java#L11) | Lua atomic increment/expiry, fail-open |
| P7 | [PaymentReliabilityIntegrationTest.java:88](backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java#L88), timeout/replay:103, budget:142, stalled:167 | Backend test evidence |
| P8 | [BffAuthenticationFilter.java:23](backend/src/main/java/dev/vpulse/shared/BffAuthenticationFilter.java#L23); [PaymentController.java:56](backend/src/main/java/dev/vpulse/payment/PaymentController.java#L56) | BFF trust, ops-secret check |
| P9 | [backend-proxy.ts:19](lib/backend-proxy.ts#L19); [control route:7](app/api/control/[...path]/route.ts#L7); [reliability-control-plane.tsx:19](components/reliability-control-plane.tsx#L19) | Browser → allowlisted BFF → Java |
| P10 | [ApiExceptionHandler.java:15](backend/src/main/java/dev/vpulse/shared/ApiExceptionHandler.java#L15) | 409/429/403/400 responses |
| P11 | [reliability-control-plane.spec.ts:1](tests/e2e/reliability-control-plane.spec.ts#L1); [backend-proxy.test.ts](tests/backend-proxy.test.ts) | Browser contract fixtures và BFF tests |
| P12 | [backend/pom.xml:6](backend/pom.xml#L6); [VPulseApplication.java:8](backend/src/main/java/dev/vpulse/VPulseApplication.java#L8); [application.yml:11](backend/src/main/resources/application.yml#L11); [Dockerfile:1](backend/Dockerfile#L1); [quality.yml:36](.github/workflows/quality.yml#L36); [package.json](package.json) | Entry, scheduler, dependencies, delivery |

### Flow A — Tạo payment và gặp timeout

Browser `POST /api/control/payments` → Next route/BFF allowlist + secret [P9] → Spring BFF filter → `POST /api/payments`, `@Valid` [P1,P8] → merchant rate check [P6] → insert instruction PROCESSING (không bọc toàn flow trong transaction) [P2:68] → `gateway.authorize` [P3] → lấy semaphore, circuit permission → config DB → future mô phỏng, chờ tối đa 250 ms → nếu timeout: cancel/return TIMEOUT → `TransactionTemplate` ghi attempt + PARKED state + parking + audit → detail → HTTP 201 với business state PARKED.

201 nghĩa resource đã tạo, không có nghĩa tiền đã được authorize. Healthy rail trả SUCCEEDED. Redis budget vượt → 429. Semaphore đầy → BULKHEAD_FULL rồi park. Circuit open → CIRCUIT_OPEN rồi park [P1–P3,P6,P10]. 250 ms là timeout của future, không phải cam kết toàn request: còn query DB, Redis và finalize.

### Flow B — Operator replay

`POST /api/control/parking/{number}/replay` → BFF inject ops secret [P9] → controller authorize [P8] → **một SQL `UPDATE ... WHERE status='PARKED' RETURNING`** claim instruction [P2:85–96] → tăng replay count → gọi gateway ngoài transaction finalize → ghi attempt/state/audit trong transaction [P2:104–148] → success xóa parking → trả detail.

Hai replay cạnh tranh một payment: conditional UPDATE chỉ cho một request chuyển PARKED sang PROCESSING tại lần claim đó; request còn lại không lấy được row. Đây là tính chất suy ra từ SQL, **không thấy concurrent replay test trong P7**. Không đồng nghĩa idempotent create hoặc exactly-once side effect tại ngân hàng.

### Flow C — Process chết sau khi claim/insert

Instruction đã lưu PROCESSING nhưng process chưa finalize → scheduler chạy mặc định mỗi 60 giây → UPDATE những row `updated_at < NOW() - 2 minutes` → cùng transaction insert parking reason PROCESS_INTERRUPTED + audit [P4] → operator có thể xem xét/replay. Test chèn instruction 3 phút tuổi và gọi recovery trực tiếp [P7:167]. Test đó không kill process thật, không chứng minh kết quả rail bên ngoài.

## 3. P0 Interview Q&A

### P0.1 — What does V-Pulse do, and is it connected to a real payment provider?

**Vietnamese explanation:** Đây là demo failure handling/payment operations. Rail ZENGIN/CARD/SWIFT là nhãn mô phỏng; adapter đọc config DB và ngủ/ném lỗi. Giá trị học là state/transaction/recovery, không phải kinh nghiệm integrate card network. Đóng góp cá nhân cần tự xác nhận.

**English sample answer:** “V-Pulse demonstrates payment failure handling and operator recovery. It stores payment instructions and attempts, contains unhealthy rails, and parks work for investigation. The current rail gateway is simulated rather than connected to a bank. I can explain the reliability flow, but I would not present it as real payment-processing experience.”

**Code evidence:** P2; P3:72–95; P5. **Possible follow-up:** “Which parts would change for a real provider?” **What I must understand:** cần provider request ID/idempotency/status lookup/auth/webhook/contract; đó là yêu cầu cải thiện, chưa có trong adapter.

### P0.2 — Walk me through a timed-out payment. Why does the API return 201?

**Vietnamese explanation:** Trace Flow A. Instruction tạo trước, timeout là outcome nghiệp vụ lưu bền vững thay vì trả success giả. Response body PARKED và attempt TIMEOUT nói rõ kết quả; HTTP 201 chỉ nói tạo resource. Không tự động retry payment trong flow đã đọc.

**English sample answer:** “The service creates a processing instruction before calling the gateway. If the simulated call times out, it records the attempt and parks the instruction. The API returns 201 because the instruction was created, but its business status is PARKED. An operator can inspect it instead of the service retrying blindly.”

**Code evidence:** P1:45–48; P2:68–82,104–148; P7:103–125. **Possible follow-up:** “Is a timeout the same as a declined payment?” **What I must understand:** timeout = phía gọi chưa biết kết quả, decline = provider trả lời từ chối. Code mô phỏng TIMEOUT không chứng minh real charge chưa xảy ra.

### P0.3 — Why keep the gateway call outside the database transaction?

**Vietnamese explanation:** Network wait không nên giữ transaction/lock dài. Code insert/claim trước, gateway call sau, rồi transaction ngắn ghi attempt/state/parking/audit. Đây không phải một ACID transaction bao hết DB và provider: crash giữa bước phải được recovery xử lý. “Không giữ transaction qua rail” khác “không bao giờ dùng connection” vì gateway còn query config DB.

**English sample answer:** “The gateway call runs before the finalization transaction. This avoids keeping a database transaction open while waiting for the downstream operation. The final transaction saves the attempt, status, parking record, and audit together. The trade-off is an interrupted PROCESSING state, which needs a recovery path.”

**Code evidence:** P2:85–106,111–148; P4. **Possible follow-up:** “What if the provider succeeds and the database commit fails?” **What I must understand:** dual-write uncertainty; cần reconciliation với provider trước replay. PostgreSQL rollback không rollback được side effect bên ngoài.

### P0.4 — How do timeout, circuit breaker, and bulkhead solve different problems?

**Vietnamese explanation:** Timeout hạn chế thời gian chờ một future; breaker ngừng gọi rail có tỷ lệ lỗi cao; bulkhead giới hạn concurrent calls của rail. Code: 250 ms, semaphore 8, breaker window 4/min 4/failure threshold 50%/open wait 5s/half-open permit 1. Đây là cấu hình demo; không có evidence được chọn từ production load test. Circuit state và semaphore nằm trong RAM mỗi instance.

**English sample answer:** “The timeout bounds how long the simulated task is awaited. The circuit breaker rejects calls when a rail has repeatedly failed. The semaphore limits each rail to eight concurrent calls in one process. Together they limit different kinds of resource pressure, but their settings are demo values rather than production tuning results.”

**Code evidence:** P3:20–68,72–94. **Possible follow-up:** “With three replicas, is the limit still eight?” **What I must understand:** local state, có thể tới 24 permits tổng; breaker không shared. Resilience4j cung cấp breaker, code tự dùng semaphore/future, không có Resilience4j Retry/TimeLimiter/bulkhead module trong flow này.

### P0.5 — How does replay prevent two operators from processing the same parked item?

**Vietnamese explanation:** Conditional UPDATE là check-and-change atomic trong DB, tốt hơn SELECT PARKED rồi UPDATE riêng. Một request claim được row; request sau thấy PROCESSING, không có RETURNING row nên conflict. Tuy nhiên request tạo mới sinh UUID ngẫu nhiên, không nhận key từ client: duplicate create là hai instruction. Replay chỉ bảo vệ claim tại thời điểm đó, không có dedup provider.

**English sample answer:** “Replay claims the instruction with one conditional database update. Only a row still in PARKED can become PROCESSING. This prevents two competing replay requests from claiming it at the same time. It does not make payment creation idempotent or guarantee that a real provider can never charge twice.”

**Code evidence:** P2:68–71,85–100; P5:1–21. **Possible follow-up:** “Where is the test for concurrent replay?” **What I must understand:** P7 có replay tuần tự sau timeout, chưa có concurrent assertion. Version tăng trong SQL không phải JPA `@Version`; predicate status mới là guard của claim này.

### P0.6 — How does the Redis merchant rate limit work, and why fail open?

**Vietnamese explanation:** Lua INCR và PEXPIRE khi counter mới tạo chạy atomic, tránh crash giữa hai lệnh khiến key không hết hạn. Limit 30 trong cửa sổ 60 giây bắt đầu từ request đầu. Lỗi Redis return true để giữ availability; limiter bị vô hiệu khi outage. Nó đếm ingress requests, không phải token bucket hoặc quota giao dịch thành công, và không bảo đảm merchantId là identity đã xác thực.

**English sample answer:** “A Redis Lua script increments a merchant counter and sets its expiry on the first request. The current limit is thirty requests in a sixty-second window. Redis errors fail open, so payments can still enter during an outage. That preserves availability but temporarily removes the rate-limit protection.”

**Code evidence:** P6:11–34; P2:68–69; P7:142–163. **Possible follow-up:** “Could a caller bypass this by changing the merchant ID?” **What I must understand:** request field khác authenticated principal; merchantId chưa được ràng buộc với account trong flow đã rà. Replay không gọi limiter này [P2:85].

### P0.7 — What happens if the process crashes before finalizing a payment?

**Vietnamese explanation:** Scheduler tìm PROCESSING cũ hơn 2 phút, chuyển PARKED và thêm reason/audit cùng transaction. Điều này làm công việc chưa hoàn tất nhìn thấy được, không tự biết provider đã nhận tiền chưa. Không nói recovery luôn đúng 2 phút: còn poll interval, downtime/scheduler/load. Nếu thao tác thật còn chạy quá cutoff, cần fencing/lease để kết quả cũ không ghi đè lần mới.

**English sample answer:** “An interrupted instruction can remain in PROCESSING. The recovery job parks processing rows older than two minutes and records why. This makes the unfinished work visible for investigation. It does not establish the provider's actual result, so a real integration would need status reconciliation before replay.”

**Code evidence:** P4:17–39; P7:167–193; P2 final update:125. **Possible follow-up:** “Can a late result overwrite a recovered instruction?” **What I must understand:** finalize UPDATE chỉ dùng id, không check attempt generation/expected status. Late-result race là rủi ro suy luận nếu worker thực tế vượt cutoff, chưa tái hiện ở đây.

### P0.8 — What are the trust boundaries of the operations console?

**Vietnamese explanation:** Java filter bắt BFF secret cho `/api/**`; replay/fault profile thêm ops secret. BFF allowlist path và inject secret server-side. Nhưng route forward hiện không check operator session/role; có secret trong BFF chưa làm người gọi browser thành operator được cấp quyền. Không có user-specific audit actor ở replay, code dùng chuỗi `operations-replay`.

**English sample answer:** “The backend accepts API calls from a trusted BFF, and replay also checks an operations secret. The BFF allowlists routes and keeps both secrets server-side. However, the current public route does not check an operator's identity or role. A production console would need that check and an audit actor tied to the real operator.”

**Code evidence:** P8; P9 proxy:19–40 / route:7–14; P2:100,140–147. **Possible follow-up:** “Does hiding the secret protect the replay endpoint from every public caller?” **What I must understand:** service trust ≠ end-user authorization; platform access policy **Not verified**. Không test khai thác hoặc gọi live.

### P0.9 — What do the tests prove, and what are the most important gaps?

**Vietnamese explanation:** Testcontainers DB/Redis + MockMvc có healthy attempt, timeout → parked → healthy replay với hai attempts, budget 31st request, stale instruction recovery. Browser test có response fixtures, không tự chứng minh Java/database integration. Chưa thấy backend test breaker OPEN/HALF_OPEN, bulkhead saturation, concurrent replay, duplicate create hoặc provider success/DB failure.

**English sample answer:** “The backend tests use real PostgreSQL and Redis containers. They check healthy authorization, timeout followed by replay, the merchant budget, and stale processing recovery. They do not demonstrate exactly-once payment processing or every circuit-breaker state. I would next test concurrent replay and failures between the provider result and database finalization.”

**Code evidence:** P7:29–55,88–193; P11. **Possible follow-up:** “What would you assert in a concurrent replay test?” **What I must understand:** assert một claim thành công, attempt/audit count phù hợp, payment state cuối; kiểm soát scheduler/call timing. Test existence khác test result, load test khác correctness test.

## 4. P1 Follow-up Questions

| Question | Ý chính | Code |
| --- | --- | --- |
| Does cancelling the future cancel a bank transfer? | Không. `cancel(true)` yêu cầu interrupt task local; simulator sleep phản hồi interrupt, provider HTTP/remote side effect chưa được chứng minh. | P3:77–94 |
| Why not retry automatically? | Payment outcome có thể không rõ; cần provider idempotency/status trước retry. Code hiện park, không có auto-retry policy. | P2:104–138 |
| Which reliability components come from libraries? | Resilience4j breaker; Java semaphore/virtual-thread executor/future; Redis Lua. Không nói tự viết circuit algorithm hay dùng Resilience4j mọi module. | P3,P6,P12 pom:30 |
| Why store attempts separately from instructions? | Một payment có nhiều attempts; instruction giữ state hiện tại, attempts giữ history; unique `(payment_id,attempt_number)`. | P5:1–29; P2:107–123 |
| Is the dashboard's throughput a requests-per-second metric? | Không: `COUNT(*)` toàn bảng instruction. successRate là tổng succeeded/tổng instruction, không phải time-window SLO hoặc latency percentile. | P2:176–191 |
| Would three replicas share one circuit breaker? | Không, circuit registry/semaphore nằm trong instance; Redis budget mới shared theo key. Cần quyết định per-instance hay global theo nhu cầu. | P3:24–36; P6 |
| Can null rail or currency pass validation? | `@Pattern` không tự bắt null; không có `@NotNull` ở hai field, DB NOT NULL sẽ chặn sau đó. Cần test 400 thay vì lỗi DB; không khẳng định đã tái hiện. | P1 models:11–15; P5:5–7 |
| Why use database indexes for list and attempt history? | Status+created_at phục vụ filter/order, payment_id+attempt_number phục vụ lịch sử; cần EXPLAIN/dataset trước claim performance. | P5:45–47; P2:29–58 |

## 5. FDE Solution Questions

Đây là tình huống giả định; các thay đổi là đề xuất, chưa triển khai.

| Question | Hướng trả lời | Code nền |
| --- | --- | --- |
| A customer's provider sometimes times out after accepting a payment. What would you clarify? | Có provider idempotency key, status lookup/webhook, reconciliation deadline không? Không replay mù. Lưu correlation/request ID và xác nhận outcome. | P2–P3 |
| The customer asks for automatic recovery. What is a safe MVP? | Một provider sandbox, idempotent request/reference, status check, bounded retry chỉ khi outcome rõ, audit và operator escalation. Hiện repo mới có park/manual replay. | P2 replay; P4 |
| How would you explain PARKED to nontechnical operations staff? | “We saved the request, but need to confirm its outcome before trying again.” Nêu next action/owner/time thay vì gọi ngay “failed charge”. | P2:124–138; P4 |
| The customer wants strict quotas during Redis outages. What changes? | Thống nhất fail-closed/degraded queue/secondary budget và availability consequence; quota gắn authenticated merchant. Không chọn policy thay khách hàng. | P6:23–34 |
| Two operators need auditable permissions for replay. Is the current system enough? | Ops secret chưa thể hiện từng người; thêm login/role, actor, approval rule nếu cần, rồi giữ atomic claim. | P8–P9; P2:85–100,140–147 |

## 6. Interview Risks & Knowledge Gaps

Đối chiếu hai bullet V-Pulse trong **`D:/CV/main.tex:195–196`**. Không sửa CV ở lần này.

| Interviewer hỏi | Source chứng minh gì / mức xác minh | Cần hiểu và trả lời chính xác |
| --- | --- | --- |
| CV: “payment providers” là provider nào? | **Confirmed:** gateway là simulator `Thread.sleep`, config DB [P3]. | Nói “simulated payment rails”; không nhận đã integrate Zengin/Card/SWIFT thật. Học contract boundary. |
| CV: timeouts, circuit breakers, rate limiting đã có? | **Confirmed:** có code [P3,P6]; tests budget và timeout [P7]. **Not verified:** tuning/load/complete breaker/bulkhead tests. | Phân biệt ba cơ chế; 250ms không phải measured end-to-end SLA. |
| CV: “timeout recovery without duplicate processing” chứng minh gì? | **Confirmed:** test tuần tự timeout rồi replay thành success, hai attempts [P7:103–138]. Atomic replay SQL [P2]. **Gap:** không concurrent replay test, không create idempotency/provider dedup. | Không đọc bullet đó thành exactly-once. Nói “the tested parked instruction can be replayed; stronger duplicate guarantees remain unverified.” |
| Process crash có mất tiền không? | **Confirmed:** stale PROCESSING được park [P4]; **Not verified:** real provider outcome. | Học uncertain outcome/dual write/reconciliation. Không đồng nhất parked với chưa thanh toán. |
| Late worker có thể ghi đè state mới? | **Confirmed code:** finalize UPDATE by id, không fencing [P2:125]. **Inferred risk:** khi worker vượt recovery cutoff. | Đề xuất attempt generation/lease + conditional finalize và race test; chưa khẳng định bug đã xảy ra ở demo. |
| User browser nào được phép replay? | **Confirmed gap in route:** BFF inject ops secret, không session/role check [P9]. **Not verified:** platform protection. | Thừa nhận demo control; production cần operator authorization, audit identity. |
| Rate limit có chống caller đổi merchantId không? | **Confirmed:** dùng field request làm key, fail-open, raw merchantId trước trim [P2:69,76;P6]. | Không nhận đây là abuse protection hoàn chỉnh; cần canonical authenticated identity và failure policy. |
| Có production metrics và real incident không? | **Confirmed:** counters/gauges/data overview và config telemetry [P2,P3,P6,P12]. **Not verified:** volume, SLO, incident thật. | Nói cấu hình/instrumentation tồn tại; dashboard sample/seed không phải historical customer data. |

## 7. English Project Presentation

### A. 60 seconds

“V-Pulse is a payment-reliability demo built with Java 21, Spring Boot, PostgreSQL, Redis, and a Next.js BFF. It focuses on containing downstream failures and making uncertain work visible to operators. The rail adapter is simulated, so the project demonstrates reliability patterns rather than real bank integration.

When a call times out, the service stores its attempt and parks the instruction. It uses a circuit breaker, a per-rail concurrency limit, and a merchant request budget. Replay claims a parked instruction with an atomic database update. Tests cover timeout followed by recovery, but the project does not guarantee exactly-once charging with a real provider.”

**Contribution sentence — chỉ thêm khi xác nhận:** “My contribution was [actual component or change], and I verified it with [test or investigation I actually performed].” Không có evidence để điền thay bạn.

### B. Technical deep dive — khoảng 3 phút khi pause và chỉ code

“The application has a Next.js operations interface, a BFF, and one Spring Boot backend. The BFF allowlists backend paths and injects server-side credentials. PostgreSQL stores payment state and history. Redis provides a merchant request budget. The BFF credential is a service trust boundary; a production operator console would also need user authentication and roles.

The create flow first checks the merchant budget and saves a PROCESSING instruction. It then calls the rail gateway. The current gateway reads a fault profile from the database and simulates a slow or rejected call. It does not connect to a real payment provider.

The gateway has three controls. A future timeout bounds how long the simulated task is awaited. A circuit breaker rejects requests when a rail has repeated failures. A semaphore limits concurrent calls to each rail in one process. These limits protect different resources. The circuit and semaphore are local, while the Redis budget is shared between instances.

The gateway call happens outside the finalization transaction. After the result, a short transaction saves the attempt, instruction status, parking record, and audit event. If the call times out, the instruction becomes PARKED. That means investigation is needed; with a real provider, timeout would not prove that no payment happened.

For replay, one conditional SQL update moves a PARKED instruction back to PROCESSING. This avoids two operators claiming the same parked item at the same moment. It does not make new payment requests idempotent. The create endpoint currently generates a new identifier for each request, and the simulated gateway has no provider-side deduplication contract.

If the process stops before finalization, a scheduled recovery job parks old PROCESSING rows. The test suite checks that recovery and also checks timeout followed by successful replay using PostgreSQL and Redis containers. Important next tests would cover simultaneous replays, late results, and database failure after provider success. Before a real customer integration, I would define provider references, status reconciliation, duplicate handling, and operator permissions rather than promise exactly-once behavior.”

## 8. Technical English Vocabulary

| Phrase | Nghĩa | Interview sentence |
| --- | --- | --- |
| uncertain outcome | kết quả chưa thể biết chắc | “A timeout leaves an uncertain outcome.” |
| failure containment | hạn chế ảnh hưởng của lỗi | “The bulkhead helps with failure containment.” |
| circuit opens | breaker tạm ngừng cho gọi | “The circuit opens after enough failures.” |
| half-open probe | lần thử sau khi chờ phục hồi | “A half-open probe checks whether the rail recovered.” |
| bounded concurrency | số lời gọi đồng thời có giới hạn | “The semaphore provides bounded concurrency per rail.” |
| request budget | số request được phép trong cửa sổ | “Redis tracks the merchant request budget.” |
| fail-open policy | cho tiếp tục khi cơ chế bảo vệ lỗi | “The limiter uses a fail-open policy.” |
| parked instruction | lệnh được giữ chờ kiểm tra | “The operator inspects the parked instruction.” |
| atomic claim | nhận xử lý bằng một thao tác nguyên tử | “Replay starts with an atomic claim.” |
| finalization transaction | transaction ghi kết quả cuối | “The finalization transaction stores state and audit together.” |
| interrupted processing | xử lý bị ngắt giữa chừng | “Recovery makes interrupted processing visible.” |
| late completion | kết quả về muộn | “A late completion needs a fencing check.” |
| provider-side idempotency | chống lặp ở phía provider | “Real integration needs provider-side idempotency.” |
| status reconciliation | xác minh trạng thái giữa hai phía | “We need status reconciliation before replaying an uncertain payment.” |
| per-instance state | trạng thái riêng từng process | “The circuit breaker has per-instance state.” |

## 9. Final Study Checklist

- [ ] 0–10 phút: overview và rail simulator, không gọi đây là real payment integration.
- [ ] 10–25 phút: trace create → gateway → finalize; chỉ đúng ranh giới transaction.
- [ ] 25–40 phút: phân biệt timeout/breaker/bulkhead/rate limit bằng một ví dụ mỗi loại.
- [ ] 40–55 phút: hiểu atomic replay claim, duplicate create và uncertain provider outcome.
- [ ] 55–65 phút: đọc scheduler + recovery test; biết test gọi method trực tiếp.
- [ ] 65–75 phút: BFF/operator trust và assertions timeout/replay/rate budget.
- [ ] 75–90 phút: luyện intro/deep dive, một tình huống FDE và contribution có thật.
- [ ] Tự trả lời: local cancel có hủy remote side effect không? DB commit fail sau provider success thì sao?
- [ ] Chưa ưu tiên Kubernetes/AWS hay distributed-systems theory ngoài những giới hạn thật ở trên; delivery chỉ biết entry, Docker, migration và CI [P12].

| Priority | Topic | Why it matters | Source code | Estimated study effort |
| --- | --- | --- | --- | --- |
| P0 | Payment states + transaction boundaries | Câu chuyện chính, tránh long transaction/dual-write nhầm lẫn | P1–P2,P5 | 20 phút |
| P0 | Timeout/breaker/semaphore/rate budget | Giải thích đúng các từ trên CV | P3,P6 | 20 phút |
| P0 | Replay claim vs exactly-once | Ngăn claim quá mức “no duplicates” | P2:85–148; P7:103 | 15 phút |
| P0 | Stalled recovery + authorization | Biết giới hạn và next step có căn cứ | P4,P8–P9 | 15 phút |
| P0 | Tests + speaking + contribution | Kết nối đáp án với evidence thật | P7; mục 7 | 20 phút |
| P1 | Late-result fencing, provider contract, index/metrics | Follow-up cho FDE/Junior khi còn thời gian | P2–P5 | 20–30 phút thêm |
## Local implementation update — 2026-10-18

Read this before older baseline examples below. Create now persists merchant-scoped key/request hashes with the instruction (migration V3); the browser persists a UUID + immutable canonical payload before POST and preserves it when the response is uncertain. Start with `lib/payment-create/spec.ts`, `handler.ts`, `PaymentService.create` and the idempotency integration tests. These prevent duplicate local creates, not provider settlement.

Replay no longer treats TIMEOUT as safe to retry after rail recovery. V4 stores explicit permission, false for all historical rows. Read `RailGateway.RailResult.replayPermitted`, `PaymentService.replay`, `StalledPaymentRecovery` and the lock-wait permission regression. The service locks the instruction before a fresh permission read, consumes permission at claim and revokes it on interrupted recovery. Unknown outcomes stay parked with 409; provider status lookup/manual reconciliation and full claim leases remain unfinished. Do not claim exactly-once or real banking integration.
