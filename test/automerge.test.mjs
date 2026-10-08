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
function gh({ files, pr: prOver = {}, conclusion = "success", headLater } = {}) {
  const calls = [];
  const pr = { number: 7, state: "open", draft: false, head: { sha: "a".repeat(40) }, base: { ref: "main", repo: { full_name: REPO } }, user: { login: "bob" }, changed_files: files.length, ...prOver };
  let prReads = 0;
  const api = async (path, opt = {}) => {
    calls.push([opt.method || "GET", path]);
    if (path === "/pulls/7") { prReads++; return headLater ? { ...pr, head: { sha: headLater } } : pr; }
    if (path.startsWith("/pulls?")) return [pr];
    if (path.startsWith("/actions/runs")) return { workflow_runs: [{ name: "check", event: "pull_request", run_number: 3, status: "completed", conclusion }] };
    const m = /^\/pulls\/7\/files\?per_page=100&page=(\d+)$/.exec(path);
    if (m) { const p = Number(m[1]); return files.slice((p - 1) * 100, p * 100).map((f) => ({ filename: f.filename, status: f.status || "added" })); }
    if (path.startsWith("/contents/")) { const f = files.find((x) => path.startsWith(`/contents/${x.filename}?`)); return { content: b64(f.content) }; }
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
    if (u.pathname === "/apps.json") return apps ? Response.json({ apps: [{ client_id: "app-x1", name: { en: "Taken Name" } }], banned_domains: ["bad.example"] }) : new Response("down", { status: 503 });
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
  const api = async (path, opt = {}) => { calls.push([opt.method || "GET", path]); if (path.startsWith("/contents/")) { if (!opt.method) throw new Error("404"); return {}; } if (path.startsWith("/issues?")) return [{ number: 9, state: "open", body: "<!-- roamid-publication:5 -->" }]; if (path === "/issues") return { number: 10 }; return {}; };
  const fetchFn = async (u) => Response.json(String(u).includes("publications") ? { items: [{ id: 5, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-x", category: "phishing", text: "t" }, { id: 6, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-y", category: "fraud", text: "u" }], next_after: null } : { items: [{ id: 1, date: "2026-10-08T12:00:00Z", target_kind: "app", target_id: "app-x", category: "phishing", decision: "suspend", reason: "r" }], next_after: null });
  await sync({ api, fetchFn, log() {} });
  assert.equal(calls.filter(([m, p]) => m === "POST" && p === "/issues").length, 1, "publication 5 has an issue already; only 6 is opened");
  assert.ok(calls.some(([m, p]) => m === "PUT" && p === "/contents/transparency/2026/10.md"));
});
