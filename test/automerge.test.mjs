// The automatic merge job and the pull-request application review, with a
// mocked GitHub API and mocked network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, run, listFiles } from "../scripts/automerge.mjs";
import { reviewClients } from "../scripts/review-clients.mjs";

const REPO = "FadianRoam/roamid";
const BASE = { idps: [{ id: "yunzheng", name: { en: "YunZheng Auth" } }], clients: [{ client_id: "old-app", name: { en: "Old App" }, contact: { github: "alice" }, status: "active" }] };
const entry = (id, o = {}) => ({ client_id: id, protocol: "oidc", name: { en: `Portal ${id}` }, homepage: `https://${id}.example.org/`, domain: `${id}.example.org`, contact: { github: "bob", email: "bob@example.org" },
  redirect_uris: [`https://${id}.example.org/cb`], token_endpoint_auth_method: "none", status: "active", ...o });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

// A GitHub API double: one pull request with `files` (filename, status, content).
function gh({ files, pr: prOver = {}, conclusion = "success", headLater, runs, contents } = {}) {
  const calls = [];
  const pr = { number: 7, state: "open", draft: false, head: { sha: "a".repeat(40) }, base: { ref: "main", repo: { full_name: REPO } }, user: { login: "bob" }, changed_files: files.length, ...prOver };
  let prReads = 0;
  const api = async (path, opt = {}) => {
    calls.push([opt.method || "GET", path]);
    // headLater: the head moves after the review read it (from the second read on).
    if (path === "/pulls/7") { prReads++; return headLater && prReads > 1 ? { ...pr, head: { sha: headLater } } : pr; }
    // Like GitHub: the list endpoint has no changed_files.
    if (path.startsWith("/pulls?")) { const { changed_files, ...lite } = pr; return [lite]; }
    if (path.startsWith("/actions/runs")) return { workflow_runs: runs || [{ name: "check", event: "pull_request", run_number: 3, status: "completed", conclusion }] };
    const m = /^\/pulls\/7\/files\?per_page=100&page=(\d+)$/.exec(path);
    if (m) { const p = Number(m[1]); return files.slice((p - 1) * 100, p * 100).map((f) => ({ filename: f.filename, status: f.status || "added" })); }
    if (path.startsWith("/contents/")) {
      const f = files.find((x) => path.startsWith(`/contents/${x.filename}?`)) || (contents || []).find((x) => path.startsWith(`/contents/${x.filename}?`));
      if (f) return { content: f.raw ? Buffer.from(f.raw).toString("base64") : b64(f.content) };
      const dir = /^\/contents\/(registry\/idps\/[^/?]+)\?/.exec(path);
      if (dir) return [...files, ...(contents || [])].filter((x) => x.filename.startsWith(`${dir[1]}/`)).map((x) => ({ name: x.filename.split("/").pop() }));
      throw new Error("HTTP 404");
    }
    if (path.startsWith("/issues/7/comments") && !opt.method) return [];
    return {};
  };
  return { api, calls, pr };
}
const okReview = async (entries) => ({ results: entries.map((e) => ({ id: e.client_id, errors: [] })) });
const clientFile = (id, o) => ({ filename: `registry/clients/${id}.json`, content: entry(id, o) });
const merges = (calls) => calls.filter(([m, p]) => m === "PUT" && p.endsWith("/merge")).length;

test("automerge: a valid application pull request is merged as one squash commit named update", async () => {
  const g = gh({ files: [clientFile("new-app")] });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.equal(merges(g.calls), 1);
  assert.ok(g.calls.some(([m, p]) => m === "POST" && p === "/actions/workflows/publish.yml/dispatches"), "publish dispatched");
});

test("automerge: every page of files is read; a disallowed file on page 2 blocks the merge", async () => {
  const files = [...Array.from({ length: 100 }, (_, i) => clientFile(`app${i}x`)), { filename: "registry/idps/evil.json", content: { id: "evil" } }];
  const g = gh({ files });
  const d = await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: okReview, maxFiles: 500 });
  assert.ok(!d.merge);
  assert.ok(d.reasons.some((r) => r.startsWith("registry/idps/evil.json")), d.reasons.join("; "));
  assert.equal((await listFiles(g.api, 7)).length, 101);
});

