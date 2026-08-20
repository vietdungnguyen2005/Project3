package dev.vpulse.shared;

import dev.vpulse.payment.OperationsAuthorizationException;
import dev.vpulse.payment.PaymentProcessingException;
import dev.vpulse.payment.RateLimitExceededException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(PaymentProcessingException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    Map<String, String> paymentFailure(PaymentProcessingException exception) {
        return error("PAYMENT_OPERATION_REJECTED", exception.getMessage());
    }

    @ExceptionHandler(RateLimitExceededException.class)
    @ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
    Map<String, String> rateLimited() {
        return error("MERCHANT_RATE_LIMITED", "Merchant request budget exhausted. Retry in one minute.");
    }

    @ExceptionHandler(OperationsAuthorizationException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    Map<String, String> forbidden() {
        return error("OPS_AUTH_REQUIRED", "Operations authorization required.");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    Map<String, String> invalid(MethodArgumentNotValidException exception) {
        var fieldError = exception.getBindingResult().getFieldError();
        return error(
                "INVALID_REQUEST",
                fieldError == null ? "Request validation failed." : fieldError.getField() + " is invalid.");
    }

    private Map<String, String> error(String code, String message) {
        return Map.of("code", code, "message", message);
    }
}
