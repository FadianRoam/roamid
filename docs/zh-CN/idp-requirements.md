# 身份提供方要求（v1）

[English](../idp-requirements.md)

本文列出身份提供方（IdP）进入 RoamID 登记表需要支持的内容。本文中 RoamID 是依赖方，身份提供方是 OpenID Provider。「必须」「不得」按 RFC 2119 理解。

## 1. 协议

| 要求 | 说明 |
|---|---|
| OpenID Connect Core 1.0 | 授权码流程（`response_type=code`）。 |
| Discovery | `<issuer>/.well-known/openid-configuration` 必须经 https 提供；其中的 `issuer` 必须与登记条目的 `issuer` 逐字节一致；`authorization_endpoint`、`token_endpoint`、`jwks_uri` 必须为 https 地址。 |
| PKCE | 必须支持 `S256` 并列在 `code_challenge_methods_supported` 中。RoamID 每次都发送 challenge。 |
| 响应模式 | 必须支持 `response_mode=query`。不使用 `form_post`：事务 cookie 为 `SameSite=Lax`，只在顶层 GET 请求中发送。 |
| ID 令牌签名 | `RS256` 或 `ES256`，列在 `id_token_signing_alg_values_supported` 中；公钥发布在 `jwks_uri`，建议带 `kid`。 |
| ID 令牌声明 | `iss` 等于签发方；`aud` 包含客户端 ID(`aud` 有多个值时 `azp` 必须等于客户端 ID);`exp`;`iat`;`sub`；原样带回请求中的 `nonce`。 |
| 主体标识 | `sub` 必须稳定，不得转给另一个人；不得是邮箱地址或可修改的用户名。RoamID 由 `<idp id>` 与该值推出自己的主体标识；`sub` 变化会使此人在所有应用处成为新用户。 |
| UserInfo | 可选。discovery 列出 `userinfo_endpoint` 时，RoamID 用访问令牌调用它；其 `sub` 必须等于 ID 令牌的 `sub`，否则登录失败。 |
| RFC 9207 | 可选。提供方在授权响应中加入 `iss` 时，它必须等于签发方。 |
| 超时 | RoamID 发往提供方的每个请求 10 秒超时。 |

请求的 scope 为登记条目的 `scopes`（必须包含 `openid`）。使用的声明：`email`、`email_verified`、`name`、`preferred_username`、`picture`、`acr`、`auth_time`。声明名不同时，可在条目的 `claims` 中映射。

应用发送以下参数时原样转交：`prompt`、`max_age`、`login_hint`、`acr_values`。

## 2. 在提供方处登记客户端

为 RoamID 建一个客户端：

| 设置 | 值 |
|---|---|
| 回调地址 | `https://id.fadianro.am/callback/<id>`,`<id>` 是该提供方的登记 id |
| 授权类型 | 授权码 |
| PKCE | S256 |
| 客户端认证 | 下列方法之一 |

### private_key_jwt（首选）

把 `https://id.fadianro.am/client-jwks.json` 登记为客户端的 JWKS 地址，无需交换任何密钥。RoamID 签发的客户端断言：`iss` 与 `sub` 为客户端 ID;`aud` 为令牌端点（条目中写 `"client_assertion_aud": "issuer"` 时为签发方）;`jti` 唯一；有效期 60 秒；密钥为 RS256。

### client_secret_basic 或 client_secret_post

密钥不进登记表。提供方运营者经私下渠道交给 RoamID 运营者（联系方式见 SECURITY.md），存为 Worker secret `IDP_SECRET_<ID>`（id 大写，`-` 换成 `_`）。

## 3. 邮箱域名

应用常按邮箱地址查找账户。提供方可以声明任意地址，因此 RoamID 只在提供方对地址所在域名有权威时才把地址标为已验证。

- 条目列出 `email_domains`，例如 `["example.org"]`。`"*.example.org"` 覆盖 `example.org` 的子域名，不含 `example.org` 本身。
- 每个域名用 DNS TXT 记录证明：

  ```
  _roamid.example.org.  TXT  "roamid-idp=<id>"
  ```

  `*.example.org` 的记录同样放在 `_roamid.example.org`。
- 一个域名只能被一个提供方声明。与其他提供方的声明重叠（相同，或被通配覆盖）时 CI 拒绝。
- CI 检查新增或改动条目的记录。RoamID 在登记表列出新域名时检查一次，此后每天检查每个域名。记录消失后，该域名自第一次检查失败起保留 48 小时权威，之后失去权威，直到记录恢复。`/status` 显示每个域名的状态。

RoamID 发给应用的声明：

| 声明 | 值 |
|---|---|
| `email` | 只要提供方给出地址就传递。 |
| `email_authority` | 提供方报告地址已验证（`email_verified` 为 true）且其域名属于该提供方已证明的域名时为 `authoritative`，否则为 `asserted`。 |
| `email_verified` | 仅当 `email_authority` 为 `authoritative` 时为 `true`。 |

## 4. 健康检查

RoamID 每 5 分钟载入每个启用中提供方的 discovery 文档与 JWKS，记录 `up`、`degraded`（能载入但不再满足第 1 节）或 `down`（无法载入）。选择页标出 degraded 与不可用的提供方，但仍然列出。`/idps` 与 `/status` 显示状态与最近错误。

## 5. 登记条目

见 [registry.md](registry.md) 与 `schema/idp.schema.json`。示例见英文版第 5 节。`id` 永久不变；退役时把 `status` 设为 `disabled`。

## 6. 检查条目

提交拉取请求前，在本地运行：

```
node scripts/check.mjs --base origin/main --probe
```

它校验条目、载入 discovery 文档并检查 TXT 记录。
