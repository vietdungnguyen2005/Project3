package dev.vpulse.payment;

/** Read-only external-outcome contract; lookup never grants authorization or executes money movement. */
public interface ProviderOutcomeLookup {
    record Operation(String reference, String rail, String merchantId, long amountMinor, String currency) {
        String fingerprint() {
            try {
                return java.util.HexFormat.of()
                        .formatHex(java.security.MessageDigest.getInstance("SHA-256")
                                .digest(("vpulse-provider:v1\n" + rail + "\n" + merchantId + "\n" + amountMinor + "\n"
                                                + currency)
                                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            } catch (java.security.NoSuchAlgorithmException failure) {
                throw new IllegalStateException(failure);
            }
        }
    }

    record Observation(String outcome, String evidenceCode) {}

    Observation lookup(Operation operation) throws InterruptedException;
}
