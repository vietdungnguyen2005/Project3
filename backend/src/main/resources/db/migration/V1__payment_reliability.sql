CREATE TABLE payment_instruction (
    id UUID PRIMARY KEY,
    payment_number VARCHAR(40) NOT NULL UNIQUE,
    merchant_id VARCHAR(40) NOT NULL,
    rail VARCHAR(16) NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status VARCHAR(24) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE payment_attempt (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES payment_instruction(id),
    attempt_number INTEGER NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    latency_ms INTEGER NOT NULL,
    detail VARCHAR(240) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(payment_id, attempt_number)
);
CREATE TABLE parked_payment (
    payment_id UUID PRIMARY KEY REFERENCES payment_instruction(id),
    reason VARCHAR(40) NOT NULL,
    replay_count INTEGER NOT NULL DEFAULT 0,
    parked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_replayed_at TIMESTAMPTZ
);
CREATE TABLE rail_configuration (
    rail VARCHAR(16) PRIMARY KEY,
    display_name VARCHAR(80) NOT NULL,
    failure_mode VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    simulated_delay_ms INTEGER NOT NULL DEFAULT 30,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE audit_event (
    id UUID PRIMARY KEY,
    actor VARCHAR(80) NOT NULL,
    action VARCHAR(80) NOT NULL,
    aggregate_id VARCHAR(80) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payment_created ON payment_instruction(created_at DESC);
CREATE INDEX idx_payment_status ON payment_instruction(status, created_at DESC);
CREATE INDEX idx_attempt_payment ON payment_attempt(payment_id, attempt_number);
INSERT INTO rail_configuration (rail, display_name) VALUES
    ('ZENGIN', 'Zengin domestic transfer'), ('CARD', 'Card authorization'), ('SWIFT', 'SWIFT international');
