# V-Pulse — Ôn project cho Backend Intern/Fresher

Cập nhật ngày **18/10/2026**, đối chiếu code tại commit `08e6a01`. Tài liệu này thay bản snapshot 17/10 và ghi chú nối cuối file cũ. Mục tiêu là giải thích rõ một tình huống lỗi, không học thuộc toàn bộ thuật ngữ reliability. Đây không phải báo cáo deployment.

## 1. Chỉ cần nhớ câu chuyện này

V-Pulse là web demo theo dõi payment instruction và xử lý lỗi từ payment rail mô phỏng. Operator xem attempt history, parked work và điều khiển fault profile để quan sát hệ thống.

**Điểm trình bày chính:** timeout không chứng minh giao dịch đã thất bại. Backend phải lưu trạng thái chưa rõ và không gọi thanh toán lại mù quáng. Gửi lại request tạo instruction và replay một attempt là hai việc khác nhau.

- Frontend TypeScript, React/Next.js; BFF gọi Java 21/Spring Boot.
- PostgreSQL lưu instruction, create identity, attempts, parking, audit và operator session; truy cập DB bằng JDBC.
- Redis quản lý merchant request budget; Resilience4j cung cấp circuit breaker.
- Gateway là **simulator** đọc fault config và mô phỏng delay/rejection. CARD, SWIFT và ZENGIN ở đây là nhãn rail; chưa tích hợp ngân hàng thật.
- Public dashboard chỉ đọc; tạo payment, replay và đổi fault cần operator session/CSRF. BFF/ops secrets không thay danh tính người dùng.
- Một backend chia package; không cần gọi là payment microservices platform.

### Bài giới thiệu tiếng Anh khoảng 40 giây

> V-Pulse is a payment-reliability demo built with Java, Spring Boot, PostgreSQL, Redis, and a React frontend. It uses simulated payment rails rather than real banks. The main problem is handling uncertain outcomes: a timeout does not prove that the provider did nothing. The backend stores the instruction and attempts, parks uncertain work, and refuses blind replay. It also recognizes duplicate create requests and uses timeouts, a circuit breaker, and a concurrency limit to contain failures.

Không cần nói “zero duplicate settlement” hay “exactly-once payments”. Giá trị project là cách xử lý trạng thái và giới hạn lỗi, không phải kinh nghiệm thanh toán production.

## 2. Luồng phải hiểu: create rồi timeout

1. Browser lưu operation UUID và payload chuẩn hóa trước POST; gửi lại cùng thao tác phải giữ nguyên key/payload.
2. Request đi qua BFF; Java kiểm tra session/role/CSRF, DTO và `Idempotency-Key`.
3. Trong transaction ngắn, chuẩn hóa merchant ID, khóa merchant/key rồi tìm identity đã tồn tại. Cùng payload trả instruction cũ; khác payload trả 409.
4. Với operation mới, kiểm tra Redis budget rồi lưu PROCESSING instruction, key/request hashes và received audit cùng transaction; commit trước khi gọi gateway.
5. Chỉ creator thắng claim gọi simulator. Gateway áp dụng bulkhead/circuit breaker và chờ task theo timeout.
6. Transaction finalize kiểm tra instruction vẫn PROCESSING và đúng version đã nhận. Hợp lệ thì ghi attempt, state, parking và audit cùng nhau. TIMEOUT dẫn đến PARKED, không đồng nghĩa chưa có side effect ở provider thật.

**Ví dụ tự giải thích:** Java đã tạo instruction nhưng response đến browser bị mất. Browser gửi lại cùng merchant/key/payload sẽ nhận cùng instruction, không gọi gateway thêm cho duplicate đó. Nếu attempt đầu timeout, instruction vẫn PARKED; gửi lại create không phải cách để gọi authorization lại.

HTTP 201 là tạo resource mới, không bảo đảm business state SUCCEEDED. Duplicate đang PROCESSING trả 202, duplicate terminal trả 200; đổi payload trên cùng key trả 409.

