#!/usr/bin/env node
// Regenerate docs/errors.md from src/ui/i18n.js.
import { writeFileSync } from "node:fs";
import { ERROR_CODES, errorText } from "../src/ui/i18n.js";
const rows = ERROR_CODES.map((c) => `| \`${c}\` | ${errorText("en", c)} | ${errorText("zh", c)} |`).join("\n");
writeFileSync(new URL("../docs/errors.md", import.meta.url), `# Error codes (v1) / 错误码

Shown on the RoamID error page together with a request ID, and sent to the application as \`error_description=roamid:<code>\` where the error is returned to it ([rp-integration.md](rp-integration.md) section 7). SAML service providers receive a SAML Response with a non-success status and the code in \`StatusMessage\`. When reporting a problem, quote the code and the request ID.

RoamID 错误页显示错误码与请求 ID；错误返回给应用时以 \`error_description=roamid:<code>\` 给出（[rp-integration.md](zh-CN/rp-integration.md) 第 7 节）。SAML 服务方收到非成功状态的 SAML 响应，错误码在 \`StatusMessage\` 中。报告问题时请提供错误码与请求 ID。

| Code / 错误码 | English | 中文 |
|---|---|---|
${rows}

Errors that an identity provider returns are counted as \`upstream_<error>\` and passed to the application as described in rp-integration.md.

身份提供方返回的错误记为 \`upstream_<error>\`，按 rp-integration.md 所述转交应用。
`);
