package dev.vpulse;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.vpulse.payment.RailGateway;
import dev.vpulse.payment.StalledPaymentRecovery;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PaymentReliabilityIntegrationTest {
    private static final String BFF = "integration-bff-secret";
    private static final String OPS = "integration-ops-secret";

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.6-alpine")
            .withDatabaseName("vpulse")
            .withUsername("vpulse")
            .withPassword("vpulse");

    @Container
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:8.2-alpine")).withExposedPorts(6379);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.data.redis.url", () -> "redis://" + REDIS.getHost() + ":" + REDIS.getMappedPort(6379));
        registry.add("vpulse.bff-secret", () -> BFF);
        registry.add("vpulse.ops-secret", () -> OPS);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    StringRedisTemplate redis;

    @Autowired
    RailGateway gateway;

    @Autowired
    StalledPaymentRecovery recovery;

    @BeforeEach
    void resetFaultInjection() {
        jdbc.sql("UPDATE rail_configuration SET failure_mode='NORMAL', simulated_delay_ms=5")
                .update();
        gateway.reset();
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
    }

    @Test
    void rejectsDirectApiAccessWithoutTrustedBff() throws Exception {
        mvc.perform(get("/api/reliability/overview"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code", is("BFF_AUTH_REQUIRED")));
    }

    @Test
    void acceptsAHealthyPaymentAndPersistsItsAttempt() throws Exception {
        mvc.perform(
                        post("/api/payments")
                                .header("X-V-Pulse-BFF-Secret", BFF)
                                .contentType("application/json")
                                .content(
                                        """
                                {"merchantId":"MERCHANT-TEST","rail":"ZENGIN","amountMinor":42000,"currency":"JPY"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.payment.status", is("SUCCEEDED")))
                .andExpect(jsonPath("$.attempts[0].outcome", is("AUTHORIZED")));
    }

    @Test
    void parksATimedOutPaymentThenAllowsAnAuthorizedReplay() throws Exception {
        mvc.perform(post("/api/demo/rails/CARD/fault-profile")
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS)
                        .contentType("application/json")
                        .content("{\"failureMode\":\"TIMEOUT\",\"delayMs\":0}"))
                .andExpect(status().isOk());

        var body = mvc.perform(
                        post("/api/payments")
                                .header("X-V-Pulse-BFF-Secret", BFF)
                                .contentType("application/json")
                                .content(
                                        """
                                {"merchantId":"MERCHANT-RECOVERY","rail":"CARD","amountMinor":88000,"currency":"JPY"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.payment.status", is("PARKED")))
                .andExpect(jsonPath("$.parkedReason", is("TIMEOUT")))
                .andReturn()
                .getResponse()
                .getContentAsString();
        var paymentNumber = body.substring(body.indexOf("VP-"), body.indexOf("VP-") + 15);

        mvc.perform(post("/api/demo/rails/CARD/fault-profile")
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS)
                        .contentType("application/json")
                        .content("{\"failureMode\":\"NORMAL\",\"delayMs\":5}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/parking/{number}/replay", paymentNumber)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payment.status", is("SUCCEEDED")))
                .andExpect(jsonPath("$.attempts.length()", is(2)));
    }

    @Test
    void enforcesTheMerchantBudgetInRedis() throws Exception {
        for (int request = 0; request < 30; request++) {
            mvc.perform(
                            post("/api/payments")
                                    .header("X-V-Pulse-BFF-Secret", BFF)
                                    .contentType("application/json")
                                    .content(
                                            """
                                    {"merchantId":"MERCHANT-LIMIT","rail":"SWIFT","amountMinor":1000,"currency":"JPY"}
                                    """))
                    .andExpect(status().isCreated());
        }
        mvc.perform(
                        post("/api/payments")
                                .header("X-V-Pulse-BFF-Secret", BFF)
                                .contentType("application/json")
                                .content(
                                        """
                                {"merchantId":"MERCHANT-LIMIT","rail":"SWIFT","amountMinor":1000,"currency":"JPY"}
                                """))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code", is("MERCHANT_RATE_LIMITED")));
    }

    @Test
    void reconcilesAnInstructionInterruptedBetweenClaimAndFinalize() {
        var id = UUID.randomUUID();
        jdbc.sql(
                        """
                        INSERT INTO payment_instruction
                            (id,payment_number,merchant_id,rail,amount_minor,currency,status,updated_at)
                        VALUES (:id,'VP-STALLED-TEST','MERCHANT-STALLED','ZENGIN',1000,'JPY','PROCESSING',NOW()-INTERVAL '3 minutes')
                        """)
                .param("id", id)
                .update();

        recovery.parkStalledInstructions();

        var status = jdbc.sql("SELECT status FROM payment_instruction WHERE id=:id")
                .param("id", id)
                .query(String.class)
                .single();
        var reason = jdbc.sql("SELECT reason FROM parked_payment WHERE payment_id=:id")
                .param("id", id)
                .query(String.class)
                .single();
        var auditCount = jdbc.sql("SELECT COUNT(*) FROM audit_event WHERE aggregate_id='VP-STALLED-TEST'")
                .query(Integer.class)
                .single();
        org.assertj.core.api.Assertions.assertThat(status).isEqualTo("PARKED");
        org.assertj.core.api.Assertions.assertThat(reason).isEqualTo("PROCESS_INTERRUPTED");
        org.assertj.core.api.Assertions.assertThat(auditCount).isEqualTo(1);
    }
}
