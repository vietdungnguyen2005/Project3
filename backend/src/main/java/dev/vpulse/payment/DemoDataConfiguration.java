package dev.vpulse.payment;

import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;

@Configuration
public class DemoDataConfiguration {
    @Bean
    @ConditionalOnProperty(name = "vpulse.demo-data-enabled", havingValue = "true")
    ApplicationRunner seedDemoPayments(JdbcClient jdbc) {
        return ignored -> {
            jdbc.sql(
                            """
                        INSERT INTO payment_instruction
                            (id, payment_number, merchant_id, rail, amount_minor, currency, status, created_at, updated_at)
                        SELECT gen_random_uuid(), 'VP-' || LPAD(series::text, 8, '0'),
                               'MERCHANT-' || LPAD(((series % 24) + 1)::text, 3, '0'),
                               CASE series % 3 WHEN 0 THEN 'ZENGIN' WHEN 1 THEN 'CARD' ELSE 'SWIFT' END,
                               10000 + series * 137, 'JPY',
                               CASE series % 11 WHEN 0 THEN 'PARKED' WHEN 1 THEN 'PROCESSING' ELSE 'SUCCEEDED' END,
                               NOW() - (series || ' minutes')::interval, NOW() - (series || ' minutes')::interval
                        FROM generate_series(1, 1000) AS series
                        ON CONFLICT (payment_number) DO NOTHING
                        """)
                    .update();
            jdbc.sql(
                            """
                            INSERT INTO parked_payment (payment_id, reason)
                            SELECT id, 'DOWNSTREAM_REJECTED' FROM payment_instruction WHERE status = 'PARKED'
                            ON CONFLICT (payment_id) DO NOTHING
                            """)
                    .update();
        };
    }
}
