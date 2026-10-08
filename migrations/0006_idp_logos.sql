-- Identity provider logos, downloaded by the registry sync from the same
-- GitHub Pages origin as registry.json, re-checked (type by magic bytes,
-- size, dimensions, sha256) and served from /logos/<path>.
CREATE TABLE IF NOT EXISTS idp_logos (
  path                  TEXT PRIMARY KEY,   -- <id>.<sha8>.<ext>
  idp                   TEXT NOT NULL,
  type                  TEXT NOT NULL,
  sha256                TEXT NOT NULL,
  width                 INTEGER NOT NULL,
  height                INTEGER NOT NULL,
  data                  TEXT NOT NULL,      -- base64
  stored_at             INTEGER NOT NULL
);
