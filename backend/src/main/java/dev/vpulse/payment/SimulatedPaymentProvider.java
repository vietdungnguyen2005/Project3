package dev.vpulse.payment;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Synthetic authoritative record; separate commit from local instructions, same demo database availability. */
@Component
public class SimulatedPaymentProvider implements ProviderOutcomeLookup {
    private final JdbcClient jdbc;

    public SimulatedPaymentProvider(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 5)
    public String authorize(Operation operation, String mode) {
        String outcome =
                switch (mode) {
                    case "REJECT" -> "REJECTED";
                    case "TIMEOUT" -> "INCOMPLETE";
                    default -> "AUTHORIZED";
                };
        return jdbc.sql(
                        """
                INSERT INTO simulated_provider_ledger(reference,payload_hash,outcome) VALUES(:reference,:hash,:outcome)
                ON CONFLICT(reference) DO UPDATE SET authorization_calls=simulated_provider_ledger.authorization_calls+1
                  WHERE simulated_provider_ledger.payload_hash=EXCLUDED.payload_hash
                RETURNING outcome
                """)
                .param("reference", operation.reference())
                .param("hash", operation.fingerprint())
                .param("outcome", outcome)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new IllegalStateException("Provider operation identity conflict"));
    }

    @Override
    @Transactional(readOnly = true, timeout = 5)
    public Observation lookup(Operation operation) throws InterruptedException {
        var config = jdbc.sql("SELECT mode,delay_ms FROM provider_lookup_configuration WHERE rail=:rail")
                .param("rail", operation.rail())
                .query(Configuration.class)
                .single();
        Thread.sleep(config.delayMs());
        if (config.mode().equals("UNAVAILABLE"))
            return new Observation("PROVIDER_UNAVAILABLE", "SIMULATED_LOOKUP_UNAVAILABLE");
        if (config.mode().equals("UNKNOWN")) return new Observation("UNKNOWN", "PROVIDER_RESULT_INCOMPLETE");
        return jdbc.sql("SELECT payload_hash,outcome FROM simulated_provider_ledger WHERE reference=:reference")
                .param("reference", operation.reference())
                .query((rs, row) -> {
                    if (!rs.getString("payload_hash").equals(operation.fingerprint()))
                        return new Observation("UNKNOWN", "PROVIDER_IDENTITY_MISMATCH");
                    return switch (rs.getString("outcome")) {
                        case "AUTHORIZED" -> new Observation("VERIFIED_SUCCESS", "SIMULATOR_AUTHORIZATION_RECORDED");
                        case "REJECTED" ->
                            new Observation("VERIFIED_REJECTION", "SIMULATOR_FINAL_REJECTION_NO_EXECUTION");
                        default -> new Observation("UNKNOWN", "PROVIDER_RESULT_INCOMPLETE");
                    };
                })
                .optional()
                .orElse(new Observation("NOT_FOUND", "NO_RECORD_IS_NOT_NO_EXECUTION"));
    }

    private record Configuration(String mode, int delayMs) {}
}
