-- The audit log keeps the email address of the person who acted (when their
-- sign-in had one), so the operator history names operators, not ids.
ALTER TABLE audit ADD COLUMN actor_email TEXT;
