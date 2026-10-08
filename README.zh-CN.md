# RoamID

[English](README.md)

RoamID 是社区 OpenID Connect 身份中转。应用接入 RoamID 一次,其用户即可使用本仓库公开登记表中的任一身份提供方(IdP)登录。身份提供方与应用通过拉取请求加入登记表。

- 公开实例:https://id.fadianro.am
- Discovery:https://id.fadianro.am/.well-known/openid-configuration
- 已发布的登记表:https://fadianroam.github.io/roamid/registry.json
- 许可证:Apache-2.0

## 工作方式

RoamID 对应用是 OpenID Provider,对社区身份提供方是依赖方(RP)。

```
应用 ──OIDC──▶ RoamID ──OIDC──▶ 社区 IdP(登记表中的任一条目)
     ◀─id_token─        ◀─id_token─
```

示例:一家主机服务商在客户门户加入「使用 RoamID 登录」。

1. 门户把用户送到 `https://id.fadianro.am/authorize`。
2. 用户在身份提供方列表中搜索并选择一个,例如 YunZheng Auth。应用可用 `idp_hint` 预先指定。
3. 用户在该身份提供方处登录,例如 `lemon@lab.yunzheng.space`。
4. RoamID 校验提供方的 ID 令牌(签名、签发方、受众、有效期、nonce),整理声明,向门户返回 RoamID 自己的授权码。
5. 门户在 `/token` 换取由 RoamID 签名的 ID 令牌,其中包含 `sub`、`idp`、`email`、`email_verified`、`email_authority` 与 `name`,据此让用户登录。

只有当身份提供方已通过 DNS 证明它对该地址的域名有权威时,`email_verified` 才为 `true`。见[账户关联](docs/zh-CN/rp-integration.md#6-账户关联)。

## 文档

| 文档 | 读者 |
|---|---|
| [docs/zh-CN/rp-integration.md](docs/zh-CN/rp-integration.md) | 应用:端点、客户端认证、声明、错误、示例、账户关联 |
| [docs/zh-CN/idp-requirements.md](docs/zh-CN/idp-requirements.md) | 身份提供方:兼容要求、回调地址、客户端认证、邮箱域名 |
| [docs/zh-CN/registry.md](docs/zh-CN/registry.md) | 通过拉取请求新增或修改登记条目 |
| [docs/errors.md](docs/errors.md) | 错误码(中英对照) |
| [docs/operations.md](docs/operations.md) | 运行实例:部署、密钥、轮换(中英) |
| [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)、[CHANGELOG.md](CHANGELOG.md) | |

这些文档描述的接口为第 1 版。

## 端点

| 路径 | 用途 |
|---|---|
| `/.well-known/openid-configuration` | OpenID Provider 元数据 |
| `/authorize` | 授权端点(显示身份提供方选择页) |
| `/token` | 令牌端点(授权码模式) |
| `/userinfo` | UserInfo 端点 |
| `/jwks.json` | 签发 ID 令牌的公钥(ES256) |
| `/client-jwks.json` | RoamID 在身份提供方处做 `private_key_jwt` 认证的公钥 |
| `/logout` | 依赖方发起的注销 |
| `/callback/<idp-id>` | 在各身份提供方处登记的回调地址 |
| `/idps`、`/idps.json` | 已登记的身份提供方及其状态 |
| `/status`、`/status.json` | 登记表提交、域名证明、提供方健康、密钥、每日计数 |
| `/demo` | 演示应用(使用 PKCE 的公开客户端) |
| `POST /admin/sync` | 运营方立即同步登记表(Bearer 令牌) |

## 开发

Node.js 22.5 或更高版本,无依赖。

```
npm test
node scripts/check.mjs --probe
```
