# Integrating an application (v1)

[简体中文](zh-CN/rp-integration.md)

RoamID is a standard OpenID Connect Provider. Any certified OpenID Connect client library works with it. This document lists the parameters, the claims and the rules for using them.

## 1. Register

Two ways, with the same automated review (section 12):

- **Developer console** (recommended): sign in at `https://id.fadianro.am/console` with RoamID itself, create the application, prove the domain. The application is active as soon as every check passes. The console shows the `client_id` and, for `client_secret_*`, the secret once.
- **Pull request**: add `registry/clients/<client_id>.json` (see [registry.md](registry.md)). A pull request that only adds or changes application entries and passes the automated review is merged automatically; the entry is live about 5 minutes later. `client_id` values starting with `app-` belong to the console and are refused here. Example:

```json
{
  "client_id": "example-portal",
  "protocol": "oidc",
  "name": { "en": "Example Portal", "zh": "示例门户" },
  "homepage": "https://portal.example.com/",
  "contact": { "github": "example-dev", "email": "dev@example.com" },
  "redirect_uris": ["https://portal.example.com/auth/roamid/callback"],
  "post_logout_redirect_uris": ["https://portal.example.com/"],
  "token_endpoint_auth_method": "client_secret_basic",
  "client_secret_sha256": "<SHA-256 of your secret, hex>",
  "subject_type": "public",
  "status": "active"
}
```

| Field | Rule |
|---|---|
| `client_id` | `[a-z0-9-]{2,64}`, equal to the file name. Permanent. |
| `redirect_uris` | Compared byte for byte. https; `http://localhost`, `http://127.0.0.1` and `http://[::1]` only for development. No fragment, no wildcard. |
| `post_logout_redirect_uris` | Optional. Same rules. |
| `token_endpoint_auth_method` | `none`, `private_key_jwt`, `client_secret_basic` or `client_secret_post`. |
| `client_secret_sha256` | For `client_secret_*`: generate at least 32 random bytes yourself and publish only the SHA-256 (hex) of the secret string. Example: `openssl rand -base64 32 \| tr -d '\n' > secret.txt; shasum -a 256 secret.txt`. Do not commit the secret. |
| `jwks_uri` | For `private_key_jwt`: https URL of your public keys (RS256, PS256 or ES256). |
| `allowed_idps` | Optional list of identity provider ids. Without it, every active provider is offered. |
| `subject_type` | `public` (default) or `pairwise`. |
| `id_token_signed_response_alg` | Optional. `RS256` (default) or `ES256`: the algorithm of the ID tokens this application receives. |
| `domain` | The application's domain (section 12). Required for an automatic merge. Shown in the picker. |

## 2. Endpoints

Use discovery: `https://id.fadianro.am/.well-known/openid-configuration`.

| | |
|---|---|
| Issuer | `https://id.fadianro.am` |
| Authorization | `https://id.fadianro.am/authorize` |
| Token | `https://id.fadianro.am/token` |
| UserInfo | `https://id.fadianro.am/userinfo` |
| JWKS | `https://id.fadianro.am/jwks.json` |
| End session | `https://id.fadianro.am/logout` |

`/token`, `/userinfo`, discovery and JWKS send CORS headers for single-page applications.

## 3. Authorization request

| Parameter | |
|---|---|
| `response_type` | `code` (the only value) |
| `client_id`, `redirect_uri` | as registered |
| `scope` | `openid`, plus `email` and/or `profile` |
| `state` | recommended |
| `nonce` | recommended; returned in the ID token |
| `code_challenge`, `code_challenge_method` | `S256`. Required for `none` clients; verified whenever sent. |
| `idp_hint` | optional: an identity provider id. Skips the picker when the provider is active and allowed for the client. |
| `prompt` | optional: `none`, `login`, `consent`, `select_account`. `login` and `consent` are passed to the provider. `none` requires `idp_hint` or a remembered choice in the browser, and is passed to the provider; otherwise the answer is `interaction_required`. `select_account` shows the picker. |
| `max_age`, `login_hint`, `acr_values` | optional; passed to the provider |
| `ui_locales` | optional: `en` or `zh-CN` for the picker |

