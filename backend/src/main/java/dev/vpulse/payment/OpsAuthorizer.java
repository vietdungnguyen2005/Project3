package dev.vpulse.payment;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class OpsAuthorizer {
    private final byte[] expected;

    public OpsAuthorizer(@Value("${vpulse.ops-secret}") String secret) {
        this.expected = secret.getBytes(StandardCharsets.UTF_8);
    }

    void requireAuthorized(String provided) {
        if (!MessageDigest.isEqual(expected, provided.getBytes(StandardCharsets.UTF_8))) {
            throw new OperationsAuthorizationException();
        }
    }
}