## 3. Tám câu hỏi cần học trước

### 1. Timeout có nghĩa payment thất bại không?

Không. Caller không nhận được kết quả đúng hạn; với provider thật, công việc có thể đã được nhận hoặc hoàn tất. Vì vậy hệ thống lưu attempt và park để kiểm tra, không lập tức authorize lại. Simulator không chứng minh kết quả của một ngân hàng thực.

**English:** “A timeout means the response was not confirmed. It does not prove that the provider did not process the payment, so blind retry could be unsafe.”

### 2. Timeout, circuit breaker, bulkhead và rate limit khác nhau thế nào?

| Cơ chế | Câu dễ nhớ | Trong project |
| --- | --- | --- |
| Timeout | Không chờ một lời gọi quá lâu. | Chờ future mô phỏng tối đa 250 ms. |
| Circuit breaker | Tạm ngừng gọi rail đang lỗi nhiều. | Resilience4j, trạng thái theo rail trong mỗi instance. |
| Bulkhead | Không cho quá nhiều lời gọi chạy cùng lúc. | Semaphore 8 permit/rail/instance. |
| Rate limit | Giới hạn số request trong một khoảng thời gian. | Redis, 30 request mới/phút theo canonical merchant. |

250 ms chỉ bao phần chờ task, không phải SLA cho cả HTTP request: còn query config, Redis, DB và finalize. Không cần thuộc mọi tham số breaker để giải thích bốn mục đích này.

### 3. Tạo payment bị gửi hai lần thì sao?

Create key được scope theo merchant đã chuẩn hóa; backend so request hash và giữ identity với instruction trong DB. Hai duplicate không được tự tạo hai instruction. Browser lưu key trước POST và giữ khi response chưa rõ; storage lỗi hoặc đổi payload đang unresolved thì bị chặn.

**English:** “Duplicate create requests reuse the same instruction. The key and payload fingerprint prevent the same local operation from being executed again.”

Đây là chống trùng create ở ứng dụng, không phải provider-side dedup hoặc bảo đảm ngân hàng không thu tiền hai lần.

### 4. Khi nào operator được replay?

Rail khỏe lại **chưa đủ**. Backend chỉ cho replay khi có permission ghi rõ từ kết quả simulator: rejection xác định chưa thực hiện, hoặc call bị circuit/bulkhead chặn trước khi gửi. TIMEOUT, unknown outcome, PROCESS_INTERRUPTED và historical row không có permission đều bị chặn bằng 409 `PAYMENT_RECONCILIATION_REQUIRED`.

Replay khóa instruction, đọc permission sau khi lấy khóa, rồi chuyển PROCESSING, tăng version/count và thu hồi permission trong cùng transaction. Không cần tự kể SQL chi tiết nếu chưa được hỏi sâu.

**English:** “Replay requires evidence that the earlier call did not execute. A healthy rail alone is not enough; uncertain outcomes remain parked.”

### 5. Tại sao không giữ transaction khi chờ gateway?

Tránh giữ DB transaction/lock suốt lời gọi downstream. Repo lưu create identity trước, gọi gateway bên ngoài transaction, rồi finalize bằng transaction ngắn. Đánh đổi là có khoảng cách giữa DB và external result; cần trạng thái PROCESSING/PARKED và kiểm tra kết quả về muộn.

**English:** “The gateway call is outside the database transaction. Short transactions reduce lock holding, but we must handle crashes and uncertain results between the steps.”

### 6. Process chết hoặc kết quả về muộn thì sao?

Recovery đưa PROCESSING quá tuổi sang PARKED và thu hồi replay permission; hiện dùng mốc tuổi row, chưa có full claim lease. Finalize chỉ ghi nếu status/version còn khớp, nên old worker không ghi đè instruction đã được recovery thay đổi. Guard này bảo vệ DB, không hủy side effect đã xảy ra ở provider.

