-- The console session keeps email_verified from the ID token: rights tied to
-- an email address (co-owner invitations) need an authoritative, verified
-- address.
ALTER TABLE console_sessions ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
