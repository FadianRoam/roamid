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
账户需要有 workers.dev 子域名，cron 触发器才能创建（即使 `workers_dev = false`）。

## Secrets / 密钥

Set with `npx wrangler secret put <NAME> -c wrangler.local.toml`. Keep an offline copy of `SIGNING_KEYS` and `CLIENT_KEYS`: losing `CLIENT_KEYS` means every identity provider using `private_key_jwt` must register the new keys.
用 `npx wrangler secret put <NAME> -c wrangler.local.toml` 设置。`SIGNING_KEYS` 与 `CLIENT_KEYS` 要保留离线副本：丢失 `CLIENT_KEYS` 意味着所有使用 `private_key_jwt` 的身份提供方都要重新登记公钥。

| Name | Content |
|---|---|
| `SIGNING_KEYS` | JSON array of private JWKs, ES256. `node scripts/keygen.mjs signing` |
| `CLIENT_KEYS` | JSON array of private JWKs, RS256 or ES256. `node scripts/keygen.mjs client` |
| `ADMIN_TOKEN` | bearer token for `POST /admin/sync` |
| `CDN_KEY` | key of the edge's signed origin header (`X-Orbit-Origin-Sig`); without it the client address is the one Cloudflare reports |
| `IDP_SECRET_<ID>` | client secret at an identity provider using `client_secret_*` (`<ID>`: id in upper case, `-` as `_`) |
| `SAML_KEYS` | JSON array of `{kid, cert, key}` (PEM), SAML signing and encryption |
| `OPERATOR_SUBS` | RoamID public `sub` values (comma or space separated) allowed into `/admin/reports` |
| `VERIFY_SECRET` | Orbit Verify site secret for the report form (`VERIFY_SITEKEY` is a plain variable) |
| `HELPDESK_API_KEY` | key for the operator's help desk (`HELPDESK_URL` is a plain variable); without it new reports are only in the queue |
| `APPEAL_TOKEN` | shared with the repository secret of the same name; lets the `issue-register` workflow deliver appeals filed with the issue form (`POST /admin/appeal`) |

## Key rotation / 密钥轮换

The first key in `SIGNING_KEYS` signs ID tokens; every key in the array is published at `/jwks.json`. `CLIENT_KEYS` works the same way with `/client-jwks.json`.
`SIGNING_KEYS` 的第一个密钥签发 ID 令牌，数组中所有密钥都发布在 `/jwks.json`。`CLIENT_KEYS` 与 `/client-jwks.json` 同理。

1. Publish: append a new key at the end of the array and `secret put` it. It is published, not used.
   发布：把新密钥追加到数组末尾并 `secret put`。它被发布，但不使用。
2. Overlap: wait at least 24 hours, so that applications and identity providers caching the key set see the new key.
   重叠：至少等待 24 小时，让缓存公钥集的应用与身份提供方取到新密钥。
3. Switch: move the new key to the front and `secret put`.
   切换：把新密钥移到最前并 `secret put`。
4. Retire: after another 24 hours (ID tokens live 1 hour; assertions 60 seconds), remove the old key.
   退役：再过 24 小时（ID 令牌有效 1 小时，断言 60 秒）移除旧密钥。

`/status` lists the key ids and their creation dates, and warns when a signing or client key is older than one year.
`/status` 列出密钥 id 及其创建日期，签名或客户端密钥超过一年时显示警告。

### SAML certificates / SAML 证书

