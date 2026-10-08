-- RoamID state. No user accounts and no stored profiles: claims live only in
-- codes (60 s) and tokens (1 h), for the token and userinfo endpoints.
-- Times are Unix seconds. The cron deletes expired rows.

-- Authorization transactions in progress (10 minutes).
CREATE TABLE IF NOT EXISTS tx (
  id                    TEXT PRIMARY KEY,   -- random, shown in the picker form
  binding               TEXT NOT NULL,      -- SHA-256 of the browser binding cookie
  client_id             TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  state                 TEXT,
  nonce                 TEXT,
  code_challenge        TEXT,
  prompt                TEXT,
  max_age               INTEGER,
  login_hint            TEXT,
  acr_values            TEXT,
  ui_locales            TEXT,
  idp                   TEXT,               -- set when the person picks one
  up_state              TEXT UNIQUE,        -- SHA-256 of the state sent upstream
  up_nonce              TEXT,
  up_verifier           TEXT,
  expires               INTEGER NOT NULL
);

-- RoamID authorization codes (60 seconds, single use).
CREATE TABLE IF NOT EXISTS codes (
  code_hash             TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT,
  nonce                 TEXT,
  scope                 TEXT NOT NULL,
  idp                   TEXT NOT NULL,
  claims                TEXT NOT NULL,      -- normalized claims, JSON
  auth_time             INTEGER NOT NULL,
  used                  INTEGER NOT NULL DEFAULT 0,
  token_hash            TEXT,               -- the access token issued from it, revoked on replay
  expires               INTEGER NOT NULL
);

-- Access tokens (1 hour), by SHA-256.
CREATE TABLE IF NOT EXISTS tokens (
  token_hash            TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  claims                TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  expires               INTEGER NOT NULL
);

-- The last registry that loaded (one row).
CREATE TABLE IF NOT EXISTS registry_cache (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  commit_sha            TEXT NOT NULL,
  generated_at          TEXT,
  synced_at             INTEGER NOT NULL,
  checked_at            INTEGER NOT NULL,
  doc                   TEXT NOT NULL,      -- the accepted entries, JSON
  dropped               TEXT NOT NULL,      -- entries refused, with reasons, JSON
  last_error            TEXT
);

-- Daily counts. No personal data: kind, IdP id, client_id, error code.
CREATE TABLE IF NOT EXISTS events (
  day                   TEXT NOT NULL,
  kind                  TEXT NOT NULL,      -- started | completed | failed
  idp                   TEXT NOT NULL DEFAULT '',
  client_id             TEXT NOT NULL DEFAULT '',
  code                  TEXT NOT NULL DEFAULT '',
  n                     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, idp, client_id, code)
);

-- Fixed-window rate limit counters. The key holds a hash, never an address.
CREATE TABLE IF NOT EXISTS ratelimit (
  k                     TEXT PRIMARY KEY,
  n                     INTEGER NOT NULL,
  expires               INTEGER NOT NULL
);

-- client_assertion jti values seen, until the assertion expires.
CREATE TABLE IF NOT EXISTS jti (
  k                     TEXT PRIMARY KEY,
  expires               INTEGER NOT NULL
);

-- Email domain proofs: DNS TXT _roamid.<domain> = "roamid-idp=<id>".
-- A domain is authoritative for its IdP while verified_at is set and it has
-- not been failing for longer than the grace period.
CREATE TABLE IF NOT EXISTS domain_proofs (
  domain                TEXT NOT NULL,      -- as declared, "*." prefix kept
  idp                   TEXT NOT NULL,
  verified_at           INTEGER,            -- last successful check
  checked_at            INTEGER,
  failing_since         INTEGER,            -- first failed check after a success
  last_error            TEXT,
  PRIMARY KEY (domain, idp)
);

-- Identity provider health from the cron probe (discovery and JWKS).
CREATE TABLE IF NOT EXISTS idp_health (
  idp                   TEXT PRIMARY KEY,
  state                 TEXT NOT NULL,      -- up | degraded | down
  checked_at            INTEGER NOT NULL,
  last_ok               INTEGER,
  last_error            TEXT
);

CREATE INDEX IF NOT EXISTS tx_expires ON tx (expires);
CREATE INDEX IF NOT EXISTS codes_expires ON codes (expires);
CREATE INDEX IF NOT EXISTS tokens_expires ON tokens (expires);
CREATE INDEX IF NOT EXISTS ratelimit_expires ON ratelimit (expires);
CREATE INDEX IF NOT EXISTS jti_expires ON jti (expires);
