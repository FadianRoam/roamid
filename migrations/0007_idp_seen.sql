-- When this instance first loaded each identity provider (for /idps, sorted
-- by "recently added").
CREATE TABLE IF NOT EXISTS idp_seen (
  idp                   TEXT PRIMARY KEY,
  first_seen            INTEGER NOT NULL
);
