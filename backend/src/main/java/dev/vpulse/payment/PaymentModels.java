package dev.vpulse.payment;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

record CreatePaymentRequest(
        @NotBlank @Size(max = 40) String merchantId,
        @Pattern(regexp = "ZENGIN|CARD|SWIFT") String rail,
        @Min(1) @Max(1_000_000_000_000L) long amountMinor,
        @Pattern(regexp = "JPY") String currency) {}

record PaymentSummary(
        String paymentNumber,
        String merchantId,
        String rail,
        long amountMinor,
        String currency,
        String status,
        Instant createdAt) {}

record PaymentWindow(List<PaymentSummary> rows, long total, int offset, int limit) {}

record PaymentAttemptView(int attemptNumber, String outcome, int latencyMs, String detail, Instant createdAt) {}

record PaymentDetail(PaymentSummary payment, List<PaymentAttemptView> attempts, String parkedReason) {}

record RailView(
        String rail,
        String displayName,
        String failureMode,
        int simulatedDelayMs,
        String circuitState,
        int bufferedCalls,
        Instant updatedAt) {}

record ReliabilityOverview(
        long throughput,
        long succeeded,
        long processing,
        long parked,
        double successRate,
        long oldestParkedSeconds,
        List<RailView> rails) {}

record FaultProfileRequest(
        @Pattern(regexp = "NORMAL|TIMEOUT|REJECT") String failureMode, @Min(0) @Max(5000) int delayMs) {}
