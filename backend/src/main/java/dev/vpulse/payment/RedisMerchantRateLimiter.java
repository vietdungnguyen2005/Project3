package dev.vpulse.payment;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public class RedisMerchantRateLimiter {
    private static final long LIMIT = 30;
    private static final DefaultRedisScript<Long> WINDOW = new DefaultRedisScript<>(
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n",
            Long.class);
    private final StringRedisTemplate redis;
    private final MeterRegistry metrics;

    public RedisMerchantRateLimiter(StringRedisTemplate redis, MeterRegistry metrics) {
        this.redis = redis;
        this.metrics = metrics;
    }

    public boolean allow(String merchantId) {
        var key = "vpulse:rate:" + merchantId;
        try {
            var count = redis.execute(WINDOW, List.of(key), "60000");
            boolean allowed = count == null || count <= LIMIT;
            metrics.counter("vpulse.rate_limit", "outcome", allowed ? "allowed" : "rejected")
                    .increment();
            return allowed;
        } catch (RuntimeException exception) {
            metrics.counter("vpulse.rate_limit", "outcome", "redis_error").increment();
            return true;
        }
    }
}
