package dev.vpulse.payment;

public class PaymentReconciliationRequiredException extends RuntimeException {
    public PaymentReconciliationRequiredException() {
        super(
                "The earlier provider outcome is unverified. Do not authorize again; reconcile the original operation or request manual investigation.");
    }
}
