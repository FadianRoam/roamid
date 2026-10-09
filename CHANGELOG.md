# Changelog

## 1.5.0 (2026-10-09)

- Identity provider entries declare `domain`, the operator's own domain: the issuer (SAML: metadata or SSO URL) and the homepage are on it, and it is proven by the DNS TXT record `_roamid.<domain>` = `roamid-idp=<id>`. Required for new entries; RoamID rechecks it daily.
- Identity provider pull requests are merged automatically when the entry passes the automated review: `domain` and email domains proven, discovery or SAML metadata loaded, the name checked like an application name, no banned or listed host, the logo checks. A change to an existing entry comes from its `contact.github`. An OpenID Connect provider with a client secret is offered once `IDP_SECRET_<ID>` is set; until then `/idps` shows it as not yet available.
- Applications choose the providers they offer: all (default), `allowed_idps` (only these; later additions not offered) or `excluded_idps` (all but these; later additions offered).
- An application whose `domain` equals an identity provider's proven `domain` may use that provider's name.
- `/demo?idp=<id>` signs in at that provider.

## 1.4.0 (2026-10-09)

- ID tokens are signed with RS256 by default (OpenID Connect Core 15.1). An application may set `id_token_signed_response_alg` to `RS256` or `ES256` in its registry entry or in the console; other values are refused. Discovery lists `id_token_signing_alg_values_supported: ["RS256", "ES256"]`; `/jwks.json` publishes the keys of both algorithms.
- Upgrade: `SIGNING_KEYS` needs an RS256 key. Generate one with `node scripts/keygen.mjs signing RS256`, append it to the array, and `secret put` it before deploying 1.4.0; keep the ES256 key. Without an RS256 key, the token endpoint answers `server_error` for applications on the default.
- `id_token_hint` at `/logout` is accepted with either algorithm.

## 1.3.1 (2026-10-08)

- Co-owner invitations are accepted only with an email address that an identity provider authoritative for its domain asserted as verified; an invitation for another address reads as not valid.
- SAML applications: `entity_id` is an https URL on the application's domain or a subdomain, unique across the registry and the console (`/apps.json` lists `saml_entities`); IdP-initiated sign-in only with `"idp_initiated": true`.

## 1.3.0 (2026-10-08)

- `src/platform/`: the replaceable parts of a deployment (head metadata, extra stylesheets, landing heading, sitemap and robots, client address, operator notification, human check on the report form, response headers, extra pages, build marker) with generic defaults. Reports notify an optional `OPERATOR_WEBHOOK_URL`; the report form has no human check by default (rate limits apply).
- A plain base stylesheet with system fonts, light and dark; the footer shows "Powered by YunZheng LAB".
- Public pages have English URLs (`/idps`) and Chinese URLs (`/zh/idps`); `.html`, `.md`, a trailing slash, `/index.html` and `?lang=` answer 301 with the canonical URL.
- Identity provider lists for up to 500 entries: instant search (case, accent and width insensitive; names in both languages, ids, hosts and email domains), the picker orders the last used provider, then `login_hint` domain matches, then by name, with unavailable providers last, and collapses after the first six; keyboard selection (combobox and listbox); `/idps` groups by protocol, sorts by name, recently added or status, and remembers closed groups.
- Removed: the edge signature check, the help desk notifier, the report form's third-party check, the video band and the web font.

## 1.2.0 (2026-10-08)

- Registry layout: an identity provider is a directory, `registry/idps/<id>/idp.json`, with an optional `logo.png`, `logo.webp` or `logo.jpg`. Entries moved from `registry/idps/<id>.json` keep their identifiers; applications stay at `registry/clients/<client_id>.json`.
- Identity provider logos: checked in CI (type by content, at most 100 KB, 64 to 512 pixels, aspect 1:1 to 2:1, no animation, no trailing data), published next to `registry.json` under a content-hashed name, listed in the entry as `logo`, re-checked by the instance and served from `/logos/`. `/idps.json` lists the logo URL.
- `npm run new:idp -- --logo <file>`; the identity provider issue form accepts a logo attachment.
- Operator decisions name their basis: only the reports ticked for a decision are upheld; a published report links the decision it was upheld by; dismissals are not public.

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
- Public record of operator decisions: `/transparency.json`, mirrored hourly into `transparency/YYYY/MM.md` and `.json`; reports the operator publishes (redacted, reporter opt-out honoured) as issues labelled `report-upheld`.
- Appeals with the `appeal.yml` issue form, delivered to the operator queue.
- XML signatures: exclusive canonicalization without comments only; transforms limited to enveloped-signature and exclusive canonicalization.

## 1.0.0 (2026-10-08)

- OpenID Connect broker: authorization code flow, PKCE S256, client authentication `none`, `client_secret_basic`, `client_secret_post`, `private_key_jwt`; public and pairwise subjects; ES256 ID tokens; UserInfo; RP-initiated logout.
- Upstream OpenID Connect identity providers with `client_secret_basic`, `client_secret_post` or `private_key_jwt`.
- Registry in this repository, validated by CI and at run time, published to GitHub Pages and loaded every 5 minutes.
- Email domain proofs by DNS TXT and the `email_authority` claim.
- Identity provider health probes, `/status`, daily counts without personal data.
- Pages in English and Simplified Chinese, light, dark and system theme.
