# Conformance (v1)

[README](../README.md)

## OpenID Foundation conformance suite

The OpenID Foundation's certification suite runs its test plans (for an OpenID Provider: `oidcc-basic-certification-test-plan`, `oidcc-config-certification-test-plan`) from a hosted service that needs an interactive account and a person to complete each sign-in in a browser. It has not been run against this instance. The suite's tests that apply to RoamID's profile (authorization code flow, PKCE S256 required for public clients, `response_mode=query` only, no request objects, no dynamic registration) are reproduced by `scripts/conformance.mjs` below.

## Scripted checks

```
node scripts/conformance.mjs --base https://id.fadianro.am
CODE=… CODE_VERIFIER=… NONCE=… node scripts/conformance.mjs   # with one authorization code for roamid-demo
```

Part 1 needs no sign-in. Part 2 needs one authorization code for the demo client (`roamid-demo`, public, PKCE), obtained by a real sign-in with the browser's JavaScript turned off so that the demo page does not redeem it.

Result on 2026-10-09 against `https://id.fadianro.am` (version 1.4.0):

| Check | Result | Detail |
|---|---|---|
| config: issuer equals the base URL | pass | https://id.fadianro.am |
| config: authorization_endpoint is https on the issuer | pass | https://id.fadianro.am/authorize |
| config: token_endpoint is https on the issuer | pass | https://id.fadianro.am/token |
| config: userinfo_endpoint is https on the issuer | pass | https://id.fadianro.am/userinfo |
| config: jwks_uri is https on the issuer | pass | https://id.fadianro.am/jwks.json |
| config: response_types_supported = [code] | pass |  |
| config: subject_types_supported has public | pass |  |
| config: id_token_signing_alg_values_supported has RS256 (required) and ES256, no none | pass | RS256,ES256 |
| config: code_challenge_methods_supported = [S256] | pass |  |
| config: scopes_supported has openid | pass |  |
| config: authorization_response_iss_parameter_supported | pass |  |
| keys: JWKS has an RS256 and an ES256 key, each with kid, use and alg, no private part | pass | sig-2026-10-08-40a2a5:ES256,sig-rs-2026-10-09-21cdcf:RS256 |
| authorize: unknown client -> error page, no redirect | pass | 400 |
| authorize: unregistered redirect_uri -> error page, no redirect | pass | 400 |
| authorize: response_type=token -> unsupported_response_type with state and iss | pass | ?error=unsupported_response_type&error_description=response_type+must+be+code&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: scope without openid -> invalid_scope | pass | ?error=invalid_scope&error_description=scope+must+include+openid&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: request object -> request_not_supported | pass | ?error=request_not_supported&error_description=request+objects+are+not+supported&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: public client without PKCE -> invalid_request | pass | ?error=invalid_request&error_description=PKCE+code_challenge+is+required+for+this+client&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: PKCE plain -> invalid_request | pass | ?error=invalid_request&error_description=code_challenge_method+must+be+S256&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: prompt=none without a choice -> interaction_required | pass | ?error=interaction_required&error_description=an+identity+provider+must+be+chosen&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: a repeated parameter -> invalid_request | pass | ?error=invalid_request&error_description=state+repeated&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: response_mode=form_post -> invalid_request | pass | ?error=invalid_request&error_description=response_mode+must+be+query&state=cs-1&iss=https%3A%2F%2Fid.fadianro.am |
| authorize: a valid request reaches the picker | pass | /select?tx=0qsli4xDekSVilkz3az02JHVRqeNpWHX |
| token: unknown code -> 400 invalid_grant, no-store | pass | 400 invalid_grant |
| token: grant_type=password -> unsupported_grant_type | pass | unsupported_grant_type |
| token: wrong client authentication -> 401 invalid_client | pass | 401 |
| userinfo: no token -> 401 with WWW-Authenticate | pass | 401 |
| userinfo: invalid token -> 401 invalid_token | pass | 401 |
| CORS: token endpoint answers preflight | pass | 204 |
| token: wrong code_verifier -> invalid_grant | pass |  |
| token: code + verifier -> tokens, Bearer, no-store | pass | 200 |
| id_token: RS256 signature verifies with the JWKS key named by kid | pass | RS256 sig-rs-2026-10-09-21cdcf |
| id_token: iss, aud, azp | pass |  |
| id_token: iat and exp | pass | 1791509335 1791512935 |
| id_token: nonce echoed | pass |  |
| id_token: at_hash matches the access token | pass |  |
| id_token: sub, auth_time, idp | pass |  |
| userinfo: sub equals the ID token sub | pass |  |
| token: the code is single use (second use invalid_grant) | pass |  |
| token: reuse of the code revokes the access token issued from it | pass | 401 |

40/40 passed (https://id.fadianro.am, 2026-10-09T01:28Z)

## Other interoperability runs

| Pair | Result |
|---|---|
| openid-client 6 (Node.js) and Authlib 1.8 (Python) as relying parties | authorization code flow completed, ID token verified with `/jwks.json` (2026-10-08) |
| openid-client 6 with `id_token_signed_response_alg` RS256, then ES256; jose 6 `jwtVerify` with `algorithms: ["RS256"]`, then `["ES256"]` | authorization code flow completed for an application on the default (RS256) and after switching it to ES256 in the console; each ID token verified with `/jwks.json` and refused by a verifier limited to the other algorithm (2026-10-09) |
| SimpleSAMLphp 1.19 as SAML identity provider → RoamID → OIDC application | signed Response, signed Assertion, encrypted assertions (AES-CBC in a signed Response accepted, AES-CBC in an unsigned Response refused) |
| Keycloak 26.0 as SAML identity provider → RoamID → OIDC application | signed Response with an encrypted assertion |
| SimpleSAMLphp / YunZheng Auth → RoamID → Keycloak 26.0 as SAML service provider | signed AuthnRequests by HTTP-Redirect and HTTP-POST verified; an unsigned AuthnRequest refused with `RequestDenied` |

The unit and integration tests (`npm test`) cover the same requirements offline, including the SAML attack fixtures (signature wrapping variants, comment injection, decryption oracle, duplicate parameters).
