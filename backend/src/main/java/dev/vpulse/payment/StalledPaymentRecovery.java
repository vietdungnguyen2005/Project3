package dev.vpulse.payment;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class StalledPaymentRecovery {
    private final JdbcClient jdbc;

    public StalledPaymentRecovery(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(fixedDelayString = "${vpulse.recovery-interval-ms:60000}")
    @Transactional
    public void parkStalledInstructions() {
        var stalled = jdbc.sql(
                        """
                        UPDATE payment_instruction
                        SET status='PARKED', version=version+1, updated_at=NOW()
                        WHERE status='PROCESSING' AND updated_at < NOW() - INTERVAL '2 minutes'
                        RETURNING id, payment_number
                        """)
                .query(StalledInstruction.class)
                .list();
        stalled.forEach(instruction -> {
            jdbc.sql(
                            "INSERT INTO parked_payment(payment_id, reason) VALUES (:id, 'PROCESS_INTERRUPTED') ON CONFLICT(payment_id) DO NOTHING")
                    .param("id", instruction.id())
                    .update();
            jdbc.sql(
                            "INSERT INTO audit_event(id,actor,action,aggregate_id,details) VALUES (:id,'system-reconciler','PAYMENT_PARKED',:number,'{\"reason\":\"PROCESS_INTERRUPTED\"}')")
                    .param("id", UUID.randomUUID())
                    .param("number", instruction.paymentNumber())
                    .update();
        });
    }

    private record StalledInstruction(UUID id, String paymentNumber) {}
}
