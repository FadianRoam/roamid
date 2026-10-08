# Identity provider requirements (v1)

[简体中文](zh-CN/idp-requirements.md)

This document lists what an identity provider (IdP) must support to be listed in the RoamID registry. In this document RoamID is the relying party and the identity provider is the OpenID Provider. "MUST" and "MUST NOT" are used as in RFC 2119.

## 1. Protocol

| Requirement | Detail |
|---|---|
| OpenID Connect Core 1.0 | Authorization code flow (`response_type=code`). |
| Discovery | `<issuer>/.well-known/openid-configuration` MUST be served over https. Its `issuer` MUST equal the `issuer` in the registry entry byte for byte. `authorization_endpoint`, `token_endpoint` and `jwks_uri` MUST be https URLs. |
| PKCE | `S256` MUST be supported and listed in `code_challenge_methods_supported`. RoamID always sends a challenge. |
| Response mode | `response_mode=query` MUST be supported. `form_post` is not used: the transaction cookie is `SameSite=Lax` and is only sent on a top-level GET. |
| ID token signature | `RS256` or `ES256`, listed in `id_token_signing_alg_values_supported`. Keys are published at `jwks_uri`; a `kid` is recommended. |
| ID token claims | `iss` equal to the issuer; `aud` containing the client ID (with `azp` equal to the client ID when `aud` has more than one value); `exp`; `iat`; `sub`; `nonce` echoed from the request. |
| Subject | `sub` MUST be stable and MUST NOT be reassigned to another person. It MUST NOT be an email address or a user name that can change. RoamID derives its own subject from `<idp id>` and this value; a change of `sub` makes the person a new user at every application. |
| UserInfo | Optional. When `userinfo_endpoint` is listed, RoamID calls it with the access token. Its `sub` MUST equal the ID token's `sub`; otherwise the sign-in fails. |
| RFC 9207 | Optional. When the provider adds `iss` to the authorization response, it MUST equal the issuer. |
| Timeouts | Every request from RoamID to the provider times out after 10 seconds. |

Scopes requested are the `scopes` of the registry entry (`openid` is required). Claims used: `email`, `email_verified`, `name`, `preferred_username`, `picture`, `acr`, `auth_time`. A different claim name can be mapped with `claims` in the entry.

Parameters passed through when the application sends them: `prompt`, `max_age`, `login_hint`, `acr_values`.

## 2. Client registration at the provider

Create one client for RoamID:

| Setting | Value |
|---|---|
| Redirect URI | `https://id.fadianro.am/callback/<id>`, where `<id>` is the registry id of the provider |
| Grant type | Authorization code |
| PKCE | S256 |
| Client authentication | one of the methods below |

### private_key_jwt (preferred)

Register `https://id.fadianro.am/client-jwks.json` as the client's JWKS URI. No secret is exchanged. RoamID signs a client assertion with `iss` and `sub` equal to the client ID, `aud` equal to the token endpoint (or the issuer, with `"client_assertion_aud": "issuer"` in the entry), a unique `jti` and a lifetime of 60 seconds. The keys are RS256.

### client_secret_basic or client_secret_post

The secret is not stored in the registry. The provider's operator sends it to the RoamID operator through a private channel (see SECURITY.md for contact). It is stored as the Worker secret `IDP_SECRET_<ID>` (the id in upper case, `-` replaced by `_`).

## 3. Email domains

Applications often look up accounts by email address. A provider can assert any address, so RoamID marks an address as verified only when the provider is authoritative for its domain.

- The entry lists `email_domains`, for example `["example.org"]`. `"*.example.org"` covers the subdomains of `example.org` and not `example.org` itself.
- Each domain is proven by a DNS TXT record:

  ```
  _roamid.example.org.  TXT  "roamid-idp=<id>"
  ```

  For `*.example.org` the record is also at `_roamid.example.org`.
- A domain can be claimed by one provider only. A declaration that overlaps another provider's (equal, or covered by a wildcard) is refused by CI.
- CI checks the records of added or changed entries. RoamID checks new domains when the registry lists them and every domain again once a day. When a record disappears, the domain keeps its authority for 48 hours after the first failed check, then loses it until the record is back. `/status` shows the state of every domain.

Claims RoamID sends to applications:

| Claim | Value |
|---|---|
| `email` | The address, whenever the provider releases one. |
| `email_authority` | `authoritative` when the provider reports the address as verified (`email_verified` true) and its domain is one of the provider's proven domains; otherwise `asserted`. |
| `email_verified` | `true` only when `email_authority` is `authoritative`. |

## 4. Health

Every 5 minutes RoamID loads the discovery document and the JWKS of each active provider and records `up`, `degraded` (loads, but no longer meets section 1) or `down` (does not load). The picker marks degraded and unavailable providers and still lists them. `/idps` and `/status` show the state and the last error.

## 5. Registry entry

See [registry.md](registry.md) and `schema/idp.schema.json`. Example:

```json
{
  "id": "example",
  "protocol": "oidc",
  "name": { "en": "Example Community", "zh": "示例社区" },
  "issuer": "https://login.example.org/realms/main",
  "homepage": "https://example.org/",
  "contact": { "github": "example-admin", "email": "admin@example.org" },
  "client_id": "roamid",
  "client_auth": "private_key_jwt",
  "scopes": ["openid", "email", "profile"],
  "email_domains": ["example.org"],
  "status": "active"
}
```

The `id` is permanent. To retire a provider, set `"status": "disabled"`.

## 6. Checking an entry

Run the registry check locally before opening a pull request:

```
node scripts/check.mjs --base origin/main --probe
```

It validates the entry, loads the discovery document and checks the TXT records.
