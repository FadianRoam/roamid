# Operations / 运维

How to run a RoamID instance on Cloudflare Workers. The public instance at `id.fadianro.am` is run this way.
如何在 Cloudflare Workers 上运行 RoamID 实例。`id.fadianro.am` 的公开实例按此方式运行。

## Deploy / 部署

```
cp wrangler.example.toml wrangler.local.toml     # git-ignored; fill in the placeholders
export CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler d1 create roamid                    # put the database id into wrangler.local.toml
npx wrangler d1 migrations apply roamid --remote -c wrangler.local.toml
npx wrangler deploy -c wrangler.local.toml
```

The account needs a workers.dev subdomain for cron triggers, even with `workers_dev = false`.
账户需要有 workers.dev 子域名,cron 触发器才能创建(即使 `workers_dev = false`)。

## Secrets / 密钥

Set with `npx wrangler secret put <NAME> -c wrangler.local.toml`. Keep an offline copy of `SIGNING_KEYS` and `CLIENT_KEYS`: losing `CLIENT_KEYS` means every identity provider using `private_key_jwt` must register the new keys.
用 `npx wrangler secret put <NAME> -c wrangler.local.toml` 设置。`SIGNING_KEYS` 与 `CLIENT_KEYS` 要保留离线副本:丢失 `CLIENT_KEYS` 意味着所有使用 `private_key_jwt` 的身份提供方都要重新登记公钥。

| Name | Content |
|---|---|
| `SIGNING_KEYS` | JSON array of private JWKs, ES256. `node scripts/keygen.mjs signing` |
| `CLIENT_KEYS` | JSON array of private JWKs, RS256 or ES256. `node scripts/keygen.mjs client` |
| `ADMIN_TOKEN` | bearer token for `POST /admin/sync` |
| `CDN_KEY` | key of the edge's signed origin header (`X-Orbit-Origin-Sig`); without it the client address is the one Cloudflare reports |
| `IDP_SECRET_<ID>` | client secret at an identity provider using `client_secret_*` (`<ID>`: id in upper case, `-` as `_`) |

## Key rotation / 密钥轮换

The first key in `SIGNING_KEYS` signs ID tokens; every key in the array is published at `/jwks.json`. `CLIENT_KEYS` works the same way with `/client-jwks.json`.
`SIGNING_KEYS` 的第一个密钥签发 ID 令牌,数组中所有密钥都发布在 `/jwks.json`。`CLIENT_KEYS` 与 `/client-jwks.json` 同理。

1. Publish: append a new key at the end of the array and `secret put` it. It is published, not used.
   发布:把新密钥追加到数组末尾并 `secret put`。它被发布,但不使用。
2. Overlap: wait at least 24 hours, so that applications and identity providers caching the key set see the new key.
   重叠:至少等待 24 小时,让缓存公钥集的应用与身份提供方取到新密钥。
3. Switch: move the new key to the front and `secret put`.
   切换:把新密钥移到最前并 `secret put`。
4. Retire: after another 24 hours (ID tokens live 1 hour; assertions 60 seconds), remove the old key.
   退役:再过 24 小时(ID 令牌有效 1 小时,断言 60 秒)移除旧密钥。

`/status` lists the key ids and their creation dates.
`/status` 列出密钥 id 及其创建日期。

## Registry sync / 登记表同步

- The cron (every 5 minutes) fetches `REGISTRY_URL`, validates it entry by entry and stores the result in D1. On a fetch or parse failure the previous copy stays in use and the error is shown on `/status`.
  cron(每 5 分钟)获取 `REGISTRY_URL`,逐条校验并存入 D1。获取或解析失败时继续使用上一份,错误显示在 `/status`。
- Immediate sync / 立即同步: `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/admin/sync`. This also re-checks every email domain proof and probes every identity provider.
  同时重新检查所有邮箱域名证明并探测所有身份提供方。

## Runbook / 处置手册

| Situation / 情况 | Action / 处置 |
|---|---|
| Disable an identity provider quickly / 快速停用身份提供方 | Merge a pull request setting `"status": "disabled"`, then `POST /admin/sync`. Effective within seconds of the Pages deploy. For an emergency without a merge, delete its `IDP_SECRET_<ID>` (client_secret providers): sign-ins at it fail with `upstream_not_configured`. / 合并把 `status` 改为 `disabled` 的拉取请求,再 `POST /admin/sync`。紧急情况下(未合并)可删除其 `IDP_SECRET_<ID>`,该提供方的登录随即失败(`upstream_not_configured`)。 |
| Rotate keys / 轮换密钥 | See Key rotation. / 见上文。 |
| Restore the registry / 恢复登记表 | Revert the bad commit on `main` (a new commit; identifiers must not disappear), let the publish workflow run, then `POST /admin/sync`. Until then RoamID keeps serving the last copy that loaded. / 在 `main` 上以新提交撤销错误改动(标识不得消失),等发布工作流完成后 `POST /admin/sync`。在此之前 RoamID 继续使用最后一份成功载入的副本。 |
| A domain proof is lost / 域名证明失效 | `/status` shows `grace` for 48 hours, then `lost`. Ask the provider's contact to restore the TXT record, then `POST /admin/sync`. / `/status` 先显示 48 小时 `grace`,之后 `lost`。请提供方联系人恢复 TXT 记录,然后 `POST /admin/sync`。 |
