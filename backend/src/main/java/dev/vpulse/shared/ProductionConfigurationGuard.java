package dev.vpulse.shared;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class ProductionConfigurationGuard {
    private final String environment;
    private final String bffSecret;
    private final String opsSecret;

    public ProductionConfigurationGuard(
            @Value("${vpulse.deployment-environment}") String environment,
            @Value("${vpulse.bff-secret}") String bffSecret,
            @Value("${vpulse.ops-secret}") String opsSecret) {
        this.environment = environment;
        this.bffSecret = bffSecret;
        this.opsSecret = opsSecret;
    }

    @PostConstruct
    void validate() {
        if ("production".equalsIgnoreCase(environment)
                && (bffSecret.length() < 32
                        || opsSecret.length() < 32
                        || bffSecret.equals(opsSecret)
                        || bffSecret.startsWith("local-")
                        || opsSecret.startsWith("local-"))) {
            throw new IllegalStateException("Strong, distinct production secrets are required.");
        }
    }
}
