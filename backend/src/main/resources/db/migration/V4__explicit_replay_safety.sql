-- A historical reason label is not evidence that a provider did not execute.
ALTER TABLE parked_payment ADD COLUMN replay_permitted BOOLEAN NOT NULL DEFAULT FALSE;
