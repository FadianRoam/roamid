# Changelog

## 1.0.0 (2026-10-08)

- OpenID Connect broker: authorization code flow, PKCE S256, client authentication `none`, `client_secret_basic`, `client_secret_post`, `private_key_jwt`; public and pairwise subjects; ES256 ID tokens; UserInfo; RP-initiated logout.
- Upstream OpenID Connect identity providers with `client_secret_basic`, `client_secret_post` or `private_key_jwt`.
- Registry in this repository, validated by CI and at run time, published to GitHub Pages and loaded every 5 minutes.
- Email domain proofs by DNS TXT and the `email_authority` claim.
- Identity provider health probes, `/status`, daily counts without personal data.
- Pages in English and Simplified Chinese, light, dark and system theme.
