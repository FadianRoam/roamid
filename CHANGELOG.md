# Changelog

## 1.1.0 (unreleased)

- SAML 2.0 HTTP-Redirect binding: `SAMLRequest`, `SAMLResponse`, `RelayState`, `SigAlg` and `Signature` may appear once each (compared by decoded name); the signed octets and the processed values come from the same occurrence. HTTP-POST fields may appear once each. A signed HTTP-POST `AuthnRequest` is read from the verified copy.
- SAML 2.0 encrypted assertions: AES-GCM; AES-CBC only inside a signed `Response`. Every decryption or parsing failure of an encrypted assertion gives the single error `saml_invalid_response`. Service provider metadata lists AES-GCM only.
- XML signatures: exclusive canonicalization without comments only; transforms limited to enveloped-signature and exclusive canonicalization.

## 1.0.0 (2026-10-08)

- OpenID Connect broker: authorization code flow, PKCE S256, client authentication `none`, `client_secret_basic`, `client_secret_post`, `private_key_jwt`; public and pairwise subjects; ES256 ID tokens; UserInfo; RP-initiated logout.
- Upstream OpenID Connect identity providers with `client_secret_basic`, `client_secret_post` or `private_key_jwt`.
- Registry in this repository, validated by CI and at run time, published to GitHub Pages and loaded every 5 minutes.
- Email domain proofs by DNS TXT and the `email_authority` claim.
- Identity provider health probes, `/status`, daily counts without personal data.
- Pages in English and Simplified Chinese, light, dark and system theme.
