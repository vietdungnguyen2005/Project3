package dev.vpulse.payment;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class PaymentService {
    private final JdbcClient jdbc;
    private final RailGateway gateway;
    private final RedisMerchantRateLimiter rateLimiter;
    private final TransactionTemplate transactions;

    public PaymentService(
            JdbcClient jdbc,
            RailGateway gateway,
            RedisMerchantRateLimiter rateLimiter,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.gateway = gateway;
        this.rateLimiter = rateLimiter;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public PaymentWindow list(int offset, int limit, String status) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(limit, 600));
        boolean filtered = status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status);
        String where = filtered ? " WHERE status = :status" : "";
        var query = jdbc.sql(
                "SELECT payment_number, merchant_id, rail, amount_minor, currency, status, created_at FROM payment_instruction"
                        + where + " ORDER BY created_at DESC OFFSET :offset LIMIT :limit");
        if (filtered) query = query.param("status", status.toUpperCase());
        var rows = query.param("offset", safeOffset)
                .param("limit", safeLimit)
                .query(PaymentSummary.class)
                .list();
        var countQuery = jdbc.sql("SELECT COUNT(*) FROM payment_instruction" + where);
        if (filtered) countQuery = countQuery.param("status", status.toUpperCase());
        return new PaymentWindow(rows, countQuery.query(Long.class).single(), safeOffset, safeLimit);
    }

    public PaymentDetail detail(String paymentNumber) {
        var payment = jdbc.sql(
                        "SELECT payment_number, merchant_id, rail, amount_minor, currency, status, created_at FROM payment_instruction WHERE payment_number = :number")
                .param("number", paymentNumber)
                .query(PaymentSummary.class)
                .optional()
                .orElseThrow(() -> new PaymentProcessingException("Payment not found"));
        var attempts = jdbc.sql(
                        "SELECT a.attempt_number, a.outcome, a.latency_ms, a.detail, a.created_at FROM payment_attempt a JOIN payment_instruction p ON p.id = a.payment_id WHERE p.payment_number = :number ORDER BY a.attempt_number")
                .param("number", paymentNumber)
                .query(PaymentAttemptView.class)
                .list();
        var parked = jdbc.sql(
                        "SELECT pp.reason FROM parked_payment pp JOIN payment_instruction p ON p.id = pp.payment_id WHERE p.payment_number = :number")
                .param("number", paymentNumber)
                .query(String.class)
                .optional()
                .orElse(null);
        return new PaymentDetail(payment, attempts, parked);
    }

    public PaymentCreateResult create(CreatePaymentRequest request, String actor, String key) {
        if (key == null || !key.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,119}"))
            throw new InvalidPaymentRequestException("A valid 8–120 character Idempotency-Key is required.");
        String merchant = request.merchantId().trim().toUpperCase(java.util.Locale.ROOT);
        if (!merchant.matches("[A-Z0-9][A-Z0-9._-]{0,39}"))
            throw new InvalidPaymentRequestException(
                    "Merchant ID must be a canonical ASCII identifier of at most 40 characters.");
        String keyHash = digest("payment-create-key:v1\n" + key);
        String fingerprint = digest(String.join(
                "\n",
                "payment-create-request:v1",
                merchant,
                request.rail(),
                Long.toString(request.amountMinor()),
                request.currency()));
        var claimed = transactions.execute(ignored -> {
            jdbc.sql("SET LOCAL lock_timeout='3s'").update();
            jdbc.sql("SET LOCAL statement_timeout='8s'").update();
            jdbc.sql("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))")
                    .param("key", "vpulse:create:" + merchant + ":" + keyHash)
                    .query((rs, row) -> true)
                    .single();
            var existing = jdbc.sql(
                            """
                    SELECT o.request_hash,p.id,p.payment_number,p.rail FROM payment_create_operation o
                    JOIN payment_instruction p ON p.id=o.payment_id WHERE o.merchant_id=:merchant AND o.key_hash=:key
                    """)
                    .param("merchant", merchant)
                    .param("key", keyHash)
                    .query(ExistingOperation.class)
                    .optional();
            if (existing.isPresent()) {
                var operation = existing.get();
                if (!operation.requestHash().equals(fingerprint)) throw new PaymentIdempotencyConflictException();
                return new CreateClaim(operation.id(), operation.paymentNumber(), operation.rail(), false);
            }
            if (!rateLimiter.allow(merchant)) throw new RateLimitExceededException();
            UUID id = UUID.randomUUID();
            String number =
                    "VP-" + id.toString().replace("-", "").substring(0, 12).toUpperCase(java.util.Locale.ROOT);
            jdbc.sql(
                            "INSERT INTO payment_instruction (id, payment_number, merchant_id, rail, amount_minor, currency, status) VALUES (:id,:number,:merchant,:rail,:amount,:currency,'PROCESSING')")
                    .param("id", id)
                    .param("number", number)
                    .param("merchant", merchant)
                    .param("rail", request.rail())
                    .param("amount", request.amountMinor())
                    .param("currency", request.currency())
                    .update();
            jdbc.sql(
                            "INSERT INTO payment_create_operation(merchant_id,key_hash,request_hash,payment_id) VALUES(:merchant,:key,:hash,:id)")
                    .param("merchant", merchant)
                    .param("key", keyHash)
                    .param("hash", fingerprint)
                    .param("id", id)
                    .update();
            jdbc.sql(
                            "INSERT INTO audit_event(id,actor,action,aggregate_id,details) VALUES(:id,:actor,'PAYMENT_RECEIVED',:number,'{}')")
                    .param("id", UUID.randomUUID())
                    .param("actor", actor)
                    .param("number", number)
                    .update();
            return new CreateClaim(id, number, request.rail(), true);
        });
        if (claimed == null) throw new IllegalStateException("Create claim returned no state");
        if (claimed.created()) process(claimed.id(), claimed.paymentNumber(), claimed.rail(), actor, 0);
        return new PaymentCreateResult(detail(claimed.paymentNumber()), claimed.created());
    }

    private static String digest(String value) {
        try {
            return java.util.HexFormat.of()
                    .formatHex(java.security.MessageDigest.getInstance("SHA-256")
                            .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private record ExistingOperation(String requestHash, UUID id, String paymentNumber, String rail) {}

    private record CreateClaim(UUID id, String paymentNumber, String rail, boolean created) {}

    public PaymentDetail replay(String paymentNumber, String actor) {
        var state = transactions.execute(ignored -> {
            var candidate = jdbc.sql(
                            """
                    SELECT p.id,p.rail,p.version,p.status
                    FROM payment_instruction p
                    WHERE p.payment_number=:number FOR UPDATE OF p
                    """)
                    .param("number", paymentNumber)
                    .query(ReplayCandidate.class)
                    .optional()
                    .orElseThrow(() -> new PaymentProcessingException("Payment not found"));
            if (!"PARKED".equals(candidate.status())) throw new PaymentProcessingException("Payment is not parked");
            // Read permission in a new statement after the instruction lock has been acquired.
            // A join read taken before waiting could retain an earlier attempt's permission.
            boolean permitted = jdbc.sql("SELECT replay_permitted FROM parked_payment WHERE payment_id=:id")
                    .param("id", candidate.id())
                    .query(Boolean.class)
                    .optional()
                    .orElse(false);
            if (!permitted) throw new PaymentReconciliationRequiredException();
            var claimed = jdbc.sql(
                            """
                        UPDATE payment_instruction
                        SET status='PROCESSING', version=version+1, updated_at=NOW()
                        WHERE payment_number=:number AND status='PARKED'
                        RETURNING id, rail, version
                        """)
                    .param("number", paymentNumber)
                    .query(PaymentState.class)
                    .optional()
                    .orElseThrow(() -> new PaymentProcessingException("Payment is missing or is not parked"));
            jdbc.sql(
                            "UPDATE parked_payment SET replay_count=replay_count+1, last_replayed_at=NOW(), replay_permitted=FALSE WHERE payment_id=:id")
                    .param("id", claimed.id())
                    .update();
            return claimed;
        });
        if (state == null) throw new IllegalStateException("Replay claim returned no state");
        process(state.id(), paymentNumber, state.rail(), actor, state.version());
        return detail(paymentNumber);
    }

    private void process(UUID id, String number, String rail, String actor, long claimedVersion) {
        var result = gateway.authorize(rail);
        transactions.executeWithoutResult(ignored -> {
            String status = result.success() ? "SUCCEEDED" : "PARKED";
            int finalized = jdbc.sql(
                            "UPDATE payment_instruction SET status=:status, version=version+1, updated_at=NOW() WHERE id=:id AND status='PROCESSING' AND version=:version")
                    .param("status", status)
                    .param("id", id)
                    .param("version", claimedVersion)
                    .update();
            // Recovery or another claim owns the instruction now. A late result cannot mutate it.
            if (finalized == 0) return;
            int attempt = jdbc.sql("SELECT COUNT(*) + 1 FROM payment_attempt WHERE payment_id=:id")
                    .param("id", id)
                    .query(Integer.class)
                    .single();
            jdbc.sql(
                            "INSERT INTO payment_attempt (id,payment_id,attempt_number,outcome,latency_ms,detail) VALUES (:attemptId,:id,:number,:outcome,:latency,:detail)")
                    .param("attemptId", UUID.randomUUID())
                    .param("id", id)
                    .param("number", attempt)
                    .param("outcome", result.outcome())
                    .param("latency", result.latencyMs())
                    .param(
                            "detail",
                            result.success()
                                    ? "Downstream authorization completed"
                                    : result.replayPermitted()
                                            ? "No execution confirmed; controlled replay permitted"
                                            : "Provider outcome unverified; reconciliation required before authorization")
                    .update();
            if (result.success()) {
                jdbc.sql("DELETE FROM parked_payment WHERE payment_id=:id")
                        .param("id", id)
                        .update();
            } else {
                jdbc.sql(
                                "INSERT INTO parked_payment(payment_id,reason,replay_permitted) VALUES (:id,:reason,:safe) ON CONFLICT(payment_id) DO UPDATE SET reason=EXCLUDED.reason, replay_permitted=EXCLUDED.replay_permitted, parked_at=NOW()")
                        .param("id", id)
                        .param("reason", result.outcome())
                        .param("safe", result.replayPermitted())
                        .update();
            }
            jdbc.sql(
                            "INSERT INTO audit_event(id,actor,action,aggregate_id,details) VALUES (:id,:actor,:action,:aggregate,CAST(:details AS JSONB))")
                    .param("id", UUID.randomUUID())
                    .param("actor", actor)
                    .param("action", result.success() ? "PAYMENT_SUCCEEDED" : "PAYMENT_PARKED")
                    .param("aggregate", number)
                    .param("details", "{\"rail\":\"" + rail + "\",\"outcome\":\"" + result.outcome() + "\"}")
                    .update();
        });
    }

    public List<PaymentSummary> parked() {
        return jdbc.sql(
                        "SELECT p.payment_number,p.merchant_id,p.rail,p.amount_minor,p.currency,p.status,p.created_at FROM payment_instruction p JOIN parked_payment pp ON pp.payment_id=p.id ORDER BY pp.parked_at DESC LIMIT 100")
                .query(PaymentSummary.class)
                .list();
    }

    public List<RailView> rails() {
        return jdbc.sql(
                        "SELECT rail,display_name,failure_mode,simulated_delay_ms,updated_at FROM rail_configuration ORDER BY rail")
                .query((rs, row) -> {
                    var rail = rs.getString("rail");
                    var circuit = gateway.circuit(rail);
                    return new RailView(
                            rail,
                            rs.getString("display_name"),
                            rs.getString("failure_mode"),
                            rs.getInt("simulated_delay_ms"),
                            circuit.getState().name(),
                            circuit.getMetrics().getNumberOfBufferedCalls(),
                            rs.getTimestamp("updated_at").toInstant());
                })
                .list();
    }

    public ReliabilityOverview overview() {
        var counts = jdbc.sql(
                        "SELECT COUNT(*) throughput, COUNT(*) FILTER(WHERE status='SUCCEEDED') succeeded, COUNT(*) FILTER(WHERE status='PROCESSING') processing, COUNT(*) FILTER(WHERE status='PARKED') parked FROM payment_instruction")
                .query(Counts.class)
                .single();
        long age = jdbc.sql("SELECT COALESCE(EXTRACT(EPOCH FROM NOW()-MIN(parked_at))::bigint,0) FROM parked_payment")
                .query(Long.class)
                .single();
        return new ReliabilityOverview(
                counts.throughput(),
                counts.succeeded(),
                counts.processing(),
                counts.parked(),
                counts.throughput() == 0 ? 100 : counts.succeeded() * 100.0 / counts.throughput(),
                age,
                rails());
    }

    @Transactional
    public RailView configureRail(String rail, FaultProfileRequest request) {
        int changed = jdbc.sql(
                        "UPDATE rail_configuration SET failure_mode=:mode, simulated_delay_ms=:delay, updated_at=NOW() WHERE rail=:rail")
                .param("mode", request.failureMode())
                .param("delay", request.delayMs())
                .param("rail", rail)
                .update();
        if (changed == 0) throw new PaymentProcessingException("Rail not found");
        if ("NORMAL".equals(request.failureMode())) gateway.circuit(rail).reset();
        return rails().stream()
                .filter(item -> item.rail().equals(rail))
                .findFirst()
                .orElseThrow();
    }

    private record PaymentState(UUID id, String rail, long version) {}

    private record ReplayCandidate(UUID id, String rail, long version, String status) {}

    private record Counts(long throughput, long succeeded, long processing, long parked) {}
}
