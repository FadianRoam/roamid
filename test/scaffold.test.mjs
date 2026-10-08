// Scaffolding (npm run new:app / new:idp), the examples, and the
// registration issue forms -> pull request path, with a mocked GitHub API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { buildClient, buildIdp, parseIssueForm, findSecrets, redactIssue, quote } from "../scripts/scaffold.mjs";
import { APP_FORM, IDP_FORM } from "../scripts/issue-forms.mjs";
import { handleIssue } from "../scripts/issue-register.mjs";
import { validateClient, validateIdp } from "../src/registry/validate.js";

test("examples/ are valid entries (example.com domains: network checks are not run for examples)", () => {
  for (const f of readdirSync(new URL("../examples/", import.meta.url))) {
    const e = JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8"));
    const errs = f.startsWith("idp-") ? validateIdp(e) : validateClient(e);
    assert.deepEqual(errs, [], f);
  }
});

test("scaffold: the built entries pass the schema; offline review rules apply", () => {
  const app = buildClient({ client_id: "my-portal", name_en: "My Portal", domain: "portal.example.org", homepage: "https://portal.example.org/", redirect_uris: "https://portal.example.org/cb\nhttps://portal.example.org/cb2", auth: "client_secret_basic", client_secret_sha256: "a".repeat(64), github: "dev", email: "dev@example.org" });
  assert.deepEqual(app.errors, []);
  assert.deepEqual(validateClient(app.entry), []);
  assert.equal(app.entry.redirect_uris.length, 2);
  assert.ok(!("client_secret" in app.entry));
  const saml = buildClient({ client_id: "my-wiki", name_en: "My Wiki", domain: "example.org", homepage: "https://wiki.example.org/", protocol: "saml2", entity_id: "https://wiki.example.org/saml", acs_urls: "https://wiki.example.org/acs", github: "dev", email: "dev@example.org" });
  assert.deepEqual(saml.errors, []);
  const idp = buildIdp({ id: "my-idp", name_en: "My IdP", protocol: "oidc", issuer: "https://login.example.org", homepage: "https://example.org/", client_id: "roamid", client_auth: "private_key_jwt", email_domains: "example.org", github: "dev", email: "dev@example.org" });
  assert.deepEqual(idp.errors, []);
  assert.ok(buildClient({ client_id: "app-x1", name_en: "Gооgle", domain: "x.org", homepage: "https://x.org/", redirect_uris: "https://evil.example/cb", github: "d", email: "d@x.org" }).errors.length >= 3);
});

const appBody = (o = {}) => {
  const v = { "client_id": "issue-portal", "Name (English) / 名称（英文）": "Issue Portal", "Name (Chinese) / 名称（中文）": "_No response_", "Domain / 域名": "portal.example.org", "Homepage / 主页": "https://portal.example.org/", "Protocol / 协议": "oidc",
    "Redirect URIs (OIDC) / 回调地址": "```text\nhttps://portal.example.org/cb\n```", "Client authentication (OIDC) / 客户端认证": "none", "Subject type / 主体类型": "public", "Contact email / 联系邮箱": "dev@example.org", ...o };
  return Object.entries(v).map(([k, x]) => `### ${k}\n\n${x}`).join("\n\n");
};

test("issue form parser: values, missing fields, code fences, unknown labels", () => {
  const f = parseIssueForm(appBody({ "Unknown label": "x" }), APP_FORM);
  assert.equal(f.client_id, "issue-portal");
  assert.equal(f.name_zh, "");
  assert.equal(f.redirect_uris, "https://portal.example.org/cb");
  assert.ok(!("Unknown label" in f));
  assert.deepEqual(parseIssueForm("", APP_FORM), {});
  const dup = parseIssueForm("### client_id\n\nfirst\n\n### client_id\n\nsecond", APP_FORM);
  assert.equal(dup.client_id, "first", "a repeated label does not override");
});

test("secrets: detected, refused and removed from the issue", () => {
  const body = appBody({ "JWKS URI (private_key_jwt)": "client_secret: s3cr3t-value-123456" });
  const f = parseIssueForm(body, APP_FORM);
  assert.deepEqual(findSecrets(f), ["jwks_uri"]);
  assert.deepEqual(findSecrets({ x: "-----BEGIN PRIVATE KEY-----\nMIIE" }), ["x"]);
  assert.deepEqual(findSecrets({ name_en: "Wp4Kq9Lz8Vb2Nc7Xr5Ty1Ue6Io3Pa0Sd4Fg" }), ["name_en"], "a long random string");
  assert.deepEqual(findSecrets({ redirect_uris: "https://portal.example.org/callback/very-long-path-segment-0123456789abcdef" }), [], "URLs are not secrets");
  const red = redactIssue(body, { jwks_uri: "JWKS URI (private_key_jwt)" }, ["jwks_uri"]);
  assert.doesNotMatch(red, /s3cr3t/);
  assert.match(red, /removed/);
  assert.match(red, /issue-portal/, "the rest of the issue stays");
});

