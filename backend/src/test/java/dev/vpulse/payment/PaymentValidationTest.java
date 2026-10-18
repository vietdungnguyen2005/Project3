package dev.vpulse.payment;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

class PaymentValidationTest {
    @Test
    void rejectsMissingRailCurrencyAndFaultMode() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertThat(validator.validate(new CreatePaymentRequest("merchant", null, 1000, null)))
                    .extracting(violation -> violation.getPropertyPath().toString())
                    .contains("rail", "currency");
            assertThat(validator.validate(new FaultProfileRequest(null, 0)))
                    .anyMatch(
                            violation -> violation.getPropertyPath().toString().equals("failureMode"));
        }
    }
}
