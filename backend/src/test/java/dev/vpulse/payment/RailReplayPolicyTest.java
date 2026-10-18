package dev.vpulse.payment;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class RailReplayPolicyTest {
    @ParameterizedTest
    @CsvSource({
        "TIMEOUT,false,false",
        "OUTCOME_UNKNOWN,false,false",
        "PROCESS_INTERRUPTED,false,false",
        "NEW_UNCLASSIFIED_OUTCOME,false,false",
        "AUTHORIZED,true,false",
        "DOWNSTREAM_REJECTED,true,false",
        "DOWNSTREAM_REJECTED,false,true",
        "CIRCUIT_OPEN,false,true",
        "BULKHEAD_FULL,false,true"
    })
    void onlyExplicitlyNonExecutedFailuresPermitReplay(String outcome, boolean success, boolean expected) {
        assertThat(new RailGateway.RailResult(outcome, 0, success).replayPermitted())
                .isEqualTo(expected);
    }
}
