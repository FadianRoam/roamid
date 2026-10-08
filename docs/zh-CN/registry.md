# 登记表（v1）

[English](../registry.md)

登记表即 `registry/` 下的 JSON 文件，公开且不含任何密钥。

```
registry/idps/<id>.json            身份提供方   schema/idp.schema.json
registry/clients/<client_id>.json  应用         schema/client.schema.json
```

## 新增或修改条目

1. Fork 本仓库，新增或修改一个文件。
2. 在本地运行检查（Node.js 22.5 或更高）:
   ```
   npm test
   node scripts/check.mjs --base origin/main --probe
   ```
3. 用对应的模板提交拉取请求：身份提供方或应用。
4. CI 运行测试、schema 与规则检查、对 `main` 的永久标识检查；对身份提供方还会实际载入 discovery 文档并检查邮箱域名 TXT 记录。结果见 `check` 工作流的 job summary。
5. 身份提供方：由维护者审核并合并。应用：只新增或修改 `registry/clients/*.json` 的拉取请求，在 `check` 工作流通过、且每个条目都通过自动审核（[rp-integration.md](rp-integration.md) 第 12 节，含域名证明）时自动合并；修改已有应用须由其 `contact.github` 中的 GitHub 账户提交。否则 `automerge` 作业会评论说明原因，维护者仍可人工审核。该作业在本仓库上以 `main` 的代码运行，经 GitHub API 读取拉取请求，从不运行其中的代码。约 5 分钟内条目发布到 `https://fadianroam.github.io/roamid/registry.json` 并被 RoamID 载入，`/status` 显示正在使用的提交。

`client_auth` 为 `client_secret_basic` 或 `client_secret_post` 的身份提供方，要在密钥交给运营方之后才能使用（见 [idp-requirements.md](idp-requirements.md) 第 2 节）。

## 规则

| 规则 | |
|---|---|
| 文件名 | 等于 `id`（身份提供方）或 `client_id`（应用） |
| 标识 | `id`:`[a-z0-9-]{2,32}`;`client_id`:`[a-z0-9-]{2,64}`；唯一 |
| 永久 | `main` 上的标识永不删除、永不改名：主体标识由它推出。退役用 `"status": "disabled"`。CI 拒绝删除与改名。 |
| 签发方 | https，不含查询与片段，在身份提供方之间唯一 |
| 邮箱域名 | 在身份提供方之间唯一（含通配重叠）；每个都要 TXT 证明 |
| 回调地址 | https，或回环主机上的 http；精确匹配；不含片段与通配符 |
| 规模 | 至多 500 个身份提供方、5000 个应用 |

## 运行时的条目状态

RoamID 载入登记表时会再次校验每个条目。不合格的条目被跳过，原因列在 `/status`；其余条目照常使用。发布的文件无法获取或解析时，RoamID 保留最后一份成功载入的副本。
