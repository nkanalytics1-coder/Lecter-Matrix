-- Fase B: extend gsc_connection to support full OAuth token lifecycle.
-- Forward-only migration; never edit once merged.

ALTER TABLE gsc_connection
  ADD COLUMN google_account_email     text,
  ADD COLUMN access_token             text,
  ADD COLUMN access_token_expires_at  timestamptz,
  ADD COLUMN connected_at             timestamptz,
  ADD COLUMN revoked_at               timestamptz;

-- Convert bytea refresh_token_enc to base64 text
ALTER TABLE gsc_connection
  ALTER COLUMN refresh_token_enc TYPE text USING encode(refresh_token_enc, 'base64');

-- Remove fixed-scope column (scope is always webmasters.readonly)
ALTER TABLE gsc_connection
  DROP COLUMN scopes;

-- Replace status check constraint with expanded value set
ALTER TABLE gsc_connection
  DROP CONSTRAINT ck_gsc_status;

ALTER TABLE gsc_connection
  ADD CONSTRAINT ck_gsc_status
    CHECK (status IN ('pending','connected','disconnected','revoked'));

-- Align default with new pending state
ALTER TABLE gsc_connection
  ALTER COLUMN status SET DEFAULT 'pending';

-- Migrate 'error' rows (old invalid state) to 'revoked'
UPDATE gsc_connection SET status = 'revoked' WHERE status = 'error';

-- Backfill google_account_email with empty placeholder for existing rows
UPDATE gsc_connection SET google_account_email = '' WHERE google_account_email IS NULL;

-- Backfill connected_at from updated_at for existing rows
UPDATE gsc_connection SET connected_at = updated_at WHERE connected_at IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE gsc_connection
  ALTER COLUMN google_account_email SET NOT NULL,
  ALTER COLUMN connected_at SET NOT NULL;