**English:** “Finalization checks the claimed version and status. A late result cannot overwrite a newer database state, but that check alone cannot undo a provider operation.”

### 7. Redis lỗi thì thế nào? Merchant ID có phải account không?

Limiter hiện fail-open: nếu Redis lỗi thì cho tiếp tục và ghi metric, ưu tiên availability nhưng mất lớp quota đó. Merchant ID được chuẩn hóa để tránh tách budget bởi khác hoa/thường/khoảng trắng. Tuy nhiên operator là admin của một demo dataset, không phải merchant self-service: chọn merchant ID không chứng minh caller sở hữu merchant đó.

Không claim đây là chống abuse hoàn chỉnh; quota create này không tự giới hạn mọi replay hoặc toàn bộ ingress.

### 8. Em kiểm chứng luồng này như thế nào?

Repo có Testcontainers PostgreSQL/Redis và tests có phối hợp concurrency. Duplicate test kiểm tra cùng instruction và không thêm gateway call; timeout test kiểm tra replay 409, một attempt và không gọi lại. Late-result test giữ worker bằng latch, chạy recovery rồi cho kết quả cũ về, xác nhận không ghi đè DB.

**English:** “The tests check persisted state and gateway invocation counts. One test proves that making the rail healthy does not authorize replay of a timed-out instruction.”

## 4. Đọc code theo thứ tự, không đọc cả repo

| Bước | File | Đọc để trả lời |
| --- | --- | --- |
| 1 | [PaymentController](backend/src/main/java/dev/vpulse/payment/PaymentController.java), [PaymentModels](backend/src/main/java/dev/vpulse/payment/PaymentModels.java) | Request, key, DTO validation và status code. |
| 2 | [PaymentService](backend/src/main/java/dev/vpulse/payment/PaymentService.java) | `create` → `process`; tìm transaction trước/sau gateway và version guard. |
| 3 | [RailGateway](backend/src/main/java/dev/vpulse/payment/RailGateway.java) | Bốn cơ chế khác nhau; `RailResult.replayPermitted` phân loại kết quả. |
| 4 | [StalledPaymentRecovery](backend/src/main/java/dev/vpulse/payment/StalledPaymentRecovery.java) | PROCESSING cũ chuyển PARKED, version đổi và permission bị thu hồi. |
| 5 | [Integration tests](backend/src/test/java/dev/vpulse/PaymentReliabilityIntegrationTest.java) | Đọc ba test dưới đây. |
| Khi được hỏi | [PaymentCreateHandler](lib/payment-create/handler.ts), [payment spec](lib/payment-create/spec.ts) | Giữ identity khi mất response; storage và payload mismatch. |
| Khi được hỏi | [RedisMerchantRateLimiter](backend/src/main/java/dev/vpulse/payment/RedisMerchantRateLimiter.java) | INCR/expiry bằng Lua, fail-open. |
| Khi được hỏi | [OperatorSessionController](backend/src/main/java/dev/vpulse/shared/OperatorSessionController.java), [SecurityConfiguration](backend/src/main/java/dev/vpulse/shared/SecurityConfiguration.java) | Operator/session/CSRF; BFF trust khác user authorization. |

Ba test đáng hiểu nhất:

- `theSameMerchantOperationKeyReturnsItsInstructionWithoutAnotherGatewayCall`: duplicate create không gọi gateway thêm.
- `aTimedOutInstructionCannotBeBlindlyAuthorizedAgain`: TIMEOUT rồi NORMAL vẫn không được replay.
- `aLateGatewayResultCannotOverwriteARecoveredInstruction`: DB không bị old worker ghi đè sau recovery.

Nếu được hỏi về replay thành công, xem `parksADefinitivelyRejectedPaymentThenAllowsAnAuthorizedReplay`: **REJECT rõ ràng**, không phải TIMEOUT. Nếu hỏi race đọc permission, xem `replayRechecksPermissionAfterWaitingForTheInstructionLock`. [Evidence](docs/evidence/remediation-2026-10-18.md) phân biệt test fixture, real Java/DB và giới hạn external-provider proof.