Not supported: `request`, `request_uri`, `response_mode` other than `query`, implicit and hybrid flows.

The response to `redirect_uri` contains `code`, `state` and `iss` (RFC 9207). Check that `iss` is `https://id.fadianro.am`. Codes are valid for 60 seconds and once.

## 4. Token request

`grant_type=authorization_code` with `code`, `redirect_uri` (equal to the one in the request) and `code_verifier` when PKCE was used.

| Method | Authentication |
|---|---|
| `none` | `client_id` in the body; PKCE required |
| `client_secret_basic` | HTTP Basic with `client_id` and the secret (form-encoded as in RFC 6749 section 2.3.1) |
| `client_secret_post` | `client_id` and `client_secret` in the body |
| `private_key_jwt` | `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and `client_assertion`: a JWT with `iss` = `sub` = `client_id`, `aud` = `https://id.fadianro.am/token` or `https://id.fadianro.am`, `exp` within 10 minutes, a unique `jti` |

A client must use its registered method. A code used a second time is refused and the access token issued from it is revoked.

Response: `access_token` (opaque, 1 hour), `token_type` `Bearer`, `expires_in`, `id_token`, `scope`. No refresh tokens.

## 5. ID token and claims

The ID token is signed with RS256, or with ES256 when the entry sets `"id_token_signed_response_alg": "ES256"` (in the console: ID token signature). The public keys of both algorithms are at `/jwks.json`, each with `kid`, `alg` and `use: "sig"`; select the key by the token's `kid`. Lifetime 1 hour. It contains `iss`, `aud`, `azp`, `iat`, `exp`, `nonce` (when sent), `at_hash` and:

| Claim | Scope | Value |
|---|---|---|
| `sub` | always | RoamID subject. `public`: base64url(SHA-256(`<idp id>` + "\|" + provider subject)), the same at every application. `pairwise`: base64url(SHA-256(`<sector>` + "\|" + `<idp id>` + "\|" + provider subject)), where the sector is the host of the client's redirect URIs (all must share one host). The provider's own subject is never sent. |
| `idp` | always | registry id of the identity provider |
| `idp_name` | always | its English name |
| `auth_time` | always | from the provider when it sends one, otherwise the time RoamID received the sign-in |
| `acr` | always, when the provider sends one | |
| `email` | `email` | the provider's address for the person |
| `email_verified` | `email` | `true` only when `email_authority` is `authoritative` |
| `email_authority` | `email` | `authoritative` or `asserted`, see section 6 |
| `name`, `preferred_username`, `picture` | `profile` | as released by the provider |

`/userinfo` returns the same claims (except `auth_time`) for the access token.

## 6. Account linking

Identity providers are admitted by pull request. A provider can assert any email address. The rules below prevent a provider from taking over an account that belongs to someone else.

1. Applications MUST key accounts on `sub` (together with the issuer `https://id.fadianro.am`). `sub` is stable for a person at one identity provider.
2. An application MAY link a RoamID sign-in to an existing local account by email address automatically ONLY when `email_authority` is `authoritative`. In that case the identity provider has proven by DNS that it controls the address's domain, and has reported the address as verified.
3. When `email_authority` is `asserted`, the application MUST NOT link automatically. It MUST ask the person to confirm control of the address (for example with a link sent to that address) before linking. `email_verified` is `false` in this case even if the provider reported the address as verified.
4. The same person signing in through two different identity providers has two different `sub` values. Linking them is a decision of the application, under rules 2 and 3.

## 7. Errors

Errors before the client and redirect URI are known (unknown `client_id`, unregistered `redirect_uri`) are shown on a RoamID error page and never redirected. Other errors are returned to `redirect_uri` as `error`, `error_description`, `state` and `iss`:

