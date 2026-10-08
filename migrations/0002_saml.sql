-- SAML 2.0 in both directions.
-- tx.proto: the protocol the service uses with RoamID ('oidc' or 'saml2').
ALTER TABLE tx ADD COLUMN proto TEXT NOT NULL DEFAULT 'oidc';
ALTER TABLE tx ADD COLUMN saml_req_id TEXT;   -- the service provider's AuthnRequest ID (NULL when IdP-initiated)
ALTER TABLE tx ADD COLUMN relay_state TEXT;   -- the service provider's RelayState
ALTER TABLE tx ADD COLUMN up_req_id TEXT;     -- RoamID's AuthnRequest ID to a SAML identity provider

-- Last good metadata of SAML identity providers registered with metadata_url.
CREATE TABLE IF NOT EXISTS saml_metadata (
  idp                   TEXT PRIMARY KEY,
  entity_id             TEXT NOT NULL,
  sso_url               TEXT NOT NULL,
  certs                 TEXT NOT NULL,      -- JSON array of base64 DER
  valid_until           INTEGER,
  fetched_at            INTEGER NOT NULL,
  checked_at            INTEGER NOT NULL,
  last_error            TEXT
);
