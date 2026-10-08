# RoamID

[简体中文](README.zh-CN.md)

RoamID is a community OpenID Connect broker. An application integrates RoamID once. Its users sign in with any identity provider (IdP) listed in the public registry in this repository. Identity providers and applications join the registry by pull request.

- Public instance: https://id.fadianro.am
- Discovery: https://id.fadianro.am/.well-known/openid-configuration
- Registry as published: https://fadianroam.github.io/roamid/registry.json
- License: Apache-2.0

No account at a listed identity provider? Register by GitHub pull request: [docs/registry.md](docs/registry.md#without-an-account-at-a-listed-identity-provider) (one-click templates, issue forms, `npm run new:app` / `npm run new:idp`).

## How it works

RoamID is an OpenID Provider to applications and a relying party to community identity providers.

```
Application ──OIDC──▶ RoamID ──OIDC──▶ community IdP (any entry in the registry)
            ◀─id_token─        ◀─id_token─
```

Example: a hosting provider adds "Sign in with RoamID" to its customer portal.

1. The portal sends the user to `https://id.fadianro.am/authorize`.
2. The user searches the list of identity providers and chooses one, for example YunZheng Auth. With `idp_hint` the application can preselect it.
3. The user signs in at that identity provider, for example as `lemon@lab.yunzheng.space`.
4. RoamID verifies the provider's ID token (signature, issuer, audience, expiry, nonce), maps the claims, and returns its own authorization code to the portal.
5. The portal exchanges the code at `/token` and receives an ID token signed by RoamID with `sub`, `idp`, `email`, `email_verified`, `email_authority` and `name`. It signs the user in.

`email_verified` is `true` only when the identity provider has proven by DNS that it is authoritative for the address's domain. See [Account linking](docs/rp-integration.md#6-account-linking).

## Documentation

| Document | For |
|---|---|
| [docs/rp-integration.md](docs/rp-integration.md) | Applications: endpoints, client authentication, claims, errors, examples, account linking |
| [docs/idp-requirements.md](docs/idp-requirements.md) | Identity providers: compatibility requirements, redirect URI, client authentication, email domains |
| [docs/registry.md](docs/registry.md) | Adding or changing a registry entry by pull request |
| [docs/policy.md](docs/policy.md) | Acceptable use, reports, operator actions, appeals |
| [docs/conformance.md](docs/conformance.md) | Conformance checks and interoperability runs |
| [docs/errors.md](docs/errors.md) | Error codes |
| [docs/operations.md](docs/operations.md) | Running an instance: deployment, secrets, key rotation |
| [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md) | |

The interface described in these documents is version 1.

## Endpoints

| Path | Purpose |
|---|---|
| `/.well-known/openid-configuration` | OpenID Provider metadata |
| `/authorize` | Authorization endpoint (shows the identity provider picker) |
| `/token` | Token endpoint (authorization code grant) |
| `/userinfo` | UserInfo endpoint |
| `/jwks.json` | Public keys that sign ID tokens (ES256) |
| `/client-jwks.json` | Public keys RoamID uses for `private_key_jwt` at identity providers |
| `/logout` | RP-initiated logout |
| `/callback/<idp-id>` | Redirect URI registered at each identity provider |
| `/idps`, `/idps.json` | Registered identity providers and their status |
| `/status`, `/status.json` | Registry commit, domain proofs, provider health, keys, daily counts |
| `/saml/idp/metadata.xml`, `/saml/idp/sso` | SAML 2.0 identity provider for SAML service providers |
| `/saml/sp/metadata.xml`, `/saml/acs/<idp-id>` | SAML 2.0 service provider of SAML identity providers |
| `/console` | Developer console: register and manage applications (sign in with RoamID) |
| `/apps`, `/apps.json` | Active applications and banned domains |
| `/report` | Report an application or identity provider |
| `/admin/reports` | Operator queue (operators only) |
| `/test`, `/test/<idp-id>` | One sign-in at an identity provider, showing the normalized claims |
| `/demo` | Demo application (public client with PKCE) |
| `/demo/saml` | Demo SAML service provider |
| `POST /admin/sync` | Immediate registry sync for the operator (bearer token) |

## Repository layout

```
registry/idps/<id>/idp.json     identity providers (optional logo.png, logo.webp or logo.jpg)
registry/clients/<client_id>.json  applications
schema/                         JSON Schemas for both entry types
src/                            the Cloudflare Worker
src/registry/validate.js        registry rules, shared by CI and the Worker
scripts/                        CI checks, registry build, key generation
test/                           node --test suites with a mock identity provider and mock applications
migrations/                     D1 schema
```

## Deployment overlay

Production at id.fadianro.am applies a deployment overlay (styling, SEO, platform integrations) through `src/platform/`; this repository runs standalone with the defaults. The module exports `renderHead`, `replacesBaseStylesheet`, `stylesheets`, `hero`, `sitemap`, `robots`, `clientIp`, `notifyOperator`, `humanCheck`, `responseHeaders`, `pages`, `languagePaths`, `assetSizes` and `buildMarker`; a deployment may replace it at build time with its own implementation of the same exports.

## Development

Node.js 22.5 or later. No dependencies.

```
npm test                      # node --test
node scripts/check.mjs --probe  # registry rules and live probes
```
