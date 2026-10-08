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

## 7. SAML 2.0 identity providers

An entry with `"protocol": "saml2"` describes a SAML 2.0 identity provider (for example Keycloak, Authentik or SimpleSAMLphp in SAML mode). RoamID is the service provider. Schema: `schema/idp-saml2.schema.json`.

| Requirement | Detail |
|---|---|
| Service provider metadata | `https://id.fadianro.am/saml/sp/metadata.xml?idp=<id>`: entity ID `https://id.fadianro.am/saml/sp`, the signing and encryption certificate, and the ACS URL `https://id.fadianro.am/saml/acs/<id>`. |
| Request | SP-initiated. RoamID sends a signed `AuthnRequest` (RSA-SHA256) by HTTP-Redirect to the provider's HTTP-Redirect `SingleSignOnService`. |
| Response binding | HTTP-POST to `https://id.fadianro.am/saml/acs/<id>`. |
| Signature | The `Response` or the `Assertion` (or both) MUST be signed with a certificate from the entry or its metadata. Signature algorithms: RSA-SHA256, RSA-SHA512, ECDSA-SHA256/384/512. Digests: SHA-256, SHA-512. Canonicalization: exclusive XML canonicalization without comments (`http://www.w3.org/2001/10/xml-exc-c14n#`). Transforms: enveloped-signature and exclusive canonicalization only. Each signature has exactly one `Reference`, to the ID of the signed element. SHA-1 is refused. |
| Assertions | Exactly one `Assertion` or `EncryptedAssertion`, a direct child of the `Response`. IDs are unique in the document. The assertion ID is accepted once. |
| Checks | `Destination` and `Recipient` equal the ACS URL; `InResponseTo` equals the request ID; `Issuer` equals the entity ID; `Audience` equals RoamID's entity ID; `NotBefore` / `NotOnOrAfter` with 120 seconds of clock skew; bearer subject confirmation. |
| Encryption | Optional. Content encryption MUST be AES-GCM (`http://www.w3.org/2009/xmlenc11#aes128-gcm` or `#aes256-gcm`). AES-CBC (`xmlenc#aes128-cbc`, `#aes256-cbc`) is accepted only when the `Response` itself is signed, because unauthenticated CBC allows the encrypted assertion to be decrypted by an attacker (Jager and Somorovsky, 2011). Key transport: RSA-OAEP (`xmlenc#rsa-oaep-mgf1p`, or `xmlenc11#rsa-oaep` with the same digest for OAEP and MGF1). RSA PKCS#1 v1.5 is refused. Any failure to decrypt or parse an encrypted assertion gives one error, `saml_invalid_response`. |
| Subject | `sub_source` is `nameid` (a `persistent` NameID) or the name of an attribute with a stable identifier that is never reassigned (`urn:oid:1.3.6.1.4.1.5923.1.1.1.6` eduPersonPrincipalName, `urn:oasis:names:tc:SAML:attribute:subject-id`, `urn:oasis:names:tc:SAML:attribute:pairwise-id`). A `transient` NameID is refused as subject. |
| Attributes | Read by default: `mail` / `urn:oid:0.9.2342.19200300.100.1.3`, `displayName` / `urn:oid:2.16.840.1.113730.3.1.241`, `cn`, `uid` / `urn:oid:0.9.2342.19200300.100.1.1`, `eduPersonPrincipalName`. Other names are mapped with `attributes`. |
| Email | `email_attribute_verified: true` declares that the provider releases only verified addresses. `email_authority` is then `authoritative` for addresses in the provider's proven `email_domains` (section 3). |
| XML | No DTD, no entity declarations. Documents larger than 512 KiB are refused. |
| Metadata | `metadata_url` (https) is loaded at least every 6 hours. When a load fails the last good copy is used, but never after its `validUntil`. Without `metadata_url`, the entry gives `entity_id`, `sso_url` and `certs`. |

Tested implementations (2026-10-08): SimpleSAMLphp 1.19 and Keycloak 26.0 as identity providers, with signed AuthnRequests verified by them, signed Responses and Assertions, and encrypted assertions. Both encrypt with AES-128-CBC when a certificate is used for key transport, so with them encryption works only while the Response is signed (their default).

Health of a SAML provider: the metadata loads (or is inline) and one signing certificate is valid now. `/status` warns 30 days before a signing certificate expires.
