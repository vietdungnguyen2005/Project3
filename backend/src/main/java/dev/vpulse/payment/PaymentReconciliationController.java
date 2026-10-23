package dev.vpulse.payment;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/payments/{number}")
public class PaymentReconciliationController {
    private final PaymentReconciliationService reconciliation;
    private final OpsAuthorizer authorizer;

    public PaymentReconciliationController(PaymentReconciliationService reconciliation, OpsAuthorizer authorizer) {
        this.reconciliation = reconciliation;
        this.authorizer = authorizer;
    }

    @PostMapping("/reconciliation")
    org.springframework.http.ResponseEntity<PaymentReconciliationService.Evidence> reconcile(
            @PathVariable String number,
            @RequestHeader("X-V-Pulse-Ops-Secret") String secret,
            java.security.Principal actor) {
        authorizer.requireAuthorized(secret);
        var result = reconciliation.reconcile(number, actor.getName());
        return org.springframework.http.ResponseEntity.status(result.state().equals("IN_PROGRESS") ? 202 : 200)
                .body(result);
    }

    @PostMapping("/reconciliation/{id}/resolve")
    PaymentReconciliationService.Evidence resolve(
            @PathVariable String number,
            @PathVariable java.util.UUID id,
            @RequestHeader("X-V-Pulse-Ops-Secret") String secret,
            java.security.Principal actor) {
        authorizer.requireAuthorized(secret);
        return reconciliation.resolve(number, id, actor.getName());
    }

    @GetMapping("/investigation")
    PaymentReconciliationService.Investigation investigate(
            @PathVariable String number, @RequestHeader("X-V-Pulse-Ops-Secret") String secret) {
        authorizer.requireAuthorized(secret);
        return reconciliation.investigate(number);
    }
}