test("automerge: an incomplete file list, another base, too many files, or a changed head never merge", async () => {
  const one = [clientFile("one-app"), clientFile("two-app")];
  let g = gh({ files: one, pr: { changed_files: 3 } });
  let d = await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: okReview });
  assert.match(d.reasons.join(), /incomplete/);
  g = gh({ files: one, pr: { base: { ref: "dev", repo: { full_name: REPO } } } });
  assert.match((await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: okReview })).reasons.join(), /main/);
  g = gh({ files: one, pr: { base: { ref: "main", repo: { full_name: "someone/fork" } } } });
  assert.ok(!(await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: okReview })).merge);
  g = gh({ files: Array.from({ length: 21 }, (_, i) => clientFile(`many${i}x`)) });
  assert.match((await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: okReview })).reasons.join(), /at most 20/);
  g = gh({ files: [clientFile("late-app")], headLater: "b".repeat(40) });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.equal(merges(g.calls), 0, "head changed during the review");
  g = gh({ files: [clientFile("red-app")], conclusion: "failure" });
  assert.ok(!(await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: okReview })).merge);
});

test("automerge: changes to an existing application only from its contact.github; a temporary review waits", async () => {
  let g = gh({ files: [{ filename: "registry/clients/old-app.json", status: "modified", content: entry("old-app", { contact: { github: "alice", email: "a@example.org" } }) }] });
  assert.match((await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: okReview })).reasons.join(), /contact\.github/);
  g = gh({ files: [clientFile("wait-app")] });
  const d = await decide(g.pr, { api: g.api, repo: REPO, base: BASE, review: async () => ({ temporary: true, reason: "list down" }) });
  assert.equal(d.wait, "list down");
  await run({ api: g.api, repo: REPO, base: BASE, review: async () => ({ temporary: true, reason: "x" }), log() {} });
  assert.equal(merges(g.calls), 0);
});

// ---- review-clients ----

function net({ apps = true, lists = true, txt = {} } = {}) {
  const fetchFn = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/apps.json") return apps ? Response.json({ apps: [{ client_id: "app-x1", name: { en: "Taken Name" } }], banned_domains: ["bad.example"], saml_entities: [{ client_id: "app-s1", entity_id: "https://wiki.held.example.org/saml" }] }) : new Response("down", { status: 503 });
    if (u.host === "urlhaus.abuse.ch" || u.host === "raw.githubusercontent.com") return lists ? new Response("") : new Response("down", { status: 502 });
    if (u.host === "cloudflare-dns.com") return Response.json({ Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] });
    return new Response("nf", { status: 404 });
  };
  const lookupTxt = async (name) => txt[name] || [];
  return { fetchFn, lookupTxt };
}
const doc = { idps: BASE.idps, clients: [] };

test("review: every status is reviewed; development is refused; disabled still gets name and URL checks", async () => {
  const n = net({ txt: { "_roamid-app.good.example.org": ["roamid-app=good"] } });
  const r = await reviewClients([entry("good"), entry("dev", { status: "development" }), entry("off", { status: "disabled", name: { en: "Gооgle" } }), entry("nop")], doc, n);
  const by = Object.fromEntries(r.results.map((x) => [x.id, x.errors.map((e) => e.code)]));
  assert.deepEqual(by.good, []);
  assert.ok(by.dev.includes("status"));
  assert.ok(by.off.includes("name_reserved") || by.off.includes("name_mixed_script"));
  assert.ok(by.nop.includes("domain_unproven"));
  const banned = await reviewClients([entry("x", { domain: "shop.bad.example", homepage: "https://shop.bad.example/", redirect_uris: ["https://shop.bad.example/cb"] })], doc, n);
  assert.ok(banned.results[0].errors.some((e) => e.code === "domain_banned"));
});

test("review fails closed: live data or a block list unavailable gives a temporary verdict", async () => {
  assert.equal((await reviewClients([entry("good")], doc, net({ apps: false }))).temporary, true);
  assert.equal((await reviewClients([entry("good")], doc, net({ lists: false }))).temporary, true);
});

