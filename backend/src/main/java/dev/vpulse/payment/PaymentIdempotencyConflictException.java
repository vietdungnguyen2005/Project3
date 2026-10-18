package dev.vpulse.payment;

public class PaymentIdempotencyConflictException extends RuntimeException {
    public PaymentIdempotencyConflictException() {
        super(
                "This merchant operation key belongs to different payment details. Keep the original key and inspect its instruction.");
    }
}
