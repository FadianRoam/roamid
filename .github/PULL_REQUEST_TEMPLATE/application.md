## Application entry / 应用条目

- File / 文件： `registry/clients/<client_id>.json`
- Application and homepage / 应用与主页：

Checklist / 检查项：

- [ ] I am the `contact.github` of this entry or a maintainer of the application. / 我是条目的 `contact.github` 或该应用的维护者。
- [ ] Redirect URIs are exact and use https (http only on localhost). / 回调地址精确且使用 https（仅 localhost 可用 http）。
- [ ] For `client_secret_*`: only `client_secret_sha256` is in the entry; the secret itself is not in this pull request. / 只提交了 `client_secret_sha256`，密钥本身不在本拉取请求中。
- [ ] The application keys accounts on `sub` and follows "Account linking" in [docs/rp-integration.md](../../docs/rp-integration.md#6-account-linking). / 应用以 `sub` 作为账户键，并遵守「账户关联」规则。
- [ ] `node scripts/check.mjs --base origin/main` passes locally. / 本地检查通过。
