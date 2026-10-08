-- Applications registered in the console (stage 3), operator review,
-- reports and the audit log. Applications from the registry repository
-- stay in registry_cache; these rows are merged with them at run time.

CREATE TABLE IF NOT EXISTS apps (
  client_id             TEXT PRIMARY KEY,   -- "app-" + random, never reused
  protocol              TEXT NOT NULL,      -- oidc | saml2
  name_en               TEXT NOT NULL,
  name_zh               TEXT,
  domain                TEXT NOT NULL,      -- the proven domain
  homepage              TEXT NOT NULL,
  config                TEXT NOT NULL,      -- JSON: redirect_uris, post_logout_redirect_uris, token_endpoint_auth_method, jwks_uri, subject_type, allowed_idps, entity_id, acs_urls, sign_cert
  secret_sha256         TEXT,               -- current client secret, hex SHA-256
  secret_sha256_old     TEXT,               -- previous secret during rotation, until revoked
  status                TEXT NOT NULL,      -- development | active | suspended | banned
  status_reason         TEXT,
  domain_verified_at    INTEGER,
  domain_checked_at     INTEGER,
  domain_failing_since  INTEGER,
  domain_error          TEXT,
  created_by            TEXT NOT NULL,      -- RoamID public sub of the creator
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  active_since          INTEGER,            -- first time the app became active (new-app limit)
  limit_lifted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS apps_domain ON apps (domain);
CREATE INDEX IF NOT EXISTS apps_creator ON apps (created_by);

-- Owners and co-owners, by RoamID public sub.
CREATE TABLE IF NOT EXISTS app_owners (
  client_id             TEXT NOT NULL,
  sub                   TEXT NOT NULL,
  role                  TEXT NOT NULL,      -- owner | co-owner
  email                 TEXT,               -- as shown at the time, for display
  added_at              INTEGER NOT NULL,
  PRIMARY KEY (client_id, sub)
);
CREATE INDEX IF NOT EXISTS app_owners_sub ON app_owners (sub);

-- Co-owner invitations: a link (token hash) bound to an email address.
CREATE TABLE IF NOT EXISTS app_invites (
  token_hash            TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  invited_by            TEXT NOT NULL,
  expires               INTEGER NOT NULL
);

-- Console and operator sessions (RoamID sign-in to itself).
CREATE TABLE IF NOT EXISTS console_sessions (
  sid_hash              TEXT PRIMARY KEY,
  sub                   TEXT NOT NULL,
  email                 TEXT,
  email_authority       TEXT,
  name                  TEXT,
  idp                   TEXT NOT NULL,
  csrf                  TEXT NOT NULL,
  expires               INTEGER NOT NULL
);

-- Development-mode sign-ins and the new-app daily limit use events (by client).

-- Reports from the public form, and appeals from owners.
CREATE TABLE IF NOT EXISTS reports (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,      -- report | appeal
  target_kind           TEXT NOT NULL,      -- app | idp
  target_id             TEXT NOT NULL,
  category              TEXT NOT NULL,      -- phishing | fraud | malware | illegal | other | appeal
  description           TEXT NOT NULL,
  contact_email         TEXT,
  context               TEXT,               -- JSON: the sign-in in progress (client, idp), no personal data
  reporter_hash         TEXT NOT NULL,      -- SHA-256 of the address (or of the owner sub for appeals)
  created_at            INTEGER NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'open',  -- open | closed
  closed_by             TEXT,
  closed_at             INTEGER,
  ticket                TEXT                -- Orbit Help ticket number, when one was opened
);
CREATE INDEX IF NOT EXISTS reports_target ON reports (target_kind, target_id, state);
CREATE INDEX IF NOT EXISTS reports_state ON reports (state, created_at);

-- Every operator action and every owner-visible state change.
CREATE TABLE IF NOT EXISTS audit (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  at                    INTEGER NOT NULL,
  actor                 TEXT NOT NULL,      -- operator sub, owner sub, or "system"
  target_kind           TEXT NOT NULL,
  target_id             TEXT NOT NULL,
  action                TEXT NOT NULL,      -- created | activated | dismiss | warn | suspend | ban | restore | idp_disable | idp_enable | appeal | ...
  reason                TEXT,
  report_id             TEXT
);
CREATE INDEX IF NOT EXISTS audit_target ON audit (target_kind, target_id, at);

-- Domains of banned applications: never usable for a new application.
CREATE TABLE IF NOT EXISTS banned_domains (
  domain                TEXT PRIMARY KEY,
  client_id             TEXT,
  at                    INTEGER NOT NULL,
  reason                TEXT
);

-- Operator emergency override of a registry identity provider.
CREATE TABLE IF NOT EXISTS idp_overrides (
  idp                   TEXT PRIMARY KEY,
  disabled              INTEGER NOT NULL,
  reason                TEXT,
  by_sub                TEXT NOT NULL,
  at                    INTEGER NOT NULL
);

-- Public block lists (hosts), refreshed by the cron. One row per list.
CREATE TABLE IF NOT EXISTS blocklists (
  source                TEXT PRIMARY KEY,
  hosts                 TEXT NOT NULL,      -- newline-separated host names
  entries               INTEGER NOT NULL,
  fetched_at            INTEGER NOT NULL,
  last_error            TEXT
);
