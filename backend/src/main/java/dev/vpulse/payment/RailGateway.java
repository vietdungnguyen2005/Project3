package dev.vpulse.payment;

import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
public class RailGateway {
    private static final int TIMEOUT_MS = 250;
    private final JdbcClient jdbc;
    private final MeterRegistry metrics;
    private final CircuitBreakerRegistry circuits;
    private final Map<String, Semaphore> bulkheads = new ConcurrentHashMap<>();

    public RailGateway(JdbcClient jdbc, MeterRegistry metrics) {
        this.jdbc = jdbc;
        this.metrics = metrics;
        var config = CircuitBreakerConfig.custom()
                .failureRateThreshold(50)
                .slidingWindowSize(4)
                .minimumNumberOfCalls(4)
                .waitDurationInOpenState(Duration.ofSeconds(5))
                .permittedNumberOfCallsInHalfOpenState(1)
                .build();
        this.circuits = CircuitBreakerRegistry.of(config);
    }

    public RailResult authorize(String rail) {
        var bulkhead = bulkheads.computeIfAbsent(rail, ignored -> new Semaphore(8));
        if (!bulkhead.tryAcquire()) {
            metrics.counter("vpulse.rail.requests", "rail", rail, "outcome", "bulkhead_rejected")
                    .increment();
            return new RailResult("BULKHEAD_FULL", 0, false);
        }
        var circuit = circuits.circuitBreaker(rail);
        long started = System.nanoTime();
        try {
            circuit.acquirePermission();
            try {
                executeWithTimeout(rail);
                int latency = elapsed(started);
                circuit.onSuccess(latency, TimeUnit.MILLISECONDS);
                metrics.counter("vpulse.rail.requests", "rail", rail, "outcome", "success")
                        .increment();
                return new RailResult("AUTHORIZED", latency, true);
            } catch (Exception exception) {
                int latency = elapsed(started);
                circuit.onError(latency, TimeUnit.MILLISECONDS, exception);
                metrics.counter("vpulse.rail.requests", "rail", rail, "outcome", "failure")
                        .increment();
                return new RailResult(
                        exception instanceof TimeoutException ? "TIMEOUT" : "DOWNSTREAM_REJECTED", latency, false);
            }
        } catch (CallNotPermittedException exception) {
            return new RailResult("CIRCUIT_OPEN", elapsed(started), false);
        } finally {
            bulkhead.release();
        }
    }

    private void executeWithTimeout(String rail) throws Exception {
        var config = jdbc.sql("SELECT failure_mode, simulated_delay_ms FROM rail_configuration WHERE rail = :rail")
                .param("rail", rail)
                .query(RailConfig.class)
                .single();
        var executor = Executors.newVirtualThreadPerTaskExecutor();
        try {
            var future = executor.submit(() -> {
                Thread.sleep(config.simulatedDelayMs());
                if ("REJECT".equals(config.failureMode()))
                    throw new PaymentProcessingException("Rail rejected request");
                if ("TIMEOUT".equals(config.failureMode())) Thread.sleep(TIMEOUT_MS * 2L);
                return null;
            });
            try {
                future.get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
            } catch (TimeoutException exception) {
                future.cancel(true);
                throw exception;
            }
        } finally {
            executor.shutdownNow();
        }
    }

    public CircuitBreaker circuit(String rail) {
        return circuits.circuitBreaker(rail);
    }

    public void reset() {
        circuits.getAllCircuitBreakers().forEach(CircuitBreaker::reset);
    }

    private int elapsed(long started) {
        return Math.toIntExact(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
    }

    private record RailConfig(String failureMode, int simulatedDelayMs) {}

    public record RailResult(String outcome, int latencyMs, boolean success) {}
}
