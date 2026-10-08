# Changelog

## 1.1.0 (2026-10-08)

- SAML 2.0 HTTP-Redirect binding: `SAMLRequest`, `SAMLResponse`, `RelayState`, `SigAlg` and `Signature` may appear once each (compared by decoded name); the signed octets and the processed values come from the same occurrence. HTTP-POST fields may appear once each. A signed HTTP-POST `AuthnRequest` is read from the verified copy.
- SAML 2.0 encrypted assertions: AES-GCM; AES-CBC only inside a signed `Response`. Every decryption or parsing failure of an encrypted assertion gives the single error `saml_invalid_response`. Service provider metadata lists AES-GCM only.
- SAML 2.0 in both directions: SAML identity providers upstream (`/saml/acs/<id>`) and RoamID as SAML identity provider for SAML-only applications (`/saml/idp/sso`), with metadata refresh, health, `/status` entries and documentation. Tested with SimpleSAMLphp 1.19 and Keycloak 26.0.
- Registry entries may carry a `note`.
- Developer console (`/console`, sign-in with RoamID itself): applications stored by the instance, automated review (names by confusable skeleton, reserved names, callback rules, public DNS, block lists, banned domains), domain proof by DNS TXT or a well-known file, development mode, limits, secret rotation with overlap, co-owners and ownership transfer, daily statistics.
- Application pull requests that only touch `registry/clients/` are merged automatically when they pass the same review (`automerge` workflow).
- `/apps` and `/apps.json`; the picker shows the application's proven domain.
- Reports (`/report`, Orbit Verify), the operator queue (`/admin/reports`), dismiss / warn / suspend / ban / restore with an audit log, appeals, identity provider emergency override, help desk tickets for the operator.
- `/test` and `/test/<idp>`: one sign-in at an identity provider, showing the normalized claims (pairwise subject for that page).
- `/status`: sign-ins per day and per identity provider (aggregates only), SAML certificates and metadata, warnings for expiring certificates and keys older than one year.
- Pull-request job summary: SAML metadata probe and the automated application review.
- Scripted conformance checks (`scripts/conformance.mjs`, [docs/conformance.md](docs/conformance.md)).
- Operator runbook, SAML certificate rotation and abuse limits in `docs/operations.md`.
- New error codes: `app_suspended`, `app_banned`, `app_unverified`, `app_development`, `app_new_limit`.
- XML signatures: exclusive canonicalization without comments only; transforms limited to enveloped-signature and exclusive canonicalization.

## 1.0.0 (2026-10-08)

- OpenID Connect broker: authorization code flow, PKCE S256, client authentication `none`, `client_secret_basic`, `client_secret_post`, `private_key_jwt`; public and pairwise subjects; ES256 ID tokens; UserInfo; RP-initiated logout.
- Upstream OpenID Connect identity providers with `client_secret_basic`, `client_secret_post` or `private_key_jwt`.
- Registry in this repository, validated by CI and at run time, published to GitHub Pages and loaded every 5 minutes.
- Email domain proofs by DNS TXT and the `email_authority` claim.
- Identity provider health probes, `/status`, daily counts without personal data.
- Pages in English and Simplified Chinese, light, dark and system theme.
