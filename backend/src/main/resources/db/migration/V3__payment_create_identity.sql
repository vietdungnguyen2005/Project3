-- Existing instructions remain unscoped; never invent operation keys for historical data.
CREATE TABLE payment_create_operation (
    merchant_id VARCHAR(40) NOT NULL,
    key_hash CHAR(64) NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    payment_id UUID NOT NULL UNIQUE REFERENCES payment_instruction(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (merchant_id, key_hash)
);
