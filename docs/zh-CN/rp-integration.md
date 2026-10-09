# 应用接入（v1）

[English](../rp-integration.md)

RoamID 是标准的 OpenID Connect Provider，任何经过认证的 OpenID Connect 客户端库都可接入。本文列出参数、声明及其使用规则。代码示例见英文版第 10 节。

## 1. 登记

两种方式，经过同一套自动审核（第 12 节）：

- **开发者控制台**（推荐）：在 `https://id.fadianro.am/console` 用 RoamID 本身登录，创建应用并证明域名；全部检查通过后应用立即启用。控制台显示 `client_id`，使用 `client_secret_*` 时只显示一次密钥。
- **拉取请求**：新增 `registry/clients/<client_id>.json`（见 [registry.md](registry.md)）。只新增或修改应用条目、且通过自动审核的拉取请求会被自动合并，约 5 分钟后生效。以 `app-` 开头的 `client_id` 属于控制台，在此会被拒绝。字段：

| 字段 | 规则 |
|---|---|
| `client_id` | `[a-z0-9-]{2,64}`，与文件名一致，永久不变。 |
| `redirect_uris` | 逐字节比较。https;`http://localhost`、`http://127.0.0.1`、`http://[::1]` 仅用于开发。不得含片段与通配符。 |
| `post_logout_redirect_uris` | 可选，规则相同。 |
| `token_endpoint_auth_method` | `none`、`private_key_jwt`、`client_secret_basic` 或 `client_secret_post`。 |
| `client_secret_sha256` | 用于 `client_secret_*`：自行生成至少 32 字节随机密钥，只公开该密钥字符串的 SHA-256（十六进制）。例：`openssl rand -base64 32 \| tr -d '\n' > secret.txt; shasum -a 256 secret.txt`。不要提交密钥本身。 |
| `jwks_uri` | 用于 `private_key_jwt`：公钥的 https 地址（RS256、PS256 或 ES256）。 |
| `allowed_idps` | 可选。只提供这些身份提供方；以后加入登记表的提供方，在列入这里之前不会提供。 |
| `excluded_idps` | 可选。提供除这些以外所有启用中的身份提供方；以后加入的提供方自动提供。不能与 `allowed_idps` 同时使用。两者都不填时提供全部启用中的提供方。 |
| `subject_type` | `public`（默认）或 `pairwise`。 |
| `id_token_signed_response_alg` | 可选。`RS256`（默认）或 `ES256`：本应用收到的 ID 令牌的签名算法。 |
| `domain` | 应用的域名（第 12 节）。自动合并时必填，在选择页显示。 |

## 2. 端点

使用 discovery:`https://id.fadianro.am/.well-known/openid-configuration`。签发方为 `https://id.fadianro.am`。`/token`、`/userinfo`、discovery 与 JWKS 带 CORS 头，供单页应用使用。

## 3. 授权请求

| 参数 | |
|---|---|
| `response_type` | `code`（唯一取值） |
| `client_id`、`redirect_uri` | 与登记一致 |
| `scope` | `openid`，另加 `email` 和/或 `profile` |
| `state` | 建议 |
| `nonce` | 建议；在 ID 令牌中返回 |
| `code_challenge`、`code_challenge_method` | `S256`。`none` 客户端必须带；任何客户端带了都会校验。 |
| `idp_hint` | 可选：身份提供方 id。该提供方启用且允许该客户端使用时跳过选择页。 |
| `prompt` | 可选：`none`、`login`、`consent`、`select_account`。`login` 与 `consent` 转交提供方。`none` 需要 `idp_hint` 或浏览器中记住的选择，并转交提供方；否则返回 `interaction_required`。`select_account` 显示选择页。 |
| `max_age`、`login_hint`、`acr_values` | 可选；转交提供方 |
| `ui_locales` | 可选：`en` 或 `zh-CN`，用于选择页 |

不支持：`request`、`request_uri`、`query` 以外的 `response_mode`、隐式与混合流程。

返回到 `redirect_uri` 的参数为 `code`、`state` 与 `iss`（RFC 9207）。请核对 `iss` 为 `https://id.fadianro.am`。授权码 60 秒内有效，只能使用一次。

## 4. 令牌请求

`grant_type=authorization_code`，带 `code`、与授权请求相同的 `redirect_uri`，使用了 PKCE 时带 `code_verifier`。

