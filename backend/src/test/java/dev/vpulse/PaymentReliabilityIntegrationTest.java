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
    @Test
    void replayRechecksPermissionAfterWaitingForTheInstructionLock() throws Exception {
        var authorized = operatorRequest();
        var id = UUID.randomUUID();
        jdbc.sql(
                        "INSERT INTO payment_instruction(id,payment_number,merchant_id,rail,amount_minor,currency,status) VALUES(:id,'VP-LOCKED-PERMISSION','MERCHANT-LOCKED-PERMISSION','CARD',1000,'JPY','PARKED')")
                .param("id", id)
                .update();
        jdbc.sql(
                        "INSERT INTO parked_payment(payment_id,reason,replay_permitted) VALUES(:id,'DOWNSTREAM_REJECTED',TRUE)")
                .param("id", id)
                .update();
        var dataSource = applicationDataSource;
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
                var blocker = dataSource.getConnection()) {
            blocker.setAutoCommit(false);
            int blockerPid;
            try (var statement = blocker.createStatement()) {
                statement
                        .executeQuery(
                                "SELECT id FROM payment_instruction WHERE payment_number='VP-LOCKED-PERMISSION' FOR UPDATE")
                        .close();
                try (var result = statement.executeQuery("SELECT pg_backend_pid()")) {
                    result.next();
                    blockerPid = result.getInt(1);
                }
            }
            var pending = executor.submit(() -> mvc.perform(post("/api/parking/VP-LOCKED-PERMISSION/replay")
                            .with(authorized)
                            .header("X-V-Pulse-BFF-Secret", BFF)
                            .header("X-V-Pulse-Ops-Secret", OPS))
                    .andReturn());
            try {
                org.awaitility.Awaitility.await()
                        .atMost(java.time.Duration.ofSeconds(5))
                        .until(() -> jdbc.sql(
                                        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE :pid=ANY(pg_blocking_pids(pid)))")
                                .param("pid", blockerPid)
                                .query(Boolean.class)
                                .single());
                try (var statement = blocker.createStatement()) {
                    statement.executeUpdate(
                            "UPDATE payment_instruction SET version=version+1 WHERE payment_number='VP-LOCKED-PERMISSION'");
                    statement.executeUpdate(
                            "UPDATE parked_payment SET replay_permitted=FALSE,reason='PROCESS_INTERRUPTED' WHERE payment_id='"
                                    + id + "'");
                }
                blocker.commit();
                org.assertj.core.api.Assertions.assertThat(pending.get(5, java.util.concurrent.TimeUnit.SECONDS)
                                .getResponse()
                                .getStatus())
                        .isEqualTo(409);
                org.assertj.core.api.Assertions.assertThat(((ControlledGateway) gateway).calls.get())
                        .isZero();
            } finally {
                blocker.rollback();
            }
        }
    }

    @Autowired
    javax.sql.DataSource applicationDataSource;

    @Test
    void interruptedRecoveryRevokesPreviouslyRecordedReplayPermission() throws Exception {
        var id = UUID.randomUUID();
        jdbc.sql(
                        "INSERT INTO payment_instruction(id,payment_number,merchant_id,rail,amount_minor,currency,status,updated_at) VALUES(:id,'VP-INTERRUPTED-SAFE','MERCHANT-INTERRUPTED-SAFE','CARD',1000,'JPY','PROCESSING',NOW()-INTERVAL '3 minutes')")
                .param("id", id)
                .update();
        jdbc.sql(
                        "INSERT INTO parked_payment(payment_id,reason,replay_permitted) VALUES(:id,'DOWNSTREAM_REJECTED',TRUE)")
                .param("id", id)
                .update();
        recovery.parkStalledInstructions();
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.sql("SELECT replay_permitted FROM parked_payment WHERE payment_id=:id")
                                .param("id", id)
                                .query(Boolean.class)
                                .single())
                .isFalse();
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT reason FROM parked_payment WHERE payment_id=:id")
                        .param("id", id)
                        .query(String.class)
                        .single())
                .isEqualTo("PROCESS_INTERRUPTED");
        mvc.perform(post("/api/parking/VP-INTERRUPTED-SAFE/replay")
                        .with(operatorRequest())
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("PAYMENT_RECONCILIATION_REQUIRED")));
        org.assertj.core.api.Assertions.assertThat(((ControlledGateway) gateway).calls.get())
                .isZero();
    }

    @Test
    void aTimedOutInstructionCannotBeBlindlyAuthorizedAgain() throws Exception {
        var authorized = operatorRequest();
        jdbc.sql("UPDATE rail_configuration SET failure_mode='TIMEOUT',simulated_delay_ms=0 WHERE rail='CARD'")
                .update();
        var created = mvc.perform(
                        post("/api/payments")
                                .with(authorized)
                                .header("X-V-Pulse-BFF-Secret", BFF)
                                .header("Idempotency-Key", "unknown-outcome-replay")
                                .contentType("application/json")
                                .content(
                                        "{\"merchantId\":\"MERCHANT-UNKNOWN\",\"rail\":\"CARD\",\"amountMinor\":1000,\"currency\":\"JPY\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.parkedReason", is("TIMEOUT")))
                .andReturn();
        String number = objectMapper
                .readTree(created.getResponse().getContentAsString())
                .get("payment")
                .get("paymentNumber")
                .asText();
        int callsBefore = ((ControlledGateway) gateway).calls.get();
        jdbc.sql("UPDATE rail_configuration SET failure_mode='NORMAL' WHERE rail='CARD'")
                .update();
        mvc.perform(post("/api/parking/{number}/replay", number)
                        .with(authorized)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("PAYMENT_RECONCILIATION_REQUIRED")));
        org.assertj.core.api.Assertions.assertThat(((ControlledGateway) gateway).calls.get())
                .isEqualTo(callsBefore);
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.sql("SELECT status FROM payment_instruction WHERE payment_number=:number")
                                .param("number", number)
                                .query(String.class)
                                .single())
                .isEqualTo("PARKED");
        org.assertj.core.api.Assertions.assertThat(jdbc.sql(
                                "SELECT replay_count FROM parked_payment pp JOIN payment_instruction p ON p.id=pp.payment_id WHERE p.payment_number=:number")
                        .param("number", number)
                        .query(Integer.class)
                        .single())
                .isZero();
    }

    @Test
    void aFailedIdentityInsertRollsBackTheInstructionBeforeAnyGatewayCall() throws Exception {
        var authorized = operatorRequest();
        jdbc.sql(
                        "CREATE FUNCTION qa_abort_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled identity staging failure'; END; $$")
                .update();
        jdbc.sql(
                        "CREATE TRIGGER qa_abort_identity BEFORE INSERT ON payment_create_operation FOR EACH ROW EXECUTE FUNCTION qa_abort_identity()")
                .update();
        try {
            org.assertj.core.api.Assertions.assertThatThrownBy(
                            () -> mvc.perform(
                                    post("/api/payments")
                                            .with(authorized)
                                            .header("X-V-Pulse-BFF-Secret", BFF)
                                            .header("Idempotency-Key", "rollback-operation")
                                            .contentType("application/json")
                                            .content(
                                                    "{\"merchantId\":\"MERCHANT-ROLLBACK\",\"rail\":\"CARD\",\"amountMinor\":1000,\"currency\":\"JPY\"}")))
                    .hasStackTraceContaining("controlled identity staging failure");
            org.assertj.core.api.Assertions.assertThat(
                            jdbc.sql("SELECT COUNT(*) FROM payment_instruction WHERE merchant_id='MERCHANT-ROLLBACK'")
                                    .query(Long.class)
                                    .single())
                    .isZero();
            org.assertj.core.api.Assertions.assertThat(jdbc.sql(
                                    "SELECT COUNT(*) FROM payment_create_operation WHERE merchant_id='MERCHANT-ROLLBACK'")
                            .query(Long.class)
                            .single())
                    .isZero();
            org.assertj.core.api.Assertions.assertThat(((ControlledGateway) gateway).calls.get())
                    .isZero();
        } finally {
            jdbc.sql("DROP TRIGGER qa_abort_identity ON payment_create_operation")
                    .update();
            jdbc.sql("DROP FUNCTION qa_abort_identity()").update();
        }
    }

    @Test
    void identityMigrationPreservesHistoricalInstructionsWithoutInventingKeys() throws Exception {
        String schema = "identity_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = java.sql.DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
            org.flywaydb.core.Flyway.configure()
                    .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                    .schemas(schema)
                    .defaultSchema(schema)
                    .target("2")
                    .load()
                    .migrate();
            connection.setSchema(schema);
            try (var statement = connection.createStatement()) {
                statement.executeUpdate(
                        "INSERT INTO payment_instruction(id,payment_number,merchant_id,rail,amount_minor,currency,status) VALUES('11111111-1111-4111-8111-111111111111','VP-HISTORICAL','Legacy-Merchant','CARD',1234,'JPY','PARKED')");
                statement.executeUpdate(
                        "INSERT INTO parked_payment(payment_id,reason) VALUES('11111111-1111-4111-8111-111111111111','DOWNSTREAM_REJECTED')");
                org.flywaydb.core.Flyway.configure()
                        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                        .schemas(schema)
                        .defaultSchema(schema)
                        .load()
                        .migrate();
                try (var result = statement.executeQuery(
                        "SELECT merchant_id,amount_minor,status,(SELECT COUNT(*) FROM payment_create_operation) FROM payment_instruction WHERE payment_number='VP-HISTORICAL'")) {
                    org.assertj.core.api.Assertions.assertThat(result.next()).isTrue();
                    org.assertj.core.api.Assertions.assertThat(result.getString(1))
                            .isEqualTo("Legacy-Merchant");
                    org.assertj.core.api.Assertions.assertThat(result.getLong(2))
                            .isEqualTo(1234);
                    org.assertj.core.api.Assertions.assertThat(result.getString(3))
                            .isEqualTo("PARKED");
                    org.assertj.core.api.Assertions.assertThat(result.getLong(4))
                            .isZero();
                }
                try (var result = statement.executeQuery("SELECT replay_permitted FROM parked_payment")) {
                    org.assertj.core.api.Assertions.assertThat(result.next()).isTrue();
                    org.assertj.core.api.Assertions.assertThat(result.getBoolean(1))
                            .isFalse();
                }
            }
        } finally {
            jdbc.sql("DROP SCHEMA IF EXISTS " + schema + " CASCADE").update();
        }
    }

    @Test
    void invalidOperationKeysCannotCreateInstructionsOrCallTheGateway() throws Exception {
        var authorized = operatorRequest();
        for (String key : java.util.Arrays.asList(null, "", "short", "key with spaces")) {
            mvc.perform(
                            post("/api/payments")
                                    .with(authorized)
                                    .with(request -> {
                                        request.removeHeader("Idempotency-Key");
                                        if (key != null) request.addHeader("Idempotency-Key", key);
                                        return request;
                                    })
                                    .header("X-V-Pulse-BFF-Secret", BFF)
                                    .contentType("application/json")
                                    .content(
                                            "{\"merchantId\":\"MERCHANT-INVALID-KEY\",\"rail\":\"CARD\",\"amountMinor\":1000,\"currency\":\"JPY\"}"))
                    .andExpect(status().isBadRequest());
        }
        org.assertj.core.api.Assertions.assertThat(((ControlledGateway) gateway).calls.get())
                .isZero();
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.sql("SELECT COUNT(*) FROM payment_instruction WHERE merchant_id='MERCHANT-INVALID-KEY'")
                                .query(Long.class)
                                .single())
                .isZero();
    }

    @Test
    void changingThePayloadConflictsButAnotherMerchantHasAnIndependentNamespace() throws Exception {
        var authorized = operatorRequest();
        String payload =
                "{\"merchantId\":\" merchant-scope \" ,\"rail\":\"ZENGIN\",\"amountMinor\":1000,\"currency\":\"JPY\"}";
        mvc.perform(post("/api/payments")
                        .with(authorized)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("Idempotency-Key", "merchant-scope-key")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.payment.merchantId", is("MERCHANT-SCOPE")));
        mvc.perform(post("/api/payments")
                        .with(authorized)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("Idempotency-Key", "merchant-scope-key")
                        .contentType("application/json")
                        .content(payload.replace("1000", "2000")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("IDEMPOTENCY_CONFLICT")));
        mvc.perform(post("/api/payments")
                        .with(authorized)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("Idempotency-Key", "merchant-scope-key")
                        .contentType("application/json")
                        .content(payload.replace("merchant-scope", "merchant-other")))
                .andExpect(status().isCreated());
        org.assertj.core.api.Assertions.assertThat(((ControlledGateway) gateway).calls.get())
                .isEqualTo(2);
    }

    @Test
    void aConcurrentDuplicateObservesProcessingWithoutAnotherGatewayCall() throws Exception {
        var authorized = operatorRequest();
        var controlled = (ControlledGateway) gateway;
        controlled.entered = new java.util.concurrent.CountDownLatch(1);
        controlled.release = new java.util.concurrent.CountDownLatch(1);
        String payload =
                "{\"merchantId\":\"MERCHANT-PENDING\",\"rail\":\"CARD\",\"amountMinor\":1234,\"currency\":\"JPY\"}";
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var first = executor.submit(() -> mvc.perform(post("/api/payments")
                            .with(authorized)
                            .header("X-V-Pulse-BFF-Secret", BFF)
                            .header("Idempotency-Key", "pending-operation-key")
                            .contentType("application/json")
                            .content(payload))
                    .andReturn());
            try {
                org.assertj.core.api.Assertions.assertThat(
                                controlled.entered.await(5, java.util.concurrent.TimeUnit.SECONDS))
                        .isTrue();
                var duplicate = mvc.perform(post("/api/payments")
                                .with(authorized)
                                .header("X-V-Pulse-BFF-Secret", BFF)
                                .header("Idempotency-Key", "pending-operation-key")
                                .contentType("application/json")
                                .content(payload))
                        .andExpect(status().isAccepted())
                        .andExpect(jsonPath("$.payment.status", is("PROCESSING")))
                        .andReturn();
                org.assertj.core.api.Assertions.assertThat(controlled.calls.get())
                        .isEqualTo(1);
                controlled.release.countDown();
                var completed = first.get(5, java.util.concurrent.TimeUnit.SECONDS);
                org.assertj.core.api.Assertions.assertThat(objectMapper
                                .readTree(duplicate.getResponse().getContentAsString())
                                .get("payment")
                                .get("paymentNumber"))
                        .isEqualTo(objectMapper
                                .readTree(completed.getResponse().getContentAsString())
                                .get("payment")
                                .get("paymentNumber"));
            } finally {
                controlled.release.countDown();
                controlled.release = null;
                controlled.entered = null;
            }
        }
    }

    @Test
    void theSameMerchantOperationKeyReturnsItsInstructionWithoutAnotherGatewayCall() throws Exception {
        var authorized = operatorRequest();
        String payload =
                "{\"merchantId\":\"MERCHANT-IDEMPOTENCY\",\"rail\":\"ZENGIN\",\"amountMinor\":42000,\"currency\":\"JPY\"}";
        var first = mvc.perform(post("/api/payments")
                        .with(authorized)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("Idempotency-Key", "same-operation-key")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isCreated())
                .andReturn();
        var duplicate = mvc.perform(post("/api/payments")
                        .with(authorized)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("Idempotency-Key", "same-operation-key")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isOk())
                .andReturn();
        org.assertj.core.api.Assertions.assertThat(
                        objectMapper.readTree(duplicate.getResponse().getContentAsString()))
                .isEqualTo(objectMapper.readTree(first.getResponse().getContentAsString()));
        org.assertj.core.api.Assertions.assertThat(((ControlledGateway) gateway).calls.get())
                .isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.sql("SELECT COUNT(*) FROM payment_instruction WHERE merchant_id='MERCHANT-IDEMPOTENCY'")
                                .query(Long.class)
                                .single())
                .isEqualTo(1);
    }

    @Autowired
    org.springframework.session.jdbc.JdbcIndexedSessionRepository sessionRepository;

    @Test
    void concurrentSessionAttributeInsertionDoesNotFailARequest() {
        verifyConcurrentSessionAttributes(sessionRepository);
    }

    private <S extends org.springframework.session.Session> void verifyConcurrentSessionAttributes(
            org.springframework.session.SessionRepository<S> repository) {
        var session = repository.createSession();
        repository.save(session);
        var requestOne = repository.findById(session.getId());
        var requestTwo = repository.findById(session.getId());
        requestOne.setAttribute("concurrent-csrf", "one");
        requestTwo.setAttribute("concurrent-csrf", "two");
        repository.save(requestOne);
        repository.save(requestTwo);
        org.assertj.core.api.Assertions.assertThat(
                        (String) repository.findById(session.getId()).getAttribute("concurrent-csrf"))
                .isEqualTo("two");
    }

    @Test
    void expiredAndDisabledSessionsLoseMutationAccess() throws Exception {
        var cookie = loginOperator();
        jdbc.sql("UPDATE spring_session SET last_access_time=0, expiry_time=0").update();
        mvc.perform(get("/api/auth/session").cookie(cookie).header("X-V-Pulse-BFF-Secret", BFF))
                .andExpect(jsonPath("$.authenticated", is(false)));
        operatorCookie = null;
        var authorized = operatorRequest();
        jdbc.sql("UPDATE auth_account SET enabled=FALSE WHERE username='operator@example.test'")
                .update();
        try {
            mvc.perform(post("/api/payments")
                            .with(authorized)
                            .header("X-V-Pulse-BFF-Secret", BFF)
                            .contentType("application/json")
                            .content("{}"))
                    .andExpect(status().isUnauthorized());
        } finally {
            jdbc.sql("UPDATE auth_account SET enabled=TRUE WHERE username='operator@example.test'")
                    .update();
        }
    }

    @Test
    void sessionRoleRevocationCsrfAndLogoutAreEnforced() throws Exception {
        var authorized = operatorRequest();
        mvc.perform(post("/api/payments")
                        .cookie(operatorCookie)
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isForbidden());
        jdbc.sql("UPDATE auth_account SET role='VIEWER' WHERE username='operator@example.test'")
                .update();
        try {
            mvc.perform(post("/api/payments")
                            .with(authorized)
                            .header("X-V-Pulse-BFF-Secret", BFF)
                            .contentType("application/json")
                            .content("{}"))
                    .andExpect(status().isForbidden());
        } finally {
            jdbc.sql("UPDATE auth_account SET role='OPERATOR' WHERE username='operator@example.test'")
                    .update();
        }
        mvc.perform(post("/api/auth/logout").with(authorized).header("X-V-Pulse-BFF-Secret", BFF))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/session").cookie(operatorCookie).header("X-V-Pulse-BFF-Secret", BFF))
                .andExpect(jsonPath("$.authenticated", is(false)));
    }

    @Test
    void serviceSecretsAloneCannotChangeARailFaultProfile() throws Exception {
        mvc.perform(post("/api/demo/rails/CARD/fault-profile")
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS)
                        .contentType("application/json")
                        .content("{\"failureMode\":\"REJECT\",\"delayMs\":0}"))
                .andExpect(status().isUnauthorized());
    }

    @org.springframework.boot.test.context.TestConfiguration
    static class GatewayTestConfiguration {
        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        ControlledGateway controlledGateway(JdbcClient jdbc, io.micrometer.core.instrument.MeterRegistry metrics) {
            return new ControlledGateway(jdbc, metrics);
        }
    }

    static class ControlledGateway extends RailGateway {
        final java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        volatile java.util.concurrent.CountDownLatch entered;
        volatile java.util.concurrent.CountDownLatch release;

        ControlledGateway(JdbcClient jdbc, io.micrometer.core.instrument.MeterRegistry metrics) {
            super(jdbc, metrics);
        }

        @Override
        public RailResult authorize(String rail) {
            calls.incrementAndGet();
            var gate = release;
            if (gate == null) return super.authorize(rail);
            entered.countDown();
            try {
                if (!gate.await(10, java.util.concurrent.TimeUnit.SECONDS))
                    throw new AssertionError("Gateway not released");
                return new RailResult("AUTHORIZED", 1, true);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError(exception);
            }
        }
    }

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
        registry.add("auth.bootstrap.username", () -> "operator@example.test");
        registry.add(
                "auth.bootstrap.password-hash",
                () -> new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder()
                        .encode("test-operator-password"));
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
    com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    private jakarta.servlet.http.Cookie operatorCookie;

    private jakarta.servlet.http.Cookie loginOperator() throws Exception {
        if (operatorCookie != null) return operatorCookie;
        var bootstrap = mvc.perform(get("/api/auth/session").header("X-V-Pulse-BFF-Secret", "integration-bff-secret"))
                .andExpect(status().isOk())
                .andReturn();
        String csrf = objectMapper
                .readTree(bootstrap.getResponse().getContentAsString())
                .get("csrfToken")
                .asText();
        operatorCookie = mvc.perform(post("/api/auth/login")
                        .header("X-V-Pulse-BFF-Secret", "integration-bff-secret")
                        .header("X-CSRF-TOKEN", csrf)
                        .cookie(bootstrap.getResponse().getCookie("VPULSE_SESSION"))
                        .param("username", "operator@example.test")
                        .param("password", "test-operator-password"))
                .andExpect(status().isNoContent())
                .andReturn()
                .getResponse()
                .getCookie("VPULSE_SESSION");
        return operatorCookie;
    }

    private org.springframework.test.web.servlet.request.RequestPostProcessor operatorRequest() throws Exception {
        var cookie = loginOperator();
        var session = mvc.perform(get("/api/auth/session")
                        .cookie(cookie)
                        .header("X-V-Pulse-BFF-Secret", "integration-bff-secret"))
                .andExpect(status().isOk())
                .andReturn();
        String csrf = objectMapper
                .readTree(session.getResponse().getContentAsString())
                .get("csrfToken")
                .asText();
        return request -> {
            if ("/api/payments".equals(request.getRequestURI()) && request.getHeader("Idempotency-Key") == null)
                request.addHeader("Idempotency-Key", UUID.randomUUID().toString());
            request.setCookies(cookie);
            request.addHeader("X-CSRF-TOKEN", csrf);
            return request;
        };
    }

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
        operatorCookie = null;
        jdbc.sql("TRUNCATE spring_session_attributes, spring_session, auth_login_window")
                .update();
        jdbc.sql("UPDATE rail_configuration SET failure_mode='NORMAL', simulated_delay_ms=5")
                .update();
        gateway.reset();
        ((ControlledGateway) gateway).calls.set(0);
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
                                .with(operatorRequest())
                                .header("X-V-Pulse-BFF-Secret", BFF)
                                .contentType("application/json")
                                .content(
                                        """
                                {"merchantId":"MERCHANT-TEST","rail":"ZENGIN","amountMinor":42000,"currency":"JPY"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.payment.status", is("SUCCEEDED")))
                .andExpect(jsonPath("$.attempts[0].outcome", is("AUTHORIZED")));
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.sql("SELECT actor FROM audit_event ORDER BY created_at DESC LIMIT 1")
                                .query(String.class)
                                .single())
                .isEqualTo("operator@example.test");
    }

    @Test
    void parksADefinitivelyRejectedPaymentThenAllowsAnAuthorizedReplay() throws Exception {
        mvc.perform(post("/api/demo/rails/CARD/fault-profile")
                        .with(operatorRequest())
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS)
                        .contentType("application/json")
                        .content("{\"failureMode\":\"REJECT\",\"delayMs\":0}"))
                .andExpect(status().isOk());

        var body = mvc.perform(
                        post("/api/payments")
                                .with(operatorRequest())
                                .header("X-V-Pulse-BFF-Secret", BFF)
                                .contentType("application/json")
                                .content(
                                        """
                                {"merchantId":"MERCHANT-RECOVERY","rail":"CARD","amountMinor":88000,"currency":"JPY"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.payment.status", is("PARKED")))
                .andExpect(jsonPath("$.parkedReason", is("DOWNSTREAM_REJECTED")))
                .andReturn()
                .getResponse()
                .getContentAsString();
        var paymentNumber = body.substring(body.indexOf("VP-"), body.indexOf("VP-") + 15);

        mvc.perform(post("/api/demo/rails/CARD/fault-profile")
                        .with(operatorRequest())
                        .header("X-V-Pulse-BFF-Secret", BFF)
                        .header("X-V-Pulse-Ops-Secret", OPS)
                        .contentType("application/json")
                        .content("{\"failureMode\":\"NORMAL\",\"delayMs\":5}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/parking/{number}/replay", paymentNumber)
                        .with(operatorRequest())
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
                                    .with(operatorRequest())
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
                                .with(operatorRequest())
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
    void aLateGatewayResultCannotOverwriteARecoveredInstruction() throws Exception {
        var controlled = (ControlledGateway) gateway;
        controlled.entered = new java.util.concurrent.CountDownLatch(1);
        controlled.release = new java.util.concurrent.CountDownLatch(1);
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var request = executor.submit(() -> mvc.perform(
                            post("/api/payments")
                                    .with(operatorRequest())
                                    .header("X-V-Pulse-BFF-Secret", BFF)
                                    .contentType("application/json")
                                    .content(
                                            "{\"merchantId\":\"MERCHANT-LATE\",\"rail\":\"CARD\",\"amountMinor\":1000,\"currency\":\"JPY\"}"))
                    .andReturn());
            try {
                org.assertj.core.api.Assertions.assertThat(
                                controlled.entered.await(10, java.util.concurrent.TimeUnit.SECONDS))
                        .isTrue();
                jdbc.sql(
                                "UPDATE payment_instruction SET updated_at=NOW()-INTERVAL '3 minutes' WHERE merchant_id='MERCHANT-LATE'")
                        .update();
                recovery.parkStalledInstructions();
            } finally {
                controlled.release.countDown();
            }
            var response = request.get(10, java.util.concurrent.TimeUnit.SECONDS);
            org.assertj.core.api.Assertions.assertThat(response.getResponse().getStatus())
                    .isEqualTo(201);
            org.assertj.core.api.Assertions.assertThat(
                            jdbc.sql("SELECT status FROM payment_instruction WHERE merchant_id='MERCHANT-LATE'")
                                    .query(String.class)
                                    .single())
                    .isEqualTo("PARKED");
            org.assertj.core.api.Assertions.assertThat(jdbc.sql(
                                    "SELECT COUNT(*) FROM payment_attempt a JOIN payment_instruction p ON p.id=a.payment_id WHERE p.merchant_id='MERCHANT-LATE'")
                            .query(Long.class)
                            .single())
                    .isZero();
        } finally {
            controlled.release = null;
        }
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
