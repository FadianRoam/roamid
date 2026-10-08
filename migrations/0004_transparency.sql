-- Public transparency: operator decisions (always public) and reports the
-- operator chose to publish after review. No reporter data, no operator ids.
CREATE TABLE IF NOT EXISTS decisions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  at                    INTEGER NOT NULL,
  target_kind           TEXT NOT NULL,      -- app | idp
  target_id             TEXT NOT NULL,
  domain                TEXT,               -- the application's proven domain
  category              TEXT NOT NULL,      -- report category, or "none" when no report led to it
  decision              TEXT NOT NULL,      -- warn | suspend | ban | restore | idp_disable | idp_enable
  reason                TEXT NOT NULL,      -- one line, written by the operator for the public record
  withdrawn             TEXT                -- a note when the record was withdrawn (for example a test)
);
CREATE TABLE IF NOT EXISTS publications (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  at                    INTEGER NOT NULL,
  report_id             TEXT NOT NULL UNIQUE,
  decision_id           INTEGER,
  target_kind           TEXT NOT NULL,
  target_id             TEXT NOT NULL,
  category              TEXT NOT NULL,
  text                  TEXT NOT NULL,      -- redacted and confirmed by the operator
  withdrawn             TEXT
);
-- The reporter may keep the description out of any publication.
ALTER TABLE reports ADD COLUMN no_publish INTEGER NOT NULL DEFAULT 0;
-- How a closed report ended: upheld (it led to warn, suspend or ban) or dismissed.
ALTER TABLE reports ADD COLUMN outcome TEXT;
