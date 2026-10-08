## Identity provider entry / 身份提供方条目

- File / 文件: `registry/idps/<id>.json`
- Issuer / 签发方:
- Organisation and homepage / 组织与主页:

Checklist / 检查项:

- [ ] I am the `contact.github` of this entry or a maintainer of the organisation. / 我是条目的 `contact.github` 或该组织的维护者。
- [ ] The provider meets [docs/idp-requirements.md](../../docs/idp-requirements.md). / 提供方满足身份提供方要求。
- [ ] A client is registered at the provider with redirect URI `https://id.fadianro.am/callback/<id>`. / 已在提供方处登记客户端,回调地址为 `https://id.fadianro.am/callback/<id>`。
- [ ] Client authentication: `private_key_jwt` with `https://id.fadianro.am/client-jwks.json`, or a client secret handed over privately (SECURITY.md). / 客户端认证:`private_key_jwt`,或经私下渠道交接的客户端密钥。
- [ ] Every domain in `email_domains` has the TXT record `_roamid.<domain>` = `roamid-idp=<id>`. / `email_domains` 的每个域名都已有 TXT 记录。
- [ ] `node scripts/check.mjs --base origin/main --probe` passes locally. / 本地检查通过。
