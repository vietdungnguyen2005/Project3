package dev.vpulse.payment;

import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class PaymentReconciliationService {
    private final JdbcClient jdbc;
    private final ProviderOutcomeLookup provider;
    private final TransactionTemplate transactions;
    private final io.micrometer.core.instrument.MeterRegistry metrics;
    private final java.util.concurrent.Semaphore lookups = new java.util.concurrent.Semaphore(4);
    private final PaymentService payments;

    public PaymentReconciliationService(
            JdbcClient jdbc,
            ProviderOutcomeLookup provider,
            PlatformTransactionManager manager,
            io.micrometer.core.instrument.MeterRegistry metrics,
            PaymentService payments) {
        this.jdbc = jdbc;
        this.provider = provider;
        this.transactions = new TransactionTemplate(manager);
        this.metrics = metrics;
        transactions.setTimeout(10);
        this.payments = payments;
        io.micrometer.core.instrument.Gauge.builder("vpulse.reconciliation.oldest.unresolved.seconds", jdbc, db -> {
                    try {
                        return db.sql(
                                        "SELECT COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-MIN(created_at)),0) FROM payment_instruction WHERE status='PARKED'")
                                .query(Double.class)
                                .single();
                    } catch (org.springframework.dao.DataAccessException unavailable) {
                        return Double.NaN;
                    }
                })
                .register(metrics);
    }

    public record Evidence(
            UUID id,
            String providerReference,
            long paymentVersion,
            String state,
            String outcome,
            String evidenceCode,
            String requestedBy,
            String resolvedBy,
            String requestId,
            Instant createdAt,
            Instant observedAt,
            Instant resolvedAt,
            Instant leaseUntil) {}

    record Binding(
            UUID id,
            String status,
            long version,
            String providerReference,
            String rail,
            String merchantId,
            long amountMinor,
            String currency) {
        ProviderOutcomeLookup.Operation operation() {
            return new ProviderOutcomeLookup.Operation(providerReference, rail, merchantId, amountMinor, currency);
        }
    }

    private record Claim(Evidence evidence, Binding binding, boolean owned) {}

    private static final String EVIDENCE =
            "id,provider_reference,payment_version,state,outcome,evidence_code,requested_by,resolved_by,request_id,created_at,observed_at,resolved_at,lease_until";

    public Evidence reconcile(String number, String actor) {
        Claim claim = transactions.execute(status -> {
            limits();
            var payment = binding(number, true);
            var active = jdbc.sql("SELECT " + EVIDENCE
                            + " FROM payment_reconciliation WHERE payment_id=:id AND state='IN_PROGRESS'")
                    .param("id", payment.id())
                    .query(Evidence.class)
                    .optional();
            if (active.isPresent()) {
                var old = active.get();
                if (leaseValid(old.id())) return new Claim(old, payment, false);
                interrupt(old.id(), number, actor, "LOOKUP_INTERRUPTED_RETRY_READ_ONLY");
            }
            var verified = jdbc.sql(
                            "SELECT " + EVIDENCE
                                    + " FROM payment_reconciliation WHERE payment_id=:id AND state IN ('OBSERVED','RESOLVED') AND outcome IN ('VERIFIED_SUCCESS','VERIFIED_REJECTION') ORDER BY created_at DESC LIMIT 1")
                    .param("id", payment.id())
                    .query(Evidence.class)
                    .optional();
            if (verified.isPresent()
                    && (verified.get().state().equals("RESOLVED")
                                    && payment.status().equals("SUCCEEDED")
                            || verified.get().paymentVersion() == payment.version()
                                    && java.util.Objects.equals(
                                            verified.get().providerReference(), payment.providerReference())))
                return new Claim(verified.get(), payment, false);
            if (!payment.status().equals("PARKED"))
                throw new PaymentProcessingException(
                        "Only a parked instruction can be investigated; refresh its current state.");
            UUID id = UUID.randomUUID();
            jdbc.sql("UPDATE parked_payment SET replay_permitted=FALSE WHERE payment_id=:id")
                    .param("id", payment.id())
                    .update();
            jdbc.sql(
                            """
                    INSERT INTO payment_reconciliation(id,payment_id,provider_reference,payment_version,state,requested_by,request_id,lease_until)
                    VALUES(:id,:payment,:reference,:version,'IN_PROGRESS',:actor,:request,clock_timestamp()+INTERVAL '30 seconds')
                    """)
                    .param("id", id)
                    .param("payment", payment.id())
                    .param("reference", payment.providerReference())
                    .param("version", payment.version())
                    .param("actor", actor)
                    .param("request", org.slf4j.MDC.get("requestId"))
                    .update();
            audit(number, actor, "RECONCILIATION_REQUESTED", id, "IN_PROGRESS");
            return new Claim(evidence(id), payment, true);
        });
        if (claim == null) throw new IllegalStateException("Missing reconciliation claim");
        if (!claim.owned()) return claim.evidence();
        long started = System.nanoTime();
        var observation = lookup(claim.binding());
        var result = transactions.execute(status -> {
            limits();
            var current = binding(number, true);
            var run = evidence(claim.evidence().id());
            if (!run.state().equals("IN_PROGRESS")) return run;
            if (!leaseValid(run.id())
                    || current.version() != run.paymentVersion()
                    || !java.util.Objects.equals(current.providerReference(), run.providerReference())
                    || !current.status().equals("PARKED")) {
                interrupt(run.id(), number, actor, "STALE_LOOKUP_CANNOT_RESOLVE");
                return evidence(run.id());
            }
            jdbc.sql(
                            "UPDATE payment_reconciliation SET state='OBSERVED',outcome=:outcome,evidence_code=:code,observed_at=clock_timestamp() WHERE id=:id")
                    .param("id", run.id())
                    .param("outcome", observation.outcome())
                    .param("code", observation.evidenceCode())
                    .update();
            audit(number, actor, "RECONCILIATION_OBSERVED", run.id(), observation.outcome());
            return evidence(run.id());
        });
        metrics.counter("vpulse.reconciliation.attempts", "outcome", result.outcome())
                .increment();
        if (result.outcome().equals("PROVIDER_UNAVAILABLE"))
            metrics.counter("vpulse.reconciliation.lookup.failures").increment();
        metrics.timer("vpulse.reconciliation.latency")
                .record(System.nanoTime() - started, java.util.concurrent.TimeUnit.NANOSECONDS);
        return result;
    }

    private ProviderOutcomeLookup.Observation lookup(Binding payment) {
        if (payment.providerReference() == null)
            return new ProviderOutcomeLookup.Observation("UNKNOWN", "HISTORICAL_REFERENCE_MISSING");
        if (!lookups.tryAcquire())
            return new ProviderOutcomeLookup.Observation("PROVIDER_UNAVAILABLE", "LOOKUP_CAPACITY_EXHAUSTED");
        var result = new java.util.concurrent.CompletableFuture<ProviderOutcomeLookup.Observation>();
        Thread worker = Thread.startVirtualThread(() -> {
            try {
                result.complete(provider.lookup(payment.operation()));
            } catch (Exception failure) {
                result.complete(new ProviderOutcomeLookup.Observation("PROVIDER_UNAVAILABLE", "LOOKUP_FAILED"));
            } finally {
                lookups.release();
            }
        });
        try {
            return result.get(3, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException failure) {
            worker.interrupt();
            Thread.currentThread().interrupt();
            return new ProviderOutcomeLookup.Observation("PROVIDER_UNAVAILABLE", "LOOKUP_INTERRUPTED");
        } catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException failure) {
            worker.interrupt();
            return new ProviderOutcomeLookup.Observation("PROVIDER_UNAVAILABLE", "LOOKUP_DEADLINE_EXCEEDED");
        }
    }

    public Evidence resolve(String number, UUID id, String actor) {
        return transactions.execute(status -> {
            limits();
            var payment = binding(number, true);
            if (!jdbc.sql("SELECT EXISTS(SELECT 1 FROM payment_reconciliation WHERE id=:id AND payment_id=:payment)")
                    .param("id", id)
                    .param("payment", payment.id())
                    .query(Boolean.class)
                    .single()) throw new PaymentProcessingException("Evidence does not belong to this instruction.");
            var run = evidence(id);
            if (run.state().equals("RESOLVED")) return run;
            if (!run.state().equals("OBSERVED")
                    || !java.util.Set.of("VERIFIED_SUCCESS", "VERIFIED_REJECTION")
                            .contains(run.outcome() == null ? "" : run.outcome())
                    || !payment.status().equals("PARKED")
                    || payment.version() != run.paymentVersion()
                    || !java.util.Objects.equals(payment.providerReference(), run.providerReference()))
                throw new PaymentProcessingException(
                        "Resolution requires current verified provider evidence. Unknown, expired-claim or stale decisions cannot grant replay.");
            boolean success = run.outcome().equals("VERIFIED_SUCCESS");
            jdbc.sql(
                            "UPDATE payment_instruction SET status=:status,version=version+1,updated_at=clock_timestamp() WHERE id=:id")
                    .param("status", success ? "SUCCEEDED" : "PARKED")
                    .param("id", payment.id())
                    .update();
            if (success)
                jdbc.sql("DELETE FROM parked_payment WHERE payment_id=:id")
                        .param("id", payment.id())
                        .update();
            else
                jdbc.sql(
                                "UPDATE parked_payment SET reason='PROVIDER_REJECTED',replay_permitted=TRUE WHERE payment_id=:id")
                        .param("id", payment.id())
                        .update();
            jdbc.sql(
                            "UPDATE payment_reconciliation SET state='RESOLVED',resolved_by=:actor,resolved_at=clock_timestamp() WHERE id=:id")
                    .param("actor", actor)
                    .param("id", id)
                    .update();
            audit(number, actor, "RECONCILIATION_RESOLVED", id, run.outcome());
            return evidence(id);
        });
    }

    public record Audit(String actor, String action, Instant createdAt) {}

    public record Investigation(
            PaymentDetail detail,
            String providerReference,
            boolean replayPermitted,
            String nextAction,
            java.util.List<Evidence> evidence,
            java.util.List<Audit> audit) {}

    @org.springframework.transaction.annotation.Transactional(
            readOnly = true,
            isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ,
            timeout = 10)
    public Investigation investigate(String number) {
        var payment = binding(number, false);
        boolean permitted = jdbc.sql("SELECT replay_permitted FROM parked_payment WHERE payment_id=:id")
                .param("id", payment.id())
                .query(Boolean.class)
                .optional()
                .orElse(false);
        var history = jdbc.sql("SELECT " + EVIDENCE
                        + " FROM payment_reconciliation WHERE payment_id=:id ORDER BY created_at DESC,id DESC LIMIT 20")
                .param("id", payment.id())
                .query(Evidence.class)
                .list();
        String action = "NONE";
        var latest = history.isEmpty() ? null : history.getFirst();
        if (payment.status().equals("SUCCEEDED")
                && latest != null
                && latest.state().equals("RESOLVED")) action = "ALREADY_RECONCILED";
        else if (payment.status().equals("PARKED")) {
            if (latest != null && latest.state().equals("IN_PROGRESS") && leaseValid(latest.id()))
                action = "WAIT_FOR_LOOKUP";
            else if (latest != null
                    && latest.state().equals("OBSERVED")
                    && latest.paymentVersion() == payment.version()
                    && java.util.Objects.equals(latest.providerReference(), payment.providerReference())
                    && "VERIFIED_SUCCESS".equals(latest.outcome())) action = "CONFIRM_SUCCESS";
            else if (latest != null
                    && latest.state().equals("OBSERVED")
                    && latest.paymentVersion() == payment.version()
                    && java.util.Objects.equals(latest.providerReference(), payment.providerReference())
                    && "VERIFIED_REJECTION".equals(latest.outcome())) action = "CONFIRM_REJECTION";
            else if (permitted) action = "CONTROLLED_REPLAY_ALLOWED";
            else action = payment.providerReference() == null ? "MANUAL_REVIEW" : "RECONCILE_PROVIDER";
        }
        var audit = jdbc.sql(
                        "SELECT actor,action,created_at FROM audit_event WHERE aggregate_id=:number ORDER BY created_at DESC,id DESC LIMIT 50")
                .param("number", number)
                .query(Audit.class)
                .list();
        return new Investigation(
                payments.detail(number), payment.providerReference(), permitted, action, history, audit);
    }

    Binding binding(String number, boolean lock) {
        return jdbc.sql(
                        "SELECT id,status,version,provider_reference,rail,merchant_id,amount_minor,currency FROM payment_instruction WHERE payment_number=:number"
                                + (lock ? " FOR UPDATE" : ""))
                .param("number", number)
                .query(Binding.class)
                .optional()
                .orElseThrow(() -> new PaymentProcessingException("Payment not found"));
    }

    Evidence evidence(UUID id) {
        return jdbc.sql("SELECT " + EVIDENCE + " FROM payment_reconciliation WHERE id=:id")
                .param("id", id)
                .query(Evidence.class)
                .single();
    }

    private boolean leaseValid(UUID id) {
        return jdbc.sql("SELECT lease_until>clock_timestamp() FROM payment_reconciliation WHERE id=:id")
                .param("id", id)
                .query(Boolean.class)
                .single();
    }

    private void interrupt(UUID id, String number, String actor, String code) {
        jdbc.sql(
                        "UPDATE payment_reconciliation SET state='INTERRUPTED',outcome='INTERRUPTED',evidence_code=:code,observed_at=clock_timestamp() WHERE id=:id AND state='IN_PROGRESS'")
                .param("id", id)
                .param("code", code)
                .update();
        audit(number, actor, "RECONCILIATION_INTERRUPTED", id, "INTERRUPTED");
    }

    private void limits() {
        jdbc.sql("SET LOCAL lock_timeout='3s'").update();
        jdbc.sql("SET LOCAL statement_timeout='5s'").update();
    }

    void audit(String number, String actor, String action, UUID run, String outcome) {
        jdbc.sql(
                        "INSERT INTO audit_event(id,actor,action,aggregate_id,details) VALUES(:id,:actor,:action,:number,jsonb_build_object('reconciliationId',CAST(:run AS text),'outcome',CAST(:outcome AS text)))")
                .param("id", UUID.randomUUID())
                .param("actor", actor)
                .param("action", action)
                .param("number", number)
                .param("run", run.toString())
                .param("outcome", outcome)
                .update();
    }
}