test("transparency sync: values are escaped, no mentions, no markup; issues once per publication", async () => {
  const { md, renderMonth, issueFor, sync } = await import("../scripts/transparency-sync.mjs");
  const s = md("@owner <script>x</script> | **b** `c` https://evil.example");
  assert.doesNotMatch(s, /@owner|<script>|\| \*\*|https:\/\//);
  const month = renderMonth("2026-10", [{ id: 1, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-x", domain: "x.org", category: "phishing", decision: "suspend", reason: "line1\n| injected | row" }]);
  assert.equal(month.trim().split("\n").filter((l) => l.startsWith("| 1 ")).length, 1, "one row, no injected rows");
  const iss = issueFor({ id: 5, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-x", category: "phishing", text: "@everyone see <img src=x>", decision_id: 1 }, [{ id: 1, date: "2026-10-08T12:00:00Z", decision: "suspend" }]);
  assert.doesNotMatch(iss.body, /@everyone|<img/);
  const calls = [];
  const H = "d".repeat(40);
  const api = async (path, opt = {}) => {
    calls.push([opt.method || "GET", path, opt.body]);
    if (path === "/git/ref/heads/main") return { object: { sha: "m".repeat(40) } };
    if (path.startsWith("/git/ref/heads/transparency/")) throw new Error("404");
    if (path.startsWith("/contents/")) { if (!opt.method) throw new Error("404"); return { commit: { sha: H } }; }
    if (path.startsWith("/issues?")) return [{ number: 9, state: "open", body: "<!-- roamid-publication:5 -->" }];
    if (path === "/issues") return { number: 10 };
    if (path.startsWith("/pulls?")) return [];
    if (path === "/pulls") return { number: 77 };
    if (path.startsWith(`/actions/runs?head_sha=${H}&event=pull_request`)) return { workflow_runs: [{ id: 9, name: "check", path: ".github/workflows/check.yml", event: "pull_request", head_repository: { full_name: "FadianRoam/roamid" }, head_branch: "transparency/2026-10-08", head_sha: H, run_number: 2, status: "completed", conclusion: calls.some(([m, p]) => p === "/actions/runs/9/approve") ? "success" : "action_required" }] };
    return {};
  };
  const fetchFn = async (u) => Response.json(String(u).includes("publications") ? { items: [{ id: 5, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-x", category: "phishing", text: "t" }, { id: 6, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-y", category: "fraud", text: "u" }], next_after: null } : { items: [{ id: 1, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-x", category: "phishing", decision: "suspend", reason: "r" }], next_after: null });
  await sync({ api, fetchFn, log() {}, today: "2026-10-08", sleep: async () => {} });
  assert.equal(calls.filter(([m, p]) => m === "POST" && p === "/issues").length, 1, "publication 5 has an issue already; only 6 is opened");
  const puts = calls.filter(([m, p]) => m === "PUT" && p.startsWith("/contents/"));
  assert.ok(puts.length && puts.every(([, , b]) => b.branch === "transparency/2026-10-08"), "never committed to main; always to the transparency/<date> branch");
  assert.ok(puts.some(([, p]) => p === "/contents/transparency/2026/10.md"));
  assert.ok(calls.some(([m, p, b]) => m === "POST" && p === "/git/refs" && b.ref === "refs/heads/transparency/2026-10-08"));
  assert.ok(calls.some(([m, p, b]) => m === "POST" && p === "/pulls" && b.base === "main" && b.head === "transparency/2026-10-08" && b.title === "update"));
  assert.ok(calls.some(([m, p]) => m === "POST" && p === "/actions/runs/9/approve"));
  assert.ok(calls.some(([m, p, b]) => m === "POST" && p === "/actions/workflows/automerge.yml/dispatches" && b.inputs.pr === "77"));
});

test("automerge: transparency pull requests only from the bot, its branch and its files", async () => {
  const tf = (filename) => ({ filename, content: "x" });
  const bot = { user: { login: "github-actions[bot]" }, head: { sha: "a".repeat(40), ref: "transparency/2026-10-08", repo: { full_name: REPO } } };
  let g = gh({ files: [tf("transparency/2026/10.md"), tf("transparency/2026/10.json")], pr: bot });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.equal(merges(g.calls), 1, "the bot's record is merged");
  for (const [files, pr, why] of [
    [[tf("transparency/2026/10.md")], { ...bot, user: { login: "mallory" } }, "another author"],
    [[tf("transparency/2026/10.md")], { ...bot, head: { ...bot.head, ref: "issue-3" } }, "another branch"],
    [[tf("transparency/2026/10.md")], { ...bot, head: { ...bot.head, repo: { full_name: "mallory/roamid" } } }, "a fork"],
    [[tf("transparency/2026/10.md"), tf("src/index.js")], bot, "a code file alongside"],
    [[tf("transparency/2026/10.md"), tf("registry/clients/x.json")], bot, "a client file alongside"],
    [[tf("transparency/notes.md")], bot, "another file name"],
  ]) {
    g = gh({ files, pr });
    await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
    assert.equal(merges(g.calls), 0, why);
  }
  g = gh({ files: [tf("transparency/2026/10.md")], pr: bot, conclusion: "failure" });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.equal(merges(g.calls), 0, "a failed check");
});

test("workflows: every action is pinned to a full commit SHA", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  for (const f of readdirSync(new URL("../.github/workflows/", import.meta.url))) {
    const s = readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), "utf8");
    for (const m of s.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${f}: ${m[1]}`);
  }
});

test("automerge: a pull_request run held for approval is not a verdict; the dispatched run for the same commit is", async () => {
  const held = { name: "check", event: "pull_request", run_number: 9, status: "completed", conclusion: "action_required" };
  let g = gh({ files: [clientFile("bot-app")], runs: [held, { name: "check", event: "workflow_dispatch", run_number: 8, status: "completed", conclusion: "success" }] });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.equal(merges(g.calls), 1);
  g = gh({ files: [clientFile("bot-app")], runs: [held, { name: "check", event: "workflow_dispatch", run_number: 8, status: "completed", conclusion: "failure" }] });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.equal(merges(g.calls), 0, "a failed dispatched run still refuses");
  g = gh({ files: [clientFile("bot-app")], runs: [held] });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.equal(merges(g.calls), 0, "only a held run: nothing ran, nothing merged");
});

test("automerge: dispatches publish when the published registry is behind main", async () => {
  const g = gh({ files: [] });
  const api = async (path, opt) => (path === "/git/ref/heads/main" ? { object: { sha: "b".repeat(40) } } : path.startsWith("/pulls?") ? [] : g.api(path, opt));
  const calls = [];
  const spy = async (path, opt = {}) => { calls.push([opt.method || "GET", path]); return api(path, opt); };
  await run({ api: spy, repo: REPO, base: BASE, review: okReview, log() {}, published: async () => "c".repeat(40) });
  assert.ok(calls.some(([m, p]) => m === "POST" && p === "/actions/workflows/publish.yml/dispatches"));
  calls.length = 0;
  await run({ api: spy, repo: REPO, base: BASE, review: okReview, log() {}, published: async () => "b".repeat(40) });
  assert.ok(!calls.some(([m, p]) => m === "POST" && p === "/actions/workflows/publish.yml/dispatches"), "up to date: nothing");
});

test("checkThenMerge releases only the check run for its own branch, exact head commit and this repository", async () => {
  const { checkThenMerge } = await import("../scripts/automerge.mjs");
  const H = "d".repeat(40);
  const base = { name: "check", path: ".github/workflows/check.yml", event: "pull_request", head_branch: "issue-3", head_sha: H, head_repository: { full_name: REPO }, run_number: 1, status: "completed", conclusion: "action_required" };
  const bad = [
    { ...base, id: 1, head_sha: "x".repeat(40) },
    { ...base, id: 2, head_branch: "attacker" },
    { ...base, id: 3, head_repository: { full_name: "mallory/roamid" } },
    { ...base, id: 4, name: "evil", path: ".github/workflows/evil.yml" },
  ];
  let calls = [];
  const apiFor = (runs) => async (path, opt = {}) => { calls.push([opt.method || "GET", path]); return path.startsWith("/actions/runs?") ? { workflow_runs: runs } : {}; };
  assert.equal(await checkThenMerge(apiFor(bad), { branch: "issue-3", sha: H, pr: 5, repo: REPO, wait: 90, sleep: async () => {}, log() {} }), null);
  assert.ok(!calls.some(([, p]) => /approve/.test(p)), "no other branch, commit, fork or workflow is released");
  assert.ok(calls.some(([m, p]) => m === "POST" && p === "/actions/workflows/check.yml/dispatches"), "fallback dispatch");
  assert.ok(!calls.some(([, p]) => /\/reviews|automerge\.yml/.test(p)), "never a pull request review; no merge without a check");
  // A human's branch or a non-bot branch name is refused outright.
  for (const branch of ["feature", "main", "issue-3x", "transparency/latest"]) {
    await assert.rejects(checkThenMerge(apiFor([]), { branch, sha: H, pr: 5, repo: REPO, sleep: async () => {}, log() {} }), /not a bot branch/);
  }
  // The matching run is released once, then its success starts the automatic review.
  calls = [];
  let state = "action_required";
  const ok = async (path, opt = {}) => { calls.push([opt.method || "GET", path]); if (/\/approve$/.test(path)) state = "success"; return path.startsWith("/actions/runs?") ? { workflow_runs: [...bad, { ...base, id: 7, conclusion: state }] } : {}; };
  assert.equal(await checkThenMerge(ok, { branch: "issue-3", sha: H, pr: 5, repo: REPO, sleep: async () => {}, log() {} }), "success");
  assert.deepEqual(calls.filter(([, p]) => /approve/.test(p)).map(([, p]) => p), ["/actions/runs/7/approve"]);
  assert.ok(calls.some(([m, p]) => m === "POST" && p === "/actions/workflows/automerge.yml/dispatches"));
});

test("SAML entity IDs: https on the verified domain or a subdomain, unique across the registry and the console", async () => {
  const { checkApp } = await import("../src/apps/checks.js");
  const saml = (entity_id, o = {}) => ({ client_id: "wiki", protocol: "saml2", name: { en: "Example Wiki" }, domain: "example.org", homepage: "https://example.org/", entity_id, acs_urls: ["https://wiki.example.org/saml/acs"], status: "active", ...o });
  const codes = async (e) => (await checkApp(e)).errors.filter((x) => x.field === "entity_id").map((x) => x.code);
  assert.deepEqual(await codes(saml("https://wiki.example.org/saml")), [], "a subdomain");
  assert.deepEqual(await codes(saml("https://example.org/saml")), [], "the domain itself");
  for (const bad of ["https://sso.othercorp.example/saml", "urn:example:wiki", "http://wiki.example.org/saml", "https://example.org.evil.example/saml", "https://user@wiki.example.org/saml", "https://wiki.example.org:8443/saml", "notaurl"]) {
    assert.deepEqual(await codes(saml(bad)), ["entity_domain"], bad);
  }
  // A pull request may not take an entity ID that a console application holds.
  const n = net({ txt: { "_roamid-app.held.example.org": ["roamid-app=wiki2"] } });
  const r = await reviewClients([saml("https://wiki.held.example.org/saml", { client_id: "wiki2", domain: "held.example.org", homepage: "https://held.example.org/", acs_urls: ["https://wiki.held.example.org/acs"], contact: { github: "x", email: "a@held.example.org" } })], doc, n);
  assert.ok(r.results[0].errors.some((e) => e.code === "entity_taken"), JSON.stringify(r.results[0].errors));
});

test("automerge: the scheduled run reads each pull request again (the list has no changed_files)", async () => {
  const g = gh({ files: [clientFile("listed-app")] });
  await run({ api: g.api, repo: REPO, base: BASE, review: okReview, log() {} });
  assert.ok(g.calls.some(([m, p]) => m === "GET" && p === "/pulls/7"), "the full pull request was read");
  assert.equal(merges(g.calls), 1);
});

// ---- identity providers ------------------------------------------------------------
import { readFileSync } from "node:fs";
import { reviewIdps } from "../scripts/review-idps.mjs";

const idp = (id, o = {}) => ({ id, protocol: "oidc", name: { en: `Community ${id}` }, issuer: `https://login.${id}.example.org`, homepage: `https://${id}.example.org/`, domain: `${id}.example.org`,
  contact: { github: "carol", email: "ops@example.org" }, client_id: "roamid", client_auth: "private_key_jwt", scopes: ["openid", "email", "profile"], status: "active", ...o });
const IBASE = { idps: [idp("old-idp", { contact: { github: "dave", email: "d@example.org" } })], clients: [] };
const idpFile = (id, o, status) => ({ filename: `registry/idps/${id}/idp.json`, content: idp(id, o), ...(status ? { status } : {}) });
const LOGO = readFileSync(new URL("../registry/idps/jyl/logo.png", import.meta.url));
const okIdps = async (entries) => ({ results: entries.map((e) => ({ id: e.id, errors: [] })) });
const decideIdp = (g, reviewIdp = okIdps, base = IBASE) => decide(g.pr, { api: g.api, repo: REPO, base, review: okReview, reviewIdp });

test("automerge: a new identity provider that passes the automated review is merged, logo included", async () => {
  const g = gh({ files: [idpFile("new-idp"), { filename: "registry/idps/new-idp/logo.png", raw: LOGO }], pr: { user: { login: "anyone" } } });
  await run({ api: g.api, repo: REPO, base: IBASE, review: okReview, reviewIdp: okIdps, log() {} });
  assert.equal(merges(g.calls), 1, "a new provider needs no particular author: the domain proof shows the operator");
});

test("automerge: identity provider rules (contact.github for changes, no mixing, logo checks, review findings)", async () => {
  let d = await decideIdp(gh({ files: [idpFile("old-idp", { contact: { github: "dave", email: "d@example.org" } }, "modified")], pr: { user: { login: "mallory" } } }));
  assert.match(d.reasons.join(), /opened by its contact\.github \(dave\)/);
  d = await decideIdp(gh({ files: [idpFile("old-idp", { contact: { github: "dave", email: "d@example.org" }, name: { en: "Renamed" } }, "modified")], pr: { user: { login: "Dave" } } }));
  assert.ok(d.merge, JSON.stringify(d));
  d = await decideIdp(gh({ files: [idpFile("old-idp", { contact: { github: "mallory", email: "m@example.org" } }, "modified")], pr: { user: { login: "dave" } } }));
  assert.match(d.reasons.join(), /contact\.github cannot change/);
  // A logo-only change reads the entry from the head commit.
  d = await decideIdp(gh({ files: [{ filename: "registry/idps/old-idp/logo.png", raw: LOGO }], contents: [idpFile("old-idp", { contact: { github: "dave", email: "d@example.org" } })], pr: { user: { login: "dave" } } }));
  assert.ok(d.merge, JSON.stringify(d));
  d = await decideIdp(gh({ files: [idpFile("mix-idp"), clientFile("mix-app")] }));
  assert.match(d.reasons.join(), /registry\/clients\/mix-app\.json: an identity provider pull request changes only/);
  d = await decideIdp(gh({ files: [idpFile("bad-logo"), { filename: "registry/idps/bad-logo/logo.png", raw: Buffer.from("<svg/>") }] }));
  assert.match(d.reasons.join(), /logo\.png: /);
  d = await decideIdp(gh({ files: [idpFile("two-logos"), { filename: "registry/idps/two-logos/logo.png", raw: LOGO }], contents: [{ filename: "registry/idps/two-logos/logo.webp", raw: LOGO }] }));
  assert.match(d.reasons.join(), /at most one logo/);
  d = await decideIdp(gh({ files: [idpFile("wrong-dir", { id: "other-id" })] }));
  assert.match(d.reasons.join(), /directory name must equal id/);
  d = await decideIdp(gh({ files: [{ ...idpFile("gone-idp"), status: "removed" }] }));
  assert.match(d.reasons.join(), /removed/);
  d = await decideIdp(gh({ files: [idpFile("found-idp")] }), async (es) => ({ results: es.map((e) => ({ id: e.id, errors: [{ code: "domain_unproven", field: "domain", message: "no TXT" }] })) }));
  assert.equal(d.idp, true); assert.match(d.reasons.join(), /found-idp: domain: no TXT \(domain_unproven\)/);
  d = await decideIdp(gh({ files: [idpFile("wait-idp")] }), async () => ({ temporary: true, reason: "DNS down" }));
  assert.equal(d.wait, "DNS down");
  d = await decideIdp(gh({ files: [idpFile("dup-iss", { issuer: "https://login.old-idp.example.org", domain: "old-idp.example.org", homepage: "https://old-idp.example.org/" })] }));
  assert.match(d.reasons.join(), /dup-iss: issuer: already registered/);
});

test("automerge: a refused identity provider gets one comment that points to the provider requirements", async () => {
  const g = gh({ files: [idpFile("note-idp")] });
  await run({ api: g.api, repo: REPO, base: IBASE, review: okReview, reviewIdp: async (es) => ({ results: es.map((e) => ({ id: e.id, errors: [{ code: "probe", field: "issuer", message: "HTTP 404" }] })) }), log() {} });
  assert.equal(merges(g.calls), 0);
  assert.ok(g.calls.some(([m, p]) => m === "POST" && p === "/issues/7/comments"));
});

// The provider review with a mocked network: TXT, live apps, block lists, probe.
function idpNet({ txt = {}, apps = [], banned = [], blocked = "" } = {}) {
  const fetchFn = async (u) => {
    const url = String(u);
    if (url.endsWith("/apps.json")) return Response.json({ apps, banned_domains: banned });
    if (url.includes("urlhaus")) return new Response(blocked);
    if (url.includes("openphish")) return new Response("");
    return new Response("no route", { status: 599 });
  };
  return { fetchFn, lookupTxt: async (name) => txt[name] || [], probe: async () => ({ errors: [], notes: [] }) };
}
const codesOf = (r) => r.results[0].errors.map((e) => e.code);

test("reviewIdps: domain and email domains proven, names, banned and listed hosts, probe", async () => {
  const doc = { idps: [], clients: [] };
  const proof = { "_roamid.acme.example.org": ["roamid-idp=acme"] };
  const e = idp("acme", { domain: "acme.example.org", issuer: "https://login.acme.example.org", homepage: "https://acme.example.org/" });
  assert.deepEqual(codesOf(await reviewIdps([e], doc, idpNet({ txt: proof }))), []);
  assert.deepEqual(codesOf(await reviewIdps([e], doc, idpNet())), ["domain_unproven"]);
  assert.deepEqual(codesOf(await reviewIdps([{ ...e, email_domains: ["mail.example.net"] }], doc, idpNet({ txt: proof }))), ["domain_unproven"], "each email domain needs its record");
  assert.deepEqual(codesOf(await reviewIdps([{ ...e, domain: undefined }], doc, idpNet({ txt: proof }))), ["domain_missing"]);
  assert.ok(codesOf(await reviewIdps([{ ...e, name: { en: "G00gle Login" } }], doc, idpNet({ txt: proof }))).includes("name_reserved"));
  // An application with the same name blocks a provider, unless it is on the provider's domain.
  assert.deepEqual(codesOf(await reviewIdps([e], doc, idpNet({ txt: proof, apps: [{ client_id: "app-x", name: { en: "Community acme" }, domain: "other.example" }] }))), ["name_taken"]);
  assert.deepEqual(codesOf(await reviewIdps([e], doc, idpNet({ txt: proof, apps: [{ client_id: "app-x", name: { en: "Community acme" }, domain: "acme.example.org" }] }))), []);
  assert.deepEqual(codesOf(await reviewIdps([e], doc, idpNet({ txt: proof, banned: ["example.org"] }))), ["domain_banned", "domain_banned"], "each distinct host: the domain (also the homepage) and the issuer");
  assert.ok(codesOf(await reviewIdps([e], doc, idpNet({ txt: proof, blocked: "0.0.0.0 login.acme.example.org\n" }))).includes("reputation"));
  const failing = { ...idpNet({ txt: proof }), probe: async () => ({ errors: ["discovery: HTTP 404"], notes: [] }) };
  assert.deepEqual(codesOf(await reviewIdps([e], doc, failing)), ["probe"]);
  const down = { ...idpNet({ txt: proof }), fetchFn: async () => new Response("", { status: 503 }) };
  assert.equal((await reviewIdps([e], doc, down)).temporary, true, "fails closed");
});
