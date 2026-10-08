# Error codes (v1) / 错误码

Shown on the RoamID error page together with a request ID, and sent to the application as `error_description=roamid:<code>` where the error is returned to it ([rp-integration.md](rp-integration.md) section 7). When reporting a problem, quote the code and the request ID.

RoamID 错误页显示错误码与请求 ID;错误返回给应用时以 `error_description=roamid:<code>` 给出([rp-integration.md](zh-CN/rp-integration.md) 第 7 节)。报告问题时请提供错误码与请求 ID。

| Code / 错误码 | English | 中文 |
|---|---|---|
| `invalid_client` | The application is not registered with RoamID, or it has been disabled. | 此应用未在 RoamID 登记,或已被停用。 |
| `invalid_redirect_uri` | The return address does not match the application's registration. | 返回地址与应用登记的地址不一致。 |
| `tx_expired` | This sign-in has expired or was already used. Start again from the application. | 此次登录已过期或已使用。请从应用重新开始。 |
| `tx_browser` | This sign-in was started in a different browser or the cookie was blocked. Start again from the application in this browser. | 此次登录在另一个浏览器中开始,或 cookie 被阻止。请在当前浏览器中从应用重新开始。 |
| `idp_unknown` | This identity provider is not in the registry. | 登记表中没有这个身份提供方。 |
| `idp_disabled` | This identity provider is disabled. | 此身份提供方已停用。 |
| `idp_not_allowed` | This application does not accept this identity provider. | 此应用不接受这个身份提供方。 |
| `upstream_issuer_mismatch` | The response came from a different identity provider than the one chosen. | 回应来自与所选不同的身份提供方。 |
| `upstream_discovery_failed` | The identity provider's configuration could not be loaded. | 无法载入身份提供方的配置。 |
| `upstream_unreachable` | The identity provider could not be reached. | 无法连接身份提供方。 |
| `upstream_bad_response` | The identity provider returned an invalid response. | 身份提供方返回了无效回应。 |
| `upstream_jwks_failed` | The identity provider's signing keys could not be loaded. | 无法载入身份提供方的签名密钥。 |
| `upstream_token_failed` | The identity provider did not complete the sign-in. | 身份提供方未完成登录。 |
| `upstream_id_token_invalid` | The identity provider's ID token did not pass verification. | 身份提供方的 ID 令牌未通过校验。 |
| `upstream_userinfo_mismatch` | The identity provider returned inconsistent user information. | 身份提供方返回的用户信息不一致。 |
| `upstream_not_configured` | This identity provider is not configured on this RoamID instance. | 此 RoamID 实例未配置这个身份提供方。 |
| `upstream_error` | The identity provider returned an error. | 身份提供方返回了错误。 |
| `rate_limited` | Too many requests from this address. Wait a minute and try again. | 此地址的请求过多。请等一分钟后再试。 |
| `registry_unavailable` | The registry is not loaded yet. Try again in a minute. | 登记表尚未载入。请一分钟后再试。 |
| `not_found` | This page does not exist. | 此页面不存在。 |
| `server_error` | An internal error occurred. | 发生内部错误。 |

Errors that an identity provider returns in its authorization response are counted as `upstream_<error>` and passed to the application as described in rp-integration.md.

身份提供方在授权响应中返回的错误记为 `upstream_<error>`,按 rp-integration.md 所述转交应用。