`SAML_KEYS` holds `{kid, cert, key}` pairs. The first pair signs; every certificate is published in both metadata documents, and every key is tried for encrypted assertions. Generate a pair with `openssl req -x509 -newkey rsa:3072 -nodes -days 1095 -subj "/CN=RoamID SAML" -keyout key.pem -out cert.pem` (the key as PKCS#8).
`SAML_KEYS` 保存 `{kid, cert, key}`。第一对用于签名；所有证书都发布在两份元数据中，解密加密断言时逐一尝试所有私钥。

1. Publish: append the new pair, `secret put`. Its certificate appears in `/saml/sp/metadata.xml` and `/saml/idp/metadata.xml`. / 发布：追加新的一对并 `secret put`，其证书出现在两份元数据中。
2. Overlap: identity providers and service providers that load the metadata pick it up; tell the operators of those that pasted the certificate by hand (the registry `contact`). Wait until they confirm, or at least 7 days. / 重叠：载入元数据的身份提供方与服务方会自动取到；手工粘贴证书的，通过登记表的 `contact` 通知其运营方，等其确认或至少 7 天。
3. Switch: move the new pair to the front. / 切换：把新的一对移到最前。
4. Retire: remove the old pair after another 7 days. / 退役：再过 7 天移除旧的一对。

`/status` warns 30 days before a RoamID or identity provider SAML certificate expires.
RoamID 或身份提供方的 SAML 证书到期前 30 天，`/status` 显示警告。

### Other credentials / 其他凭据

| Credential | Rotation |
|---|---|
| `IDP_SECRET_<ID>` | Create the new secret at the identity provider while the old one stays valid there, `secret put`, then remove the old one at the provider. / 在身份提供方处新建密钥（旧密钥暂保留），`secret put`，再在提供方处删除旧密钥。 |
| Console client secrets | Owners rotate in the console: "New client secret" keeps the previous one valid until "Revoke the previous secret". / 所有者在控制台轮换：「生成新的客户端密钥」后上一个继续有效，直到「吊销上一个密钥」。 |
| `ADMIN_TOKEN`, `VERIFY_SECRET`, `HELPDESK_API_KEY`, `APPEAL_TOKEN`, `CDN_KEY` | `secret put` the new value; for `VERIFY_SECRET`, `HELPDESK_API_KEY` and `APPEAL_TOKEN` change the other side (Orbit Verify site, help desk, repository secret) at the same time. / `secret put` 新值；`VERIFY_SECRET`、`HELPDESK_API_KEY` 与 `APPEAL_TOKEN` 要同时修改另一侧（Orbit Verify 站点、客服系统、仓库密钥）。 |

## Cron / 定时任务

Every 5 minutes: registry sync, email domain proofs, identity provider health (OIDC discovery and JWKS; SAML metadata refresh with the last good copy kept until `validUntil`), console application domain proofs (pending every 15 minutes, proven daily), block lists (daily), clean-up of expired rows.
每 5 分钟：登记表同步、邮箱域名证明、身份提供方健康（OIDC discovery 与 JWKS；SAML 元数据刷新，保留最后一份有效副本直到 `validUntil`）、控制台应用的域名证明（待证明的每 15 分钟、已证明的每天）、黑名单（每天）、清理过期数据。

## Abuse limits / 滥用与限额

| Limit | Value |
|---|---|
| `/authorize`, `/select`, `/callback`, SAML endpoints, `/test` | 60 per minute per address |
| `/token` | 120 per minute per address, 600 per minute per client |
| `/userinfo` | 300 per minute per address |
| `/report` | 5 per hour per address (and Orbit Verify) |
| Console form posts | 30 per minute per person |
| Console applications | 10 per person, 200 new per day in total, 500 sign-ins per day during the first 7 days |
| Registry | 500 identity providers, 5000 applications, 2 MiB |
| Upstream requests | 10 seconds each |
| SAML messages | 512 KiB, no DTD |

Addresses are stored only as truncated hashes, per window.
地址只以截断的哈希按时间窗保存。

## Registry sync / 登记表同步

- The cron (every 5 minutes) fetches `REGISTRY_URL`, validates it entry by entry and stores the result in D1. On a fetch or parse failure the previous copy stays in use and the error is shown on `/status`.
  cron（每 5 分钟）获取 `REGISTRY_URL`，逐条校验并存入 D1。获取或解析失败时继续使用上一份，错误显示在 `/status`。
- Immediate sync / 立即同步： `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/admin/sync`. This also re-checks every email domain proof and probes every identity provider.
  同时重新检查所有邮箱域名证明并探测所有身份提供方。

## Where reports appear / 举报在哪里查看

1. Help desk: each report and each appeal opens a ticket in the Trust Review group (topic "Trust Score review"). The ticket names the target and links to `https://<host>/admin/reports#<report-id>`.
   客服系统：每条举报与申诉都在 Trust Review 组（主题「Trust Score review」）新建工单，工单写明对象并链接到 `https://<host>/admin/reports#<report-id>`。
2. `/admin/reports`: the operator queue, for the accounts in `OPERATOR_SUBS`. Items are grouped by target and ordered by distinct reporters in 24 hours; `#<report-id>` scrolls to the report. Decisions and "Publish report" are taken on the target page.
   `/admin/reports`：运营方队列，仅 `OPERATOR_SUBS` 中的账户可访问。条目按对象分组，按 24 小时内不同举报者数排序；`#<report-id>` 定位到该举报。处理与「公开举报」在对象页面进行。
3. Public record: decisions at `/transparency.json` and in `transparency/` (workflow `transparency`, hourly); published reports as issues labelled `report-upheld`. Appeals filed with the issue form reach the queue through `POST /admin/appeal` (`APPEAL_TOKEN`, workflow `issue-register`).
   公开记录：处理结果见 `/transparency.json` 与 `transparency/`（工作流 `transparency`，每小时）；公开的举报为带 `report-upheld` 标签的 issue。通过 issue 表单提交的申诉经 `POST /admin/appeal`（`APPEAL_TOKEN`，工作流 `issue-register`）进入队列。

## Runbook / 处置手册

| Situation / 情况 | Action / 处置 |
|---|---|
| Disable an identity provider quickly / 快速停用身份提供方 | Emergency: `/admin/target/idp/<id>`, "Emergency disable" with a reason. It takes effect on the next request everywhere (picker, callbacks, SAML ACS) and is recorded in the audit log; "Remove override" undoes it. Permanent: merge a pull request setting `"status": "disabled"`, then `POST /admin/sync`. / 紧急：在 `/admin/target/idp/<id>` 点「紧急停用」并注明原因，下一次请求起在各处（选择页、回调、SAML ACS）生效并记入审计日志；「撤销停用」恢复。永久：合并把 `status` 改为 `disabled` 的拉取请求，再 `POST /admin/sync`。 |
| A report arrives / 收到举报 | The operator gets a help desk ticket (Trust Review group) and the item is in `/admin/reports`, ordered by distinct reporters in 24 hours. Open the target, check the site, then dismiss, warn, suspend (temporary) or ban (illegal sites; the domain is blocked for new applications). Every action needs a reason; the owner sees it. / 运营方收到客服工单（Trust Review 组），条目出现在 `/admin/reports`，按 24 小时内不同举报者数排序。打开对象、检查站点，然后驳回、警告、暂停（临时）或封禁（违法站点；其域名不能再用于新应用）。每个处理都要写原因，所有者可见。 |
| An appeal arrives / 收到申诉 | It is a new item for the same application. Restore (the application returns to `active` when its checks and domain proof hold) or keep the action and dismiss the appeal. / 申诉是同一应用的新条目。恢复（检查与域名证明仍成立时回到 `active`）或维持处理并驳回申诉。 |
| An operator loses access / 运营方无法登录 | `OPERATOR_SUBS` lists RoamID public subs. An operator signs in through any active identity provider; when that provider is disabled, use another account listed in `OPERATOR_SUBS`, or update the secret. / `OPERATOR_SUBS` 列出 RoamID public sub。运营方可经任一启用中的身份提供方登录；该提供方被停用时，用 `OPERATOR_SUBS` 中的其他账户，或更新该密钥。 |
| Automatic merges must stop / 需要停止自动合并 | Disable the `automerge` workflow in the repository's Actions settings, or remove its triggers. Pull requests then wait for a maintainer. / 在仓库 Actions 设置中停用 `automerge` 工作流，或删除其触发器；拉取请求随后等待维护者处理。 |
| Rotate keys / 轮换密钥 | See Key rotation. / 见上文。 |
| Restore the registry / 恢复登记表 | Revert the bad commit on `main` (a new commit; identifiers must not disappear), let the publish workflow run, then `POST /admin/sync`. Until then RoamID keeps serving the last copy that loaded. / 在 `main` 上以新提交撤销错误改动（标识不得消失），等发布工作流完成后 `POST /admin/sync`。在此之前 RoamID 继续使用最后一份成功载入的副本。 |
| A domain proof is lost / 域名证明失效 | `/status` shows `grace` for 48 hours, then `lost`. Ask the provider's contact to restore the TXT record, then `POST /admin/sync`. / `/status` 先显示 48 小时 `grace`，之后 `lost`。请提供方联系人恢复 TXT 记录，然后 `POST /admin/sync`。 |
