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

## 7. SAML 2.0 身份提供方

`"protocol": "saml2"` 的条目描述一个 SAML 2.0 身份提供方（例如 SAML 模式下的 Keycloak、Authentik、SimpleSAMLphp）。RoamID 是服务方。Schema：`schema/idp-saml2.schema.json`。

| 要求 | 说明 |
|---|---|
| 服务方元数据 | `https://id.fadianro.am/saml/sp/metadata.xml?idp=<id>`：实体 ID `https://id.fadianro.am/saml/sp`、签名与加密证书、ACS 地址 `https://id.fadianro.am/saml/acs/<id>`。 |
| 请求 | 由服务方发起。RoamID 以 HTTP-Redirect 向提供方的 HTTP-Redirect `SingleSignOnService` 发送签名的 `AuthnRequest`（RSA-SHA256）。 |
| 响应绑定 | HTTP-POST 到 `https://id.fadianro.am/saml/acs/<id>`。 |
| 签名 | `Response` 或 `Assertion`（或两者）必须用条目或其元数据中的证书签名。签名算法：RSA-SHA256、RSA-SHA512、ECDSA-SHA256/384/512；摘要：SHA-256、SHA-512；规范化：不带注释的排他 XML 规范化（`http://www.w3.org/2001/10/xml-exc-c14n#`）；变换只允许 enveloped-signature 与排他规范化。每个签名恰好一个 `Reference`，指向被签名元素的 ID。拒绝 SHA-1。 |
| 断言 | 恰好一个 `Assertion` 或 `EncryptedAssertion`，且是 `Response` 的直接子元素；文档内 ID 唯一；断言 ID 只接受一次。 |
| 校验 | `Destination` 与 `Recipient` 等于 ACS 地址；`InResponseTo` 等于请求 ID；`Issuer` 等于实体 ID；`Audience` 等于 RoamID 的实体 ID；`NotBefore`/`NotOnOrAfter` 允许 120 秒时钟偏差；bearer 主体确认。 |
| 加密 | 可选。内容加密必须为 AES-GCM（`http://www.w3.org/2009/xmlenc11#aes128-gcm` 或 `#aes256-gcm`）。AES-CBC（`xmlenc#aes128-cbc`、`#aes256-cbc`）只在 `Response` 本身有签名时接受：未经认证的 CBC 可被攻击者用来解密加密断言（Jager 与 Somorovsky，2011）。密钥传输：RSA-OAEP（`xmlenc#rsa-oaep-mgf1p`，或 OAEP 与 MGF1 摘要相同的 `xmlenc11#rsa-oaep`）；拒绝 RSA PKCS#1 v1.5。加密断言解密或解析的任何失败都给出同一个错误 `saml_invalid_response`。 |
| 主体标识 | `sub_source` 为 `nameid`（`persistent` 格式的 NameID），或一个稳定、不会转给他人的属性名（`urn:oid:1.3.6.1.4.1.5923.1.1.1.6` eduPersonPrincipalName、`urn:oasis:names:tc:SAML:attribute:subject-id`、`urn:oasis:names:tc:SAML:attribute:pairwise-id`）。`transient` NameID 不能作为主体标识。 |
| 属性 | 默认读取：`mail`/`urn:oid:0.9.2342.19200300.100.1.3`、`displayName`/`urn:oid:2.16.840.1.113730.3.1.241`、`cn`、`uid`/`urn:oid:0.9.2342.19200300.100.1.1`、`eduPersonPrincipalName`。其他名称用 `attributes` 映射。 |
| 邮箱 | `email_attribute_verified: true` 声明提供方只发出已验证的地址；此时地址在提供方已证明的 `email_domains`（第 3 节）内的，`email_authority` 为 `authoritative`。 |
| XML | 不允许 DTD 与实体声明；大于 512 KiB 的文档被拒绝。 |
| 元数据 | `metadata_url`（https）至少每 6 小时载入一次；载入失败时使用最后一份有效副本，但不超过其 `validUntil`。不给 `metadata_url` 时，条目写 `entity_id`、`sso_url`、`certs`。 |

SAML 提供方的健康状态：元数据可载入（或为内联），且当前有一张有效的签名证书。签名证书到期前 30 天，`/status` 显示警告。