| 方法 | 认证方式 |
|---|---|
| `none` | 请求体带 `client_id`；必须使用 PKCE |
| `client_secret_basic` | HTTP Basic,`client_id` 与密钥（按 RFC 6749 第 2.3.1 节表单编码） |
| `client_secret_post` | 请求体带 `client_id` 与 `client_secret` |
| `private_key_jwt` | `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` 与 `client_assertion`:JWT,`iss` = `sub` = `client_id`,`aud` 为 `https://id.fadianro.am/token` 或 `https://id.fadianro.am`,`exp` 在 10 分钟内，`jti` 唯一 |

客户端必须使用登记的方法。授权码第二次使用会被拒绝，第一次签发的访问令牌同时作废。

响应：`access_token`（不透明，1 小时）、`token_type` `Bearer`、`expires_in`、`id_token`、`scope`。不签发刷新令牌。

## 5. ID 令牌与声明

ID 令牌用 RS256 签名；条目写明 `"id_token_signed_response_alg": "ES256"`（控制台中为「ID 令牌签名」）时用 ES256。两种算法的公钥都在 `/jwks.json`，各带 `kid`、`alg` 与 `use: "sig"`，按令牌的 `kid` 选取公钥；有效期 1 小时。包含 `iss`、`aud`、`azp`、`iat`、`exp`、`nonce`（请求带了时）、`at_hash`，以及：

