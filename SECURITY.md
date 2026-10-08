# Security policy / 安全策略

## Reporting / 报告

Report vulnerabilities privately through GitHub's "Report a vulnerability" form in the Security tab of this repository. Include the affected endpoint, steps to reproduce, and the request ID shown on the error page if there is one. Do not test against accounts or data that are not yours.
请通过本仓库 Security 页的 "Report a vulnerability" 私下报告漏洞,写明涉及的端点、复现步骤,以及错误页上的请求 ID(如有)。不要针对不属于你的账户或数据测试。

The same channel is used to hand over client secrets for identity providers that use `client_secret_basic` or `client_secret_post`. Never put a secret in a pull request.
使用 `client_secret_basic` 或 `client_secret_post` 的身份提供方,也经此渠道交接客户端密钥。不要把密钥放进拉取请求。

## Scope / 范围

- The Worker in `src/` and the public instance `id.fadianro.am`.
- The registry rules and CI in this repository.

Out of scope: vulnerabilities in a listed identity provider or application; report those to the `contact` in its registry entry.
不在范围内:登记表中某个身份提供方或应用自身的漏洞,请报告给其条目中的 `contact`。

## Security properties / 安全性质

- Exact `redirect_uri` matching; PKCE S256 required for public clients; single-use authorization codes (60 s) with revocation on replay.
- A separate callback path per identity provider, `iss` checks on the authorization response and the ID token (mix-up defence), `nonce` and `state` on both legs.
- Transaction cookies `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, bound to the browser; picker by POST.
- `frame-ancestors 'none'` and a per-response nonce Content Security Policy.
- ID token signature algorithm allow-list (RS256, PS256, ES256; never `none` or HMAC); JWKS cached and refreshed once on an unknown `kid`; 10 s timeout on every upstream request.
- Email addresses are marked verified only for domains the identity provider has proven by DNS.
- No user accounts and no stored profiles. Claims are kept only for the lifetime of a code (60 s) or an access token (1 h). Counters contain no personal data; rate-limit keys are hashes.
