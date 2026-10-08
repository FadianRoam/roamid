# 应用接入(v1)

[English](../rp-integration.md)

RoamID 是标准的 OpenID Connect Provider,任何经过认证的 OpenID Connect 客户端库都可接入。本文列出参数、声明及其使用规则。代码示例见英文版第 10 节。

## 1. 登记

提交拉取请求,新增 `registry/clients/<client_id>.json`(见 [registry.md](registry.md))。合并后约 5 分钟生效。字段:

| 字段 | 规则 |
|---|---|
| `client_id` | `[a-z0-9-]{2,64}`,与文件名一致,永久不变。 |
| `redirect_uris` | 逐字节比较。https;`http://localhost`、`http://127.0.0.1`、`http://[::1]` 仅用于开发。不得含片段与通配符。 |
| `post_logout_redirect_uris` | 可选,规则相同。 |
| `token_endpoint_auth_method` | `none`、`private_key_jwt`、`client_secret_basic` 或 `client_secret_post`。 |
| `client_secret_sha256` | 用于 `client_secret_*`:自行生成至少 32 字节随机密钥,只公开该密钥字符串的 SHA-256(十六进制)。例:`openssl rand -base64 32 \| tr -d '\n' > secret.txt; shasum -a 256 secret.txt`。不要提交密钥本身。 |
| `jwks_uri` | 用于 `private_key_jwt`:公钥的 https 地址(RS256、PS256 或 ES256)。 |
| `allowed_idps` | 可选,身份提供方 id 列表;不填则提供全部启用中的提供方。 |
| `subject_type` | `public`(默认)或 `pairwise`。 |

## 2. 端点

使用 discovery:`https://id.fadianro.am/.well-known/openid-configuration`。签发方为 `https://id.fadianro.am`。`/token`、`/userinfo`、discovery 与 JWKS 带 CORS 头,供单页应用使用。

## 3. 授权请求

| 参数 | |
|---|---|
| `response_type` | `code`(唯一取值) |
| `client_id`、`redirect_uri` | 与登记一致 |
| `scope` | `openid`,另加 `email` 和/或 `profile` |
| `state` | 建议 |
| `nonce` | 建议;在 ID 令牌中返回 |
| `code_challenge`、`code_challenge_method` | `S256`。`none` 客户端必须带;任何客户端带了都会校验。 |
| `idp_hint` | 可选:身份提供方 id。该提供方启用且允许该客户端使用时跳过选择页。 |
| `prompt` | 可选:`none`、`login`、`consent`、`select_account`。`login` 与 `consent` 转交提供方。`none` 需要 `idp_hint` 或浏览器中记住的选择,并转交提供方;否则返回 `interaction_required`。`select_account` 显示选择页。 |
| `max_age`、`login_hint`、`acr_values` | 可选;转交提供方 |
| `ui_locales` | 可选:`en` 或 `zh-CN`,用于选择页 |

不支持:`request`、`request_uri`、`query` 以外的 `response_mode`、隐式与混合流程。

返回到 `redirect_uri` 的参数为 `code`、`state` 与 `iss`(RFC 9207)。请核对 `iss` 为 `https://id.fadianro.am`。授权码 60 秒内有效,只能使用一次。

## 4. 令牌请求

`grant_type=authorization_code`,带 `code`、与授权请求相同的 `redirect_uri`,使用了 PKCE 时带 `code_verifier`。

| 方法 | 认证方式 |
|---|---|
| `none` | 请求体带 `client_id`;必须使用 PKCE |
| `client_secret_basic` | HTTP Basic,`client_id` 与密钥(按 RFC 6749 第 2.3.1 节表单编码) |
| `client_secret_post` | 请求体带 `client_id` 与 `client_secret` |
| `private_key_jwt` | `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` 与 `client_assertion`:JWT,`iss` = `sub` = `client_id`,`aud` 为 `https://id.fadianro.am/token` 或 `https://id.fadianro.am`,`exp` 在 10 分钟内,`jti` 唯一 |

客户端必须使用登记的方法。授权码第二次使用会被拒绝,第一次签发的访问令牌同时作废。

响应:`access_token`(不透明,1 小时)、`token_type` `Bearer`、`expires_in`、`id_token`、`scope`。不签发刷新令牌。

## 5. ID 令牌与声明

