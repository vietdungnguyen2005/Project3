ALTER TABLE payment_instruction ADD COLUMN provider_reference VARCHAR(100);
ALTER TABLE payment_attempt ADD COLUMN provider_reference VARCHAR(100);
CREATE UNIQUE INDEX payment_provider_reference ON payment_instruction(provider_reference) WHERE provider_reference IS NOT NULL;

-- Independent simulator ledger: deliberately no FK to local payment state. No historical backfill.
CREATE TABLE simulated_provider_ledger (
    reference VARCHAR(100) PRIMARY KEY,
    payload_hash CHAR(64) NOT NULL,
    outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('AUTHORIZED','REJECTED','INCOMPLETE')),
    authorization_calls INTEGER NOT NULL DEFAULT 1 CHECK (authorization_calls > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE provider_lookup_configuration (
    rail VARCHAR(16) PRIMARY KEY REFERENCES rail_configuration(rail),
    mode VARCHAR(16) NOT NULL DEFAULT 'NORMAL' CHECK (mode IN ('NORMAL','UNAVAILABLE','UNKNOWN')),
    delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (delay_ms BETWEEN 0 AND 5000)
);
INSERT INTO provider_lookup_configuration(rail) SELECT rail FROM rail_configuration;

CREATE TABLE payment_reconciliation (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES payment_instruction(id),
    provider_reference VARCHAR(100),
    payment_version BIGINT NOT NULL,
    state VARCHAR(16) NOT NULL CHECK (state IN ('IN_PROGRESS','OBSERVED','RESOLVED','INTERRUPTED')),
    outcome VARCHAR(32),
    evidence_code VARCHAR(100),
    requested_by VARCHAR(80) NOT NULL,
    resolved_by VARCHAR(80),
    request_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_until TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_reconciliation ON payment_reconciliation(payment_id) WHERE state='IN_PROGRESS';
CREATE INDEX reconciliation_history ON payment_reconciliation(payment_id,created_at DESC);