| 声明 | scope | 值 |
|---|---|---|
| `sub` | 总是 | RoamID 主体标识。`public`:base64url(SHA-256(`<idp id>` + "\|" + 提供方 sub)），在所有应用处相同。`pairwise`:base64url(SHA-256(`<sector>` + "\|" + `<idp id>` + "\|" + 提供方 sub)),sector 为该客户端回调地址的主机（所有回调地址必须在同一主机）。提供方自己的 sub 不会发出。 |
| `idp` | 总是 | 身份提供方的登记 id |
| `idp_name` | 总是 | 其英文名称 |
| `auth_time` | 总是 | 提供方给出时取其值，否则为 RoamID 收到登录结果的时间 |
| `acr` | 提供方给出时 | |
| `email` | `email` | 提供方给出的邮箱地址 |
| `email_verified` | `email` | 仅当 `email_authority` 为 `authoritative` 时为 `true` |
| `email_authority` | `email` | `authoritative` 或 `asserted`，见第 6 节 |
| `name`、`preferred_username`、`picture` | `profile` | 按提供方给出 |

`/userinfo` 对访问令牌返回相同的声明（不含 `auth_time`）。

## 6. 账户关联

身份提供方通过拉取请求加入，提供方可以声明任意邮箱地址。以下规则防止提供方接管属于他人的账户。

1. 应用必须以 `sub`（连同签发方 `https://id.fadianro.am`）作为账户键。同一个人在同一身份提供方处的 `sub` 稳定不变。
2. 只有当 `email_authority` 为 `authoritative` 时，应用才可以按邮箱地址自动把 RoamID 登录关联到已有的本地账户。此时该身份提供方已通过 DNS 证明它控制该地址的域名，并报告该地址已验证。
3. `email_authority` 为 `asserted` 时，应用不得自动关联，必须先让此人确认对该地址的控制（例如向该地址发送确认链接），再关联。此时即使提供方报告地址已验证，`email_verified` 也为 `false`。
4. 同一个人通过两个不同的身份提供方登录，会得到两个不同的 `sub`。是否把两者关联由应用决定，并遵守第 2、3 条。

## 7. 错误

客户端与回调地址确认之前的错误（未知 `client_id`、未登记的 `redirect_uri`）显示在 RoamID 错误页，不会重定向。其余错误以 `error`、`error_description`、`state`、`iss` 返回到 `redirect_uri`:

| `error` | 场景 |
|---|---|
| `invalid_request` | 参数缺失或无效、公开客户端缺少 PKCE、参数重复 |
| `unsupported_response_type` | `response_type` 不是 `code` |
| `invalid_scope` | 缺少 `openid` |
| `request_not_supported`、`request_uri_not_supported` | 请求对象 |
| `interaction_required` | `prompt=none` 但身份提供方未确定 |
| `login_required`、`consent_required`、`account_selection_required` | 由提供方转交 |
| `access_denied` | 用户在选择页或提供方处取消 |
| `server_error`、`temporarily_unavailable` | 提供方出错；`error_description` 为 `roamid:<code>` |

提供方出错时，用户看到带错误码与请求 ID 的 RoamID 错误页，以及返回应用的链接（`error=server_error` 或 `temporarily_unavailable`,`error_description=roamid:<code>`）。错误码见 [errors.md]（../errors.md）。

令牌端点错误按 RFC 6749 第 5.2 节：`invalid_request`、`invalid_client`（HTTP 401）、`invalid_grant`、`unsupported_grant_type`、`slow_down`（HTTP 429）。

## 8. 注销

`GET https://id.fadianro.am/logout`，带 `id_token_hint` 或 `client_id`，可选 `post_logout_redirect_uri`（必须已登记）与 `state`。RoamID 不保留登录会话：注销只清除浏览器中记住的身份提供方选择，不影响用户在身份提供方处的会话。因为 RoamID 没有会话可结束，不提供前端通道与后端通道注销。

## 9. 限额

每个客户端 IP 地址：授权请求每分钟 60 次，令牌请求每分钟 120 次，UserInfo 每分钟 300 次。每个客户端：令牌请求每分钟 600 次。超出返回 HTTP 429。

## 10. 示例

### 单页应用，不用库

`/demo` 的演示应用是完整示例（源码：`src/ui/demo.js`）。要点：

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

### Node.js，openid-client 6

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

### Python，Authlib

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

## 11. SAML 2.0 服务方

只支持 SAML 2.0 的应用登记 `"protocol": "saml2"` 的条目（schema `schema/client-saml2.schema.json`），RoamID 即成为它的 SAML 身份提供方。

```json
{
  "client_id": "example-wiki",
  "protocol": "saml2",
  "name": { "en": "Example Wiki", "zh": "示例维基" },
  "homepage": "https://wiki.example.com/",
  "contact": { "github": "example-dev", "email": "dev@example.com" },
  "entity_id": "https://wiki.example.com/saml/metadata",
  "acs_urls": ["https://wiki.example.com/saml/acs"],
  "sign_cert": "<可选：签名 AuthnRequest 的证书>",
  "subject_type": "public",
  "status": "active"
}
```

| 服务方处的设置 | 值 |
|---|---|
| IdP 元数据 | `https://id.fadianro.am/saml/idp/metadata.xml` |
| IdP 实体 ID | `https://id.fadianro.am/saml/idp` |
| SSO 地址 | `https://id.fadianro.am/saml/idp/sso`，HTTP-Redirect 或 HTTP-POST |
| 响应绑定 | HTTP-POST 到 `acs_urls` 之一（逐字节比较） |
| NameID | `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`，与 OIDC 的 `sub` 相同（public 或 pairwise；pairwise 的 sector 为 ACS 主机） |
| 签名 | Response 与 Assertion 均签名，RSA-SHA256，排他规范化；断言不加密。 |
| 有效期 | 5 分钟 |

- **AuthnRequest 签名**：条目有 `sign_cert` 时，每个 AuthnRequest 必须用它签名：Redirect 绑定签名（`SigAlg` 为 RSA-SHA256 或 RSA-SHA512），或 HTTP-POST 的 enveloped 签名。未签名或签名不符的请求以 `RequestDenied` 拒绝。`SAMLRequest`、`RelayState`、`SigAlg`、`Signature` 各只能出现一次。
- **实体 ID**：`entity_id` 须为应用 `domain` 或其子域名下的 `https://` 地址（不允许其他协议、端口或用户信息），并在登记表与开发者控制台中唯一。它是 RoamID 签发给该应用的每个断言的 Audience。
- **IdP 发起**：仅限 `"idp_initiated": true` 的条目（默认 `false`；控制台中为「允许由身份提供方发起的登录」选项）：`https://id.fadianro.am/saml/idp/sso?sp=<client_id>&RelayState=<值>` 完成登录后，把不带 `InResponseTo` 的 Response 发到第一个 ACS 地址。未启用时以 `invalid_request` 拒绝。
- **被动与强制**：`IsPassive="true"` 等同 OIDC 的 `prompt=none`（此前未选过身份提供方时返回 `NoPassive`）；`ForceAuthn="true"` 转交身份提供方。
- **错误**以非成功状态的签名 Response 返回，RoamID 错误码在 `StatusMessage` 中（见 [errors.md](../errors.md)）。用户取消登录时为 `Responder`/`AuthnFailed`。

属性（URI 名称格式；括号内为 `FriendlyName`）：

| 属性 | 声明 |
|---|---|
| `urn:oid:0.9.2342.19200300.100.1.3`（`mail`） | `email` |
| `urn:oid:2.16.840.1.113730.3.1.241`（`displayName`） | `name` |
| `urn:oid:0.9.2342.19200300.100.1.1`（`uid`） | `preferred_username` |
| `urn:roamid:claims:email_verified` | `email_verified`（`true`/`false`） |
| `urn:roamid:claims:email_authority` | `email_authority` |
| `urn:roamid:claims:idp`、`urn:roamid:claims:idp_name` | `idp`、`idp_name` |
| `urn:roamid:claims:sub` | `sub`（与 NameID 相同） |

第 6 节的账户关联规则同样适用：按 NameID 建立账户；只有 `email_authority` 为 `authoritative` 时才可按邮箱关联已有账户。

## 12. 自动审核、域名证明与限额

应用不经人工审核。通过以下检查即上线；控制台与拉取请求作业使用同一份代码（`src/apps/checks.js`）。控制台逐项显示未通过的检查及其代码；拉取请求会收到列出原因的评论。

| 检查 | 规则 | 代码 |
|---|---|---|
| 名称 | 2 至 60 个字符；字母、数字、空格与 `- _ . & ' ( )` | `name_length`、`name_chars` |
| 名称 | 不含域名（如 `example.com`） | `name_domain` |
| 名称 | 不混用拉丁字母与西里尔或希腊字母 | `name_mixed_script` |
| 名称 | 不与保留名称（[policy/reserved-names.json](../../policy/reserved-names.json)）过于相近：按形近字骨架比较（`0`→`o`、`rn`→`m`、西里尔 `о`→`o` 等），五个字符及以上的保留名称作为名称的一部分比较，较短的按整词比较 | `name_reserved` |
| 名称 | 骨架不与其他身份提供方或应用相同。例外：应用的域名是某个身份提供方已证明的 `domain`（或其子域名）时，可以使用该提供方的名称，二者属于同一运营方 | `name_taken` |
| 域名 | 主机名，如 `example.com`；不能是 IP 地址 | `domain_invalid` |
| 域名 | 不是被封禁应用的域名（或其子域名） | `domain_banned` |
| 域名与地址 | 主机不在 RoamID 每天载入的公开黑名单（URLhaus、OpenPhish）中 | `reputation` |
| 回调、注销与 ACS 地址 | 精确；https；不含账户信息、片段或通配符；主机名而非 IP 地址；为该域名或其子域名；主机能在公网 DNS 解析 | `url_https`、`url_userinfo`、`url_fragment`、`url_wildcard`、`url_ip`、`url_off_domain`、`host_unresolved` |
| 开发模式 | `http://localhost`、`http://127.0.0.1`、`http://[::1]` 仅限开发模式 | `url_localhost_active` |
| 主页 | https，在该域名下 | `url_off_domain` |
| 域名证明 | 见下文 | `domain_unproven`（拉取请求） |

**域名证明。** 发布以下之一：

```
_roamid-app.example.com.  TXT  "roamid-app=<client_id>"
https://example.com/.well-known/roamid-app.txt   含一行  <client_id>
```

控制台在创建时、点击「立即检查」时、证明缺失期间每 15 分钟、此后每天检查一次。证明消失后登录继续 72 小时，之后以 `app_unverified` 拒绝，直到证明恢复。选择页在应用名称旁显示已证明的域名，它告诉用户正在登录的是哪个站点。

**控制台应用的状态。**

| 状态 | 含义 |
|---|---|
| `development` | 有回调地址在 localhost，或域名尚未证明。只有所有者与共同所有者（最多 10 位）可以登录，其他人得到 `app_development`。 |
| `active` | 全部检查通过且域名已证明，任何人都可以登录。 |
| `suspended` | 运营方设置并注明原因。在选择页之前拒绝登录（`app_suspended`），应用收到 `access_denied`，`/token` 拒绝该应用。所有者可在控制台申诉。 |
| `banned` | 运营方对违法站点设置。与 `suspended` 相同，但不把用户送回应用，其域名不能再用于新应用。 |

**限额。** 每人最多 10 个应用；全局每天最多 200 个新应用；新应用前 7 天每天最多 500 次登录（`app_new_limit`，以 `temporarily_unavailable` 返回），运营方可提前解除。

**密钥。** 控制台只保存客户端密钥的 SHA-256，密钥只显示一次。「生成新的客户端密钥」后上一个密钥继续有效，直到「吊销上一个密钥」，服务器可以无中断切换。

**所有者。** 创建者为所有者，以其登录的 RoamID public `sub` 识别。所有者按对方 RoamID 登录的邮箱地址邀请共同所有者：控制台生成一个 7 天内有效、只能使用一次、只有该邮箱的登录才能接受的链接。所有者可以把所有权转移给共同所有者。

举报与申诉：[policy.md](policy.md)。
