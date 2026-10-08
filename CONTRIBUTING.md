# Contributing / 贡献

## Registry entries / 登记条目

Most contributions are registry entries. Follow [docs/registry.md](docs/registry.md) ([简体中文](docs/zh-CN/registry.md)) and use the pull request template for an identity provider or an application.
大部分贡献是登记条目。请按 [docs/zh-CN/registry.md](docs/zh-CN/registry.md) 操作，并使用身份提供方或应用的拉取请求模板。

One entry per pull request. The person opening the pull request must be the `contact.github` of the entry, or a maintainer of the organisation it describes.
每个拉取请求只含一个条目。提交者必须是条目中的 `contact.github`，或该条目所述组织的维护者。

## Code / 代码

- Plain ES modules, no runtime dependencies, WebCrypto only.
  纯 ES 模块，无运行时依赖，只用 WebCrypto。
- `npm test` must pass. New behaviour comes with a test in `test/`.
  `npm test` 必须通过；新行为要在 `test/` 中附测试。
- The registry rules live in `src/registry/validate.js` and are shared by CI and the Worker. Change them in one place.
  登记规则只在 `src/registry/validate.js`,CI 与 Worker 共用。
- Public text (pages, documents) is factual and in English and Simplified Chinese.
  公开文字陈述事实，提供英文与简体中文。
- Commit messages are short. Do not add trailer lines.
  提交信息简短，不加尾注行。

## Security issues / 安全问题

Do not open a public issue. See [SECURITY.md](SECURITY.md).
不要公开提交 issue，见 [SECURITY.md]（SECURITY.md）。