test("quoting issue text in comments: no mentions, newlines, markup or HTML", () => {
  const q = quote("@owner\n**bold** `code` <img src=x onerror=alert(1)>");
  assert.doesNotMatch(q, /@owner/);
  assert.doesNotMatch(q, /\n|<|>/);
  assert.equal((q.match(/`/g) || []).length, 2);
});

function ghMock({ exists = [] } = {}) {
  const calls = [];
  const api = async (path, opt = {}) => {
    calls.push([opt.method || "GET", path, opt.body]);
    if (path.startsWith("/contents/") && !opt.method) {
      const p = path.slice(10).split("?")[0];
      if (path.endsWith("?ref=main") && exists.includes(p)) return { sha: "s" };
      throw new Error("404");
    }
    if (path === "/git/ref/heads/main") return { object: { sha: "m".repeat(40) } };
    if (path.startsWith("/git/ref/heads/issue-")) throw new Error("404");
    if (path.startsWith("/pulls?")) return [];
    if (path === "/pulls" && opt.method === "POST") return { number: 41 };
    return {};
  };
  return { api, calls };
}
const issue = (body, o = {}) => ({ number: 9, state: "open", labels: [{ name: "registration" }, { name: "application" }], user: { login: "alice-dev" }, body, ...o });

test("issue -> pull request: valid application opens a bot PR and dispatches the check", async () => {
  const g = ghMock();
  const r = await handleIssue(issue(appBody()), { api: g.api, repo: "FadianRoam/roamid", log() {} });
  assert.equal(r.action, "opened");
  const put = g.calls.find(([m, p]) => m === "PUT" && p === "/contents/registry/clients/issue-portal.json");
  assert.ok(put, "the entry is committed");
  assert.equal(put[2].branch, "issue-9");
  assert.equal(put[2].message, "update");
  const entry = JSON.parse(Buffer.from(put[2].content, "base64").toString());
  assert.equal(entry.contact.github, "alice-dev", "contact.github is the issue author");
  assert.ok(g.calls.some(([m, p, b]) => m === "POST" && p === "/actions/workflows/check.yml/dispatches" && b.ref === "issue-9"));
});

test("issue -> refused: pasted secret (redacted, nothing committed), client secret choice, invalid fields, taken id", async () => {
  let g = ghMock();
  let r = await handleIssue(issue(appBody({ "Contact email / 联系邮箱": "password = hunter2hunter2" })), { api: g.api, repo: "FadianRoam/roamid", log() {} });
  assert.equal(r.action, "refused");
  const patch = g.calls.find(([m, p]) => m === "PATCH" && p === "/issues/9");
  assert.ok(patch && !/hunter2/.test(patch[2].body));
  assert.ok(!g.calls.some(([m]) => m === "PUT"), "nothing committed");
  g = ghMock();
  r = await handleIssue(issue(appBody({ "Client authentication (OIDC) / 客户端认证": "client_secret (use npm run new:app)" })), { api: g.api, repo: "FadianRoam/roamid", log() {} });
  assert.equal(r.reason, "client_secret");
  g = ghMock();
  r = await handleIssue(issue(appBody({ "Name (English) / 名称（英文）": "@everyone\n<b>Gооgle</b>", "Redirect URIs (OIDC) / 回调地址": "https://evil.example/cb" })), { api: g.api, repo: "FadianRoam/roamid", log() {} });
  assert.equal(r.action, "invalid");
  const c = g.calls.find(([m, p]) => m === "POST" && p === "/issues/9/comments");
  assert.doesNotMatch(c[2].body, /@everyone|<b>/, "issue text is quoted safely");
  assert.ok(!g.calls.some(([m]) => m === "PUT"));
  g = ghMock({ exists: ["registry/clients/issue-portal.json"] });
  assert.equal((await handleIssue(issue(appBody()), { api: g.api, repo: "FadianRoam/roamid", log() {} })).action, "invalid");
  g = ghMock();
  assert.equal((await handleIssue(issue(appBody(), { labels: [{ name: "application" }] }), { api: g.api, repo: "x/y", log() {} })).action, "ignored", "only labelled registration issues");
});

test("issue -> identity provider: PR for human review with the redirect URI and TXT records", async () => {
  const body = Object.entries({ "id": "issue-idp", "Name (English) / 名称（英文）": "Issue IdP", "Protocol / 协议": "oidc", "Homepage / 主页": "https://example.org/", "Issuer (OIDC)": "https://login.example.org", "Client ID at your identity provider (OIDC) / 在你的身份提供方处的客户端 ID": "roamid", "Client authentication (OIDC) / 客户端认证": "private_key_jwt", "Scopes (OIDC)": "openid email profile", "Email domains / 邮箱域名": "example.org", "Contact email / 联系邮箱": "ops@example.org" }).map(([k, v]) => `### ${k}\n\n${v}`).join("\n\n");
  const g = ghMock();
  const r = await handleIssue(issue(body, { labels: [{ name: "registration" }, { name: "identity-provider" }] }), { api: g.api, repo: "FadianRoam/roamid", log() {} });
  assert.equal(r.action, "opened");
  const c = g.calls.filter(([m, p]) => m === "POST" && p === "/issues/9/comments").pop();
  assert.match(c[2].body, /callback\/issue-idp/);
  assert.match(c[2].body, /_roamid\.example\.org/);
});