## 5. Câu hỏi tình huống: trả lời theo cách đơn giản

**Operator nói rail đã khỏe, sao vẫn không replay được?** Giải thích rail hiện tại khỏe không xác nhận kết quả của attempt trước. Repo cố ý chặn instruction chưa rõ kết quả. Provider lookup/manual reconciliation workflow chưa được triển khai; để PARKED, không sửa SQL hoặc đổi create key để lách guard.

**Frontend timeout sau POST thì làm gì?** Giữ key/payload, kiểm tra instruction và chỉ gửi lại cùng operation theo cơ chế đã có. Không suy ra browser timeout đã hủy transaction Java.

**Khách hàng muốn tích hợp provider thật?** Hỏi contract có stable reference, idempotency/dedup, status lookup/webhook và policy xử lý unknown outcome không. Đây là yêu cầu cần xác nhận trước tích hợp, không phải tính năng repo đã hoàn thành.

## 6. Chỉ đọc khi được hỏi sâu

- Local create identity và version guard không bảo đảm exactly-once settlement. Stable provider reference/dedup/lookup và accepted-but-response-lost reconciliation chưa triển khai.
- Replay permission phải đọc sau khi khóa instruction để không dùng snapshot permission cũ sau lúc chờ lock; test race đã có. Không cần mở đầu bài giới thiệu bằng isolation-level internals.
- Recovery theo tuổi row chưa phải lease protocol đầy đủ. `cancel(true)` chỉ yêu cầu interrupt task local, không hủy một giao dịch ngân hàng từ xa.
- Circuit breaker và semaphore là per-instance, không tự chia sẻ state giữa ba replicas. Redis budget mới là shared theo key.
- Dashboard `throughput` hiện là tổng số instruction, không phải requests/second; success ratio là số liệu tổng hợp demo, không phải SLO production đo theo cửa sổ.
- Tests chưa chứng minh mọi breaker transition, bulkhead load hoặc real-provider side effect. Không lấy screenshot đẹp làm bằng chứng settlement correctness.

## 7. Cách học trong khoảng 60 phút

1. **10 phút:** giải thích timeout khác thất bại chắc chắn; tự kể bài giới thiệu.
2. **20 phút:** trace `create` → gateway → `process`; chỉ đúng ranh giới transaction.
3. **15 phút:** đọc ba test, nói rõ request, response và DB/gateway assertions.
4. **15 phút:** đóng tài liệu, phân biệt bốn cơ chế bảo vệ và trả lời vì sao TIMEOUT không được replay.

Mức Intern ưu tiên HTTP, validation, Spring service, JDBC/transaction, state và một tình huống lỗi. Chưa cần trình bày Kubernetes, SRE/SLO theory hoặc toàn bộ claim/reconciliation design.

### Tự kiểm tra trước phỏng vấn

- [ ] Phân biệt duplicate create và replay authorization.
- [ ] Giải thích được vì sao timeout không chứng minh provider chưa làm gì.
- [ ] Phân biệt timeout, breaker, bulkhead, rate limit bằng ví dụ.
- [ ] Chỉ ra một test và một giới hạn thật; không gọi simulator là ngân hàng thật.
- [ ] Biết nói phần mình hiểu chắc, không nhận toàn bộ kiến trúc hoặc kinh nghiệm production.

Mẫu đóng góp, **chỉ điền việc đã thực sự làm**: “Em tập trung vào [create identity/timeout/replay]. Em đã [đọc/viết/debug/thực hành cụ thể] và kiểm tra bằng [test cụ thể].” Nếu có AI hỗ trợ, mô tả đúng phạm vi khi được hỏi. Khi chưa hiểu phần nâng cao: “Phần em nắm rõ nhất là luồng create và cách xử lý timeout; em xin trình bày phần đó trước.”
