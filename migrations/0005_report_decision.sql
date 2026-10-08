-- The public decision a report was upheld by (set when the operator ticks the
-- report as a basis of warn, suspend, ban or an identity provider disable).
-- Publication links exactly this decision; dismissed reports have none.
ALTER TABLE reports ADD COLUMN decision_id INTEGER;
