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

    public PaymentDetail create(CreatePaymentRequest request) {
        if (!rateLimiter.allow(request.merchantId())) throw new RateLimitExceededException();
        UUID id = UUID.randomUUID();
        String number = "VP-" + id.toString().replace("-", "").substring(0, 12).toUpperCase();
        jdbc.sql(
                        "INSERT INTO payment_instruction (id, payment_number, merchant_id, rail, amount_minor, currency, status) VALUES (:id,:number,:merchant,:rail,:amount,:currency,'PROCESSING')")
                .param("id", id)
                .param("number", number)
                .param("merchant", request.merchantId().trim())
                .param("rail", request.rail())
                .param("amount", request.amountMinor())
                .param("currency", request.currency())
                .update();
        process(id, number, request.rail(), "system-ingress");
        return detail(number);
    }

    public PaymentDetail replay(String paymentNumber) {
        var state = jdbc.sql(
                        """
                        UPDATE payment_instruction
                        SET status='PROCESSING', version=version+1, updated_at=NOW()
                        WHERE payment_number=:number AND status='PARKED'
                        RETURNING id, rail
                        """)
                .param("number", paymentNumber)
                .query(PaymentState.class)
                .optional()
                .orElseThrow(() -> new PaymentProcessingException("Payment is missing or is not parked"));
        jdbc.sql("UPDATE parked_payment SET replay_count=replay_count+1, last_replayed_at=NOW() WHERE payment_id=:id")
                .param("id", state.id())
                .update();
        process(state.id(), paymentNumber, state.rail(), "operations-replay");
        return detail(paymentNumber);
    }

    private void process(UUID id, String number, String rail, String actor) {
        var result = gateway.authorize(rail);
        transactions.executeWithoutResult(ignored -> {
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
                                    : "Request parked for safe operator recovery")
                    .update();
            String status = result.success() ? "SUCCEEDED" : "PARKED";
            jdbc.sql("UPDATE payment_instruction SET status=:status, version=version+1, updated_at=NOW() WHERE id=:id")
                    .param("status", status)
                    .param("id", id)
                    .update();
            if (result.success()) {
                jdbc.sql("DELETE FROM parked_payment WHERE payment_id=:id")
                        .param("id", id)
                        .update();
            } else {
                jdbc.sql(
                                "INSERT INTO parked_payment(payment_id,reason) VALUES (:id,:reason) ON CONFLICT(payment_id) DO UPDATE SET reason=EXCLUDED.reason, parked_at=NOW()")
                        .param("id", id)
                        .param("reason", result.outcome())
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

    private record PaymentState(UUID id, String rail) {}

    private record Counts(long throughput, long succeeded, long processing, long parked) {}
}