| `error` | When |
|---|---|
| `invalid_request` | missing or invalid parameter, PKCE missing for a public client, repeated parameter |
| `unsupported_response_type` | `response_type` is not `code` |
| `invalid_scope` | `openid` is missing |
| `request_not_supported`, `request_uri_not_supported` | request objects |
| `interaction_required` | `prompt=none` without a decided identity provider |
| `login_required`, `consent_required`, `account_selection_required` | passed from the provider |
| `access_denied` | the person cancelled at the picker or at the provider |
| `server_error`, `temporarily_unavailable` | the provider failed; `error_description` is `roamid:<code>` |

When the provider fails, the person sees a RoamID error page with the error code and a request id, and a link back to the application with `error=server_error` (or `temporarily_unavailable`) and `error_description=roamid:<code>`. The codes are listed in [errors.md](errors.md).

Token endpoint errors follow RFC 6749 section 5.2: `invalid_request`, `invalid_client` (HTTP 401), `invalid_grant`, `unsupported_grant_type`, `slow_down` (HTTP 429).

## 8. Logout

`GET https://id.fadianro.am/logout` with `id_token_hint` or `client_id`, and optionally `post_logout_redirect_uri` (must be registered) and `state`. RoamID keeps no sign-in session: logout only clears the remembered identity provider choice in the browser. The person's session at the identity provider is not changed. Front-channel and back-channel logout are not offered because RoamID has no session to end.

## 9. Limits

Per client IP address: 60 authorization requests per minute, 120 token requests per minute, 300 UserInfo requests per minute. Per client: 600 token requests per minute. Exceeding them returns HTTP 429.

## 10. Examples

### Single-page application, no library

The demo at `/demo` is a complete example (source: `src/ui/demo.js`). Summary:

```js
const B = "https://id.fadianro.am", CID = "<client_id>", RU = location.origin + "/callback";
const b64 = (a) => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rnd = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));

// sign in
const verifier = rnd(48), state = rnd(24), nonce = rnd(24);
const challenge = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
sessionStorage.setItem("roamid", JSON.stringify({ verifier, state, nonce }));
location.assign(`${B}/authorize?` + new URLSearchParams({ response_type: "code", client_id: CID, redirect_uri: RU,
  scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256" }));

// on the callback page
const q = new URLSearchParams(location.search), s = JSON.parse(sessionStorage.getItem("roamid"));
if (q.get("state") !== s.state || q.get("iss") !== B) throw new Error("bad response");
const tok = await (await fetch(`${B}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code",
  code: q.get("code"), redirect_uri: RU, client_id: CID, code_verifier: s.verifier }) })).json();