ID 令牌用 ES256 签名,公钥在 `/jwks.json`,带 `kid`,有效期 1 小时。包含 `iss`、`aud`、`azp`、`iat`、`exp`、`nonce`(请求带了时)、`at_hash`,以及:

| 声明 | scope | 值 |
|---|---|---|
| `sub` | 总是 | RoamID 主体标识。`public`:base64url(SHA-256(`<idp id>` + "\|" + 提供方 sub)),在所有应用处相同。`pairwise`:base64url(SHA-256(`<sector>` + "\|" + `<idp id>` + "\|" + 提供方 sub)),sector 为该客户端回调地址的主机(所有回调地址必须在同一主机)。提供方自己的 sub 不会发出。 |
| `idp` | 总是 | 身份提供方的登记 id |
| `idp_name` | 总是 | 其英文名称 |
| `auth_time` | 总是 | 提供方给出时取其值,否则为 RoamID 收到登录结果的时间 |
| `acr` | 提供方给出时 | |
| `email` | `email` | 提供方给出的邮箱地址 |
| `email_verified` | `email` | 仅当 `email_authority` 为 `authoritative` 时为 `true` |
| `email_authority` | `email` | `authoritative` 或 `asserted`,见第 6 节 |
| `name`、`preferred_username`、`picture` | `profile` | 按提供方给出 |

`/userinfo` 对访问令牌返回相同的声明(不含 `auth_time`)。

## 6. 账户关联

身份提供方通过拉取请求加入,提供方可以声明任意邮箱地址。以下规则防止提供方接管属于他人的账户。

1. 应用必须以 `sub`(连同签发方 `https://id.fadianro.am`)作为账户键。同一个人在同一身份提供方处的 `sub` 稳定不变。
2. 只有当 `email_authority` 为 `authoritative` 时,应用才可以按邮箱地址自动把 RoamID 登录关联到已有的本地账户。此时该身份提供方已通过 DNS 证明它控制该地址的域名,并报告该地址已验证。
3. `email_authority` 为 `asserted` 时,应用不得自动关联,必须先让此人确认对该地址的控制(例如向该地址发送确认链接),再关联。此时即使提供方报告地址已验证,`email_verified` 也为 `false`。
4. 同一个人通过两个不同的身份提供方登录,会得到两个不同的 `sub`。是否把两者关联由应用决定,并遵守第 2、3 条。

## 7. 错误

客户端与回调地址确认之前的错误(未知 `client_id`、未登记的 `redirect_uri`)显示在 RoamID 错误页,不会重定向。其余错误以 `error`、`error_description`、`state`、`iss` 返回到 `redirect_uri`:

| `error` | 场景 |
|---|---|
| `invalid_request` | 参数缺失或无效、公开客户端缺少 PKCE、参数重复 |
| `unsupported_response_type` | `response_type` 不是 `code` |
| `invalid_scope` | 缺少 `openid` |
| `request_not_supported`、`request_uri_not_supported` | 请求对象 |
| `interaction_required` | `prompt=none` 但身份提供方未确定 |
| `login_required`、`consent_required`、`account_selection_required` | 由提供方转交 |
| `access_denied` | 用户在选择页或提供方处取消 |
| `server_error`、`temporarily_unavailable` | 提供方出错;`error_description` 为 `roamid:<code>` |

提供方出错时,用户看到带错误码与请求 ID 的 RoamID 错误页,以及返回应用的链接(`error=server_error` 或 `temporarily_unavailable`,`error_description=roamid:<code>`)。错误码见 [errors.md](../errors.md)。

令牌端点错误按 RFC 6749 第 5.2 节:`invalid_request`、`invalid_client`(HTTP 401)、`invalid_grant`、`unsupported_grant_type`、`slow_down`(HTTP 429)。

## 8. 注销

`GET https://id.fadianro.am/logout`,带 `id_token_hint` 或 `client_id`,可选 `post_logout_redirect_uri`(必须已登记)与 `state`。RoamID 不保留登录会话:注销只清除浏览器中记住的身份提供方选择,不影响用户在身份提供方处的会话。因为 RoamID 没有会话可结束,不提供前端通道与后端通道注销。

## 9. 限额

每个客户端 IP 地址:授权请求每分钟 60 次,令牌请求每分钟 120 次,UserInfo 每分钟 300 次。每个客户端:令牌请求每分钟 600 次。超出返回 HTTP 429。
