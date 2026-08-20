package dev.vpulse.payment;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class PaymentController {
    private final PaymentService paymentService;
    private final OpsAuthorizer opsAuthorizer;

    public PaymentController(PaymentService paymentService, OpsAuthorizer opsAuthorizer) {
        this.paymentService = paymentService;
        this.opsAuthorizer = opsAuthorizer;
    }

    @GetMapping("/reliability/overview")
    ReliabilityOverview overview() {
        return paymentService.overview();
    }

    @GetMapping("/payments")
    PaymentWindow payments(
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "200") int limit,
            @RequestParam(required = false) String status) {
        return paymentService.list(offset, limit, status);
    }

    @GetMapping("/payments/{paymentNumber}")
    PaymentDetail payment(@PathVariable String paymentNumber) {
        return paymentService.detail(paymentNumber);
    }

    @PostMapping("/payments")
    @ResponseStatus(HttpStatus.CREATED)
    PaymentDetail create(@Valid @RequestBody CreatePaymentRequest request) {
        return paymentService.create(request);
    }

    @GetMapping("/parking")
    List<PaymentSummary> parking() {
        return paymentService.parked();
    }

    @PostMapping("/parking/{paymentNumber}/replay")
    PaymentDetail replay(@PathVariable String paymentNumber, @RequestHeader("X-V-Pulse-Ops-Secret") String opsSecret) {
        opsAuthorizer.requireAuthorized(opsSecret);
        return paymentService.replay(paymentNumber);
    }

    @GetMapping("/rails")
    List<RailView> rails() {
        return paymentService.rails();
    }

    @PostMapping("/demo/rails/{rail}/fault-profile")
    RailView configureRail(
            @PathVariable String rail,
            @Valid @RequestBody FaultProfileRequest request,
            @RequestHeader("X-V-Pulse-Ops-Secret") String opsSecret) {
        opsAuthorizer.requireAuthorized(opsSecret);
        return paymentService.configureRail(rail, request);
    }
}
