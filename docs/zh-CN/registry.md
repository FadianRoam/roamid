# 登记表（v1）

[English](../registry.md)

登记表即 `registry/` 下的 JSON 文件，公开且不含任何密钥。

```
registry/idps/<id>/idp.json        身份提供方   schema/idp.schema.json
registry/idps/<id>/logo.<ext>      可选标志     png、webp 或 jpg
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
4. CI 运行测试、schema 与规则检查、对 `main` 的永久标识检查；对身份提供方还会实际载入 discovery 文档，并检查其 `domain`（新提供方必填）与邮箱域名的 TXT 记录。结果见 `check` 工作流的 job summary。
5. 两类条目都在 `check` 工作流通过、且每个条目都通过自动审核时自动合并；修改已有条目须由其 `contact.github` 中的 GitHub 账户提交。
   - 应用：只新增或修改 `registry/clients/*.json` 的拉取请求；审核规则见 [rp-integration.md](rp-integration.md) 第 12 节，含域名证明。
   - 身份提供方：只新增或修改 `registry/idps/<id>/idp.json` 及其标志的拉取请求。审核内容：`domain` 与每个邮箱域名均有 DNS TXT 证明，discovery 文档或 SAML 元数据可载入，名称按应用名称的规则检查（保留名称、已使用的名称），任何主机都不在封禁名单或黑名单中，标志通过检查（[idp-requirements.md](idp-requirements.md) 第 3 节）。使用客户端密钥的提供方，在密钥经私下渠道交接后才会提供；在此之前 `/idps` 显示为暂未开放。否则 `automerge` 作业会评论说明原因，维护者仍可人工审核。该作业在本仓库上以 `main` 的代码运行，经 GitHub API 读取拉取请求，从不运行其中的代码。约 5 分钟内条目发布到 `https://fadianroam.github.io/roamid/registry.json` 并被 RoamID 载入，`/status` 显示正在使用的提交。

`client_auth` 为 `client_secret_basic` 或 `client_secret_post` 的身份提供方，要在密钥交给运营方之后才能使用（见 [idp-requirements.md](idp-requirements.md) 第 2 节）。

## 没有列表中身份提供方的账户时

开发者控制台需要通过列表中的某个身份提供方登录。没有账户时可以改用 GitHub 登记；下面每种方式最终都是一个拉取请求，经过同样的检查（自动审核与自动合并）。

**一键：打开填好示例的新文件，然后点「Propose new file」。** 替换示例值、把文件名改为你的标识后提交，拉取请求模板会随之打开。

| 条目 | 打开 |
|---|---|
| 应用，OpenID Connect | [新建 registry/clients/… 文件](https://github.com/FadianRoam/roamid/new/main/registry/clients?filename=your-app-id.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2Fschema%2Fclient.schema.json%22%2C%0A%20%20%22client_id%22%3A%20%22example-portal%22%2C%0A%20%20%22protocol%22%3A%20%22oidc%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20Portal%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E9%97%A8%E6%88%B7%22%0A%20%20%7D%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fexample.com%2F%22%2C%0A%20%20%22domain%22%3A%20%22example.com%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-dev%22%2C%0A%20%20%20%20%22email%22%3A%20%22dev%40example.com%22%0A%20%20%7D%2C%0A%20%20%22redirect_uris%22%3A%20%5B%0A%20%20%20%20%22https%3A%2F%2Fportal.example.com%2Fauth%2Fcallback%22%0A%20%20%5D%2C%0A%20%20%22post_logout_redirect_uris%22%3A%20%5B%0A%20%20%20%20%22https%3A%2F%2Fportal.example.com%2F%22%0A%20%20%5D%2C%0A%20%20%22token_endpoint_auth_method%22%3A%20%22private_key_jwt%22%2C%0A%20%20%22jwks_uri%22%3A%20%22https%3A%2F%2Fportal.example.com%2F.well-known%2Fjwks.json%22%2C%0A%20%20%22subject_type%22%3A%20%22public%22%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=application.md) |
| 应用，SAML 2.0 | [新建 registry/clients/… 文件](https://github.com/FadianRoam/roamid/new/main/registry/clients?filename=your-app-id.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2Fschema%2Fclient-saml2.schema.json%22%2C%0A%20%20%22client_id%22%3A%20%22example-wiki%22%2C%0A%20%20%22protocol%22%3A%20%22saml2%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20Wiki%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E7%BB%B4%E5%9F%BA%22%0A%20%20%7D%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fwiki.example.com%2F%22%2C%0A%20%20%22domain%22%3A%20%22example.com%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-dev%22%2C%0A%20%20%20%20%22email%22%3A%20%22dev%40example.com%22%0A%20%20%7D%2C%0A%20%20%22entity_id%22%3A%20%22https%3A%2F%2Fwiki.example.com%2Fsaml%2Fmetadata%22%2C%0A%20%20%22acs_urls%22%3A%20%5B%0A%20%20%20%20%22https%3A%2F%2Fwiki.example.com%2Fsaml%2Facs%22%0A%20%20%5D%2C%0A%20%20%22subject_type%22%3A%20%22public%22%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=application.md) |
| 身份提供方，OpenID Connect | [新建 registry/idps/… 文件](https://github.com/FadianRoam/roamid/new/main/registry/idps?filename=your-idp-id%2Fidp.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2F..%2Fschema%2Fidp.schema.json%22%2C%0A%20%20%22id%22%3A%20%22example%22%2C%0A%20%20%22protocol%22%3A%20%22oidc%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20Community%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E7%A4%BE%E5%8C%BA%22%0A%20%20%7D%2C%0A%20%20%22issuer%22%3A%20%22https%3A%2F%2Flogin.example.org%2Frealms%2Fmain%22%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fexample.org%2F%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-admin%22%2C%0A%20%20%20%20%22email%22%3A%20%22admin%40example.org%22%0A%20%20%7D%2C%0A%20%20%22client_id%22%3A%20%22roamid%22%2C%0A%20%20%22client_auth%22%3A%20%22private_key_jwt%22%2C%0A%20%20%22scopes%22%3A%20%5B%0A%20%20%20%20%22openid%22%2C%0A%20%20%20%20%22email%22%2C%0A%20%20%20%20%22profile%22%0A%20%20%5D%2C%0A%20%20%22email_domains%22%3A%20%5B%0A%20%20%20%20%22example.org%22%0A%20%20%5D%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=identity-provider.md) |
| 身份提供方，SAML 2.0 | [新建 registry/idps/… 文件](https://github.com/FadianRoam/roamid/new/main/registry/idps?filename=your-idp-id%2Fidp.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2F..%2Fschema%2Fidp-saml2.schema.json%22%2C%0A%20%20%22id%22%3A%20%22example-saml%22%2C%0A%20%20%22protocol%22%3A%20%22saml2%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20University%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E5%A4%A7%E5%AD%A6%22%0A%20%20%7D%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fexample.edu%2F%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-admin%22%2C%0A%20%20%20%20%22email%22%3A%20%22admin%40example.edu%22%0A%20%20%7D%2C%0A%20%20%22metadata_url%22%3A%20%22https%3A%2F%2Fidp.example.edu%2Fidp%2Fshibboleth%22%2C%0A%20%20%22entity_id%22%3A%20%22https%3A%2F%2Fidp.example.edu%2Fidp%2Fshibboleth%22%2C%0A%20%20%22sub_source%22%3A%20%22urn%3Aoasis%3Anames%3Atc%3ASAML%3Aattribute%3Asubject-id%22%2C%0A%20%20%22email_attribute_verified%22%3A%20true%2C%0A%20%20%22email_domains%22%3A%20%5B%0A%20%20%20%20%22example.edu%22%0A%20%20%5D%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=identity-provider.md) |

**不用 git：填写表单。** [登记应用](https://github.com/FadianRoam/roamid/issues/new?template=register-application.yml)或[登记身份提供方](https://github.com/FadianRoam/roamid/issues/new?template=register-identity-provider.yml)。机器人把表单转为分支 `issue-<编号>` 上的拉取请求，并在议题中回复后续步骤（要发布的域名证明记录，或要在你的身份提供方处登记的回调地址）。密钥从不经过议题：看起来像密钥的字段会从议题中删除，且不会创建拉取请求。需要客户端密钥时，请使用下面的命令，或选择 `private_key_jwt` 或 `none`。机器人为该拉取请求启动 `check` 运行；对应用条目，检查通过后随即启动自动审核。

**在克隆的仓库中：引导命令。**

```
npm run new:app     # 写入 registry/clients/<client_id>.json
npm run new:idp     # 写入 registry/idps/<id>/idp.json；--logo <文件> 同时加入标志
```

命令逐项询问字段、写入文件，打印要发布的 DNS TXT 记录（或 well-known 文件），身份提供方还会打印要登记的回调地址；随后运行与 CI 相同的检查。使用 `client_secret_*` 时，它在你的机器上生成 32 字节密钥，只显示一次，文件中只写入其 SHA-256。

可直接复制的示例：[examples/](../../examples/)（`app-oidc.json`、`app-saml2.json`、`idp-oidc.json`、`idp-saml2.json`）。示例使用 `example.com` 一类域名，测试按 schema 校验它们，但不对其运行网络检查。

## 规则

| 规则 | |
|---|---|
| 文件名 | 目录 `registry/idps/<id>/` 等于 `id`；`registry/clients/<client_id>.json` 等于 `client_id` |
| 标识 | `id`:`[a-z0-9-]{2,32}`;`client_id`:`[a-z0-9-]{2,64}`；唯一 |
| 永久 | `main` 上的标识永不删除、永不改名：主体标识由它推出。退役用 `"status": "disabled"`。CI 拒绝删除与改名。 |
| 签发方 | https，不含查询与片段，在身份提供方之间唯一 |
| 邮箱域名 | 在身份提供方之间唯一（含通配重叠）；每个都要 TXT 证明 |
| 回调地址 | https，或回环主机上的 http；精确匹配；不含片段与通配符 |
| 规模 | 至多 500 个身份提供方、5000 个应用 |

## 身份提供方标志

身份提供方可以在条目旁加入一个标志：`registry/idps/<id>/logo.png`、`logo.webp` 或 `logo.jpg`。它显示在 `/idps` 与登录选择页中名称的右侧。没有标志时显示带名称首字母的方块。

| 规则 | |
|---|---|
| 格式 | PNG、WebP 或 JPEG；类型按文件内容判断，且须与扩展名一致。不接受 SVG。 |
| 大小 | 不超过 100 KB |
| 尺寸 | 每边 64 至 512 像素；宽高比 1:1 至 2:1 |
| 内容 | 非动画；图像结束后不得有其他数据 |
| 权利 | 本身份提供方自己的标志，提交者有权使用 |

CI 检查该文件，并在拉取请求摘要中列出所有问题；自动审核执行同样的检查。提交者声明该标志是提供方自己的标志。模仿其他组织标志的图像可以举报（`/report`），经审核后移除，必要时连同条目一起移除。发布步骤把文件以内容哈希命名放在 `registry.json` 旁，并在条目中描述（`logo`：`path`、`sha256`、`type`、`width`、`height`；不写在 `idp.json` 中）。RoamID 从同一来源下载、再次检查，并在 `https://id.fadianro.am/logos/<id>.<哈希>.<扩展名>` 提供；页面从不从 GitHub 加载。

## 运行时的条目状态

RoamID 载入登记表时会再次校验每个条目。不合格的条目被跳过，原因列在 `/status`；其余条目照常使用。发布的文件无法获取或解析时，RoamID 保留最后一份成功载入的副本。