const user = await (await fetch(`${B}/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
```

### Node.js, openid-client 6

```js
import * as oidc from "openid-client";

const config = await oidc.discovery(new URL("https://id.fadianro.am"), "example-portal", process.env.ROAMID_SECRET);
// client_secret_basic is the default for a secret; use oidc.None() as the 4th argument for a public client.

// sign in
const verifier = oidc.randomPKCECodeVerifier();
const state = oidc.randomState(), nonce = oidc.randomNonce();
const url = oidc.buildAuthorizationUrl(config, {
  redirect_uri: "https://portal.example.com/auth/roamid/callback", scope: "openid email profile",
  code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce,
});
// store verifier, state, nonce in the session, then redirect to url

// callback
const tokens = await oidc.authorizationCodeGrant(config, new URL(req.url, "https://portal.example.com"), {
  pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce,
});
const claims = tokens.claims(); // sub, idp, email, email_verified, email_authority, name
```

### Python, Authlib

```python
import requests
from authlib.integrations.requests_client import OAuth2Session
from authlib.common.security import generate_token
from authlib.jose import jwt, JsonWebKey
from authlib.oidc.core import CodeIDToken

meta = requests.get("https://id.fadianro.am/.well-known/openid-configuration", timeout=10).json()
client = OAuth2Session("example-portal", SECRET, scope="openid email profile",
                       redirect_uri="https://portal.example.com/auth/roamid/callback",
                       code_challenge_method="S256", token_endpoint_auth_method="client_secret_basic")

verifier, nonce = generate_token(48), generate_token(24)
url, state = client.create_authorization_url(meta["authorization_endpoint"], code_verifier=verifier, nonce=nonce)
# store verifier, state, nonce; redirect to url

# callback: callback_url is the full URL the browser returned to
token = client.fetch_token(meta["token_endpoint"], authorization_response=callback_url, code_verifier=verifier, state=state)
keys = JsonWebKey.import_key_set(requests.get(meta["jwks_uri"], timeout=10).json())
claims = jwt.decode(token["id_token"], keys, claims_cls=CodeIDToken,
                    claims_options={"iss": {"essential": True, "value": meta["issuer"]}},
                    claims_params={"nonce": nonce, "client_id": "example-portal"})
claims.validate()
```

## 11. SAML 2.0 service providers

An application that only speaks SAML 2.0 registers an entry with `"protocol": "saml2"` (schema `schema/client-saml2.schema.json`). RoamID is then its SAML identity provider.

```json
{
  "client_id": "example-wiki",
  "protocol": "saml2",
  "name": { "en": "Example Wiki", "zh": "示例维基" },
  "homepage": "https://wiki.example.com/",
  "contact": { "github": "example-dev", "email": "dev@example.com" },
  "entity_id": "https://wiki.example.com/saml/metadata",
  "acs_urls": ["https://wiki.example.com/saml/acs"],
  "sign_cert": "<optional: the certificate that signs your AuthnRequests>",
  "subject_type": "public",
  "status": "active"
}
```

| Setting at the service provider | Value |
|---|---|
| IdP metadata | `https://id.fadianro.am/saml/idp/metadata.xml` |
| IdP entity ID | `https://id.fadianro.am/saml/idp` |
| SSO URL | `https://id.fadianro.am/saml/idp/sso`, HTTP-Redirect or HTTP-POST |
| Response binding | HTTP-POST to one of `acs_urls` (compared byte for byte) |
| NameID | `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`, equal to the OIDC `sub` (public or pairwise; the pairwise sector is the ACS host) |
| Signature | The Response and the Assertion are signed, RSA-SHA256, exclusive canonicalization. Assertions are not encrypted. |
| Validity | 5 minutes |

- **AuthnRequest signatures.** When the entry has `sign_cert`, every AuthnRequest MUST be signed with it: the Redirect binding signature (`SigAlg` RSA-SHA256 or RSA-SHA512) or an enveloped signature for HTTP-POST. Unsigned or wrongly signed requests are refused with `RequestDenied`. Each of `SAMLRequest`, `RelayState`, `SigAlg` and `Signature` may appear once.
- **Entity ID.** `entity_id` is an `https://` URL on the application's `domain` or a subdomain of it (no other scheme, no port, no user information), and unique across the registry and the developer console. It is the Audience of every assertion RoamID issues to the application.
- **IdP-initiated.** Only for an entry with `"idp_initiated": true` (default `false`; in the console, the "Allow IdP-initiated sign-in" option): `https://id.fadianro.am/saml/idp/sso?sp=<client_id>&RelayState=<value>` signs the person in and posts an unsolicited Response (no `InResponseTo`) to the first ACS URL. Without it the request is refused with `invalid_request`.
- **Passive and forced.** `IsPassive="true"` behaves like OIDC `prompt=none` (status `NoPassive` when no identity provider was chosen before); `ForceAuthn="true"` is passed to the identity provider.
- **Errors** come back as a signed Response with a non-success status; the RoamID error code is in `StatusMessage` (see [errors.md](errors.md)). A cancelled sign-in gives `Responder` / `AuthnFailed`.

Attributes (URI name format; `FriendlyName` in brackets):

| Attribute | Claim |
|---|---|
| `urn:oid:0.9.2342.19200300.100.1.3` (`mail`) | `email` |
| `urn:oid:2.16.840.1.113730.3.1.241` (`displayName`) | `name` |
| `urn:oid:0.9.2342.19200300.100.1.1` (`uid`) | `preferred_username` |
| `urn:roamid:claims:email_verified` | `email_verified` (`true` / `false`) |
| `urn:roamid:claims:email_authority` | `email_authority` |
| `urn:roamid:claims:idp`, `urn:roamid:claims:idp_name` | `idp`, `idp_name` |
| `urn:roamid:claims:sub` | `sub` (same value as the NameID) |

The account linking rules of section 6 apply unchanged: link by NameID; use the email address to join an existing account only when `email_authority` is `authoritative`.

## 12. Automated review, domain proof and limits

Applications are not reviewed by a person. An application goes live when it passes these checks; the console and the pull-request job use the same code (`src/apps/checks.js`). The console shows each failed check with its code; the pull request gets a comment with the reasons.

| Check | Rule | Code |
|---|---|---|
| Name | 2 to 60 characters; letters, digits, spaces and `- _ . & ' ( )` | `name_length`, `name_chars` |
| Name | no domain name in it (`example.com`) | `name_domain` |
| Name | no Latin mixed with Cyrillic or Greek letters | `name_mixed_script` |
| Name | not too close to a reserved name ([policy/reserved-names.json](../policy/reserved-names.json)), compared by confusable skeleton (`0`→`o`, `rn`→`m`, Cyrillic `о`→`o`, …), as a part of the name for names of five or more characters, as a whole word for shorter ones | `name_reserved` |
| Name | not the same skeleton as another identity provider or application | `name_taken` |
| Domain | a host name such as `example.com`; not an IP address | `domain_invalid` |
| Domain | not the domain (or a subdomain of the domain) of a banned application | `domain_banned` |
| Domain and URLs | no host on the public block lists RoamID loads daily (URLhaus, OpenPhish) | `reputation` |
| Callback, logout and ACS URLs | exact; https; no user name or password, fragment or wildcard; a host name, not an IP address; the domain or a subdomain of it; the host resolves in public DNS | `url_https`, `url_userinfo`, `url_fragment`, `url_wildcard`, `url_ip`, `url_off_domain`, `host_unresolved` |
| Development | `http://localhost`, `http://127.0.0.1`, `http://[::1]` only in development mode | `url_localhost_active` |
| Homepage | https, on the domain | `url_off_domain` |
| Domain proof | see below | `domain_unproven` (pull request) |

**Domain proof.** Publish one of:

```
_roamid-app.example.com.  TXT  "roamid-app=<client_id>"
https://example.com/.well-known/roamid-app.txt   containing the line  <client_id>
```

The console checks at creation, on "Check now", every 15 minutes while the proof is missing, and once a day afterwards. When the proof disappears, sign-ins continue for 72 hours and are then refused with `app_unverified` until the proof is back. The picker shows the proven domain next to the application name; it is the anchor that tells people which site they sign in to.

**Status of a console application.**

| Status | Meaning |
|---|---|
| `development` | A callback is on localhost, or the domain is not proven yet. Only the owners and co-owners (at most 10) can sign in; others get `app_development`. |
| `active` | Every check passed and the domain is proven. Anyone can sign in. |
| `suspended` | Set by the operator, with a reason. Sign-in is refused before the picker (`app_suspended`), the application gets `access_denied`, and `/token` refuses it. The owner can appeal in the console. |
| `banned` | Set by the operator for illegal sites. Like `suspended`; the person is not sent back to the application, and its domain cannot be used for a new application. |

**Limits.** At most 10 applications per person; at most 200 new applications per day in total; during its first 7 days a new application has at most 500 sign-ins per day (`app_new_limit`, returned as `temporarily_unavailable`); the operator can lift the limit earlier.

**Secrets.** The console stores only the SHA-256 of a client secret and shows the secret once. "New client secret" keeps the previous secret valid until "Revoke the previous secret", so servers can switch without downtime.

**Owners.** The creator is the owner, identified by the RoamID public `sub` of the sign-in. An owner invites co-owners by the email address of their RoamID sign-in: the console makes a link, valid once for 7 days, that only a sign-in with that address can accept. The owner can transfer ownership to a co-owner.

Reports and appeals: [policy.md](policy.md).
