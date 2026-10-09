#!/usr/bin/env node
// Automatic merge of registry pull requests: applications (registry/clients)
// and identity providers (registry/idps/<id>/idp.json and logo).
//
// Runs on the base repository (workflow_run after "check", and on a
// schedule) with the base branch checked out. It never checks out or runs
// code from a pull request: the diff and the changed files are read through
// the GitHub API as data, and reviewed with this branch's code.
//
// A pull request is merged when
//   - it targets main of this repository;
//   - the "check" workflow succeeded for its head commit;
//   - it changes at most MAX_FILES files, every one of them listed (the
//     paginated list is complete and matches changed_files), and every one
//     is registry/clients/<client_id>.json, added or modified;
//   - a modified entry's pull request is opened by the GitHub account in the
//     entry's contact.github on the base branch, which stays the same;
//   - every changed entry passes the registry rules and the automated
//     application review (scripts/review-clients.mjs), domain proof included;
//   - identity providers instead: only registry/idps/<id>/idp.json and
//     registry/idps/<id>/logo.<png|webp|jpg>, not mixed with applications;
//     at most one logo per provider, passing the logo checks; a change to an
//     existing provider is opened by its contact.github, which stays the
//     same; every changed entry passes the automated provider review
//     (scripts/review-idps.mjs): the operator's domain and the email domains
//     proven by DNS TXT, discovery or SAML metadata loaded, the name checked,
//     no banned or listed host. A new provider needs no particular author:
//     the domain proof shows who operates it;
//   - the head commit and the file count are unchanged right before merging.
// The transparency record is merged the same way when the pull request was
// opened by github-actions[bot] from a transparency/ branch and changes only
// transparency/YYYY/MM.md and .json (scripts/transparency-sync.mjs).
// A review that cannot complete (live data or a block list unavailable)
// leaves the pull request for the next run. Otherwise it comments once per
// head commit with the reasons and leaves the pull request to a person.
//
//   node scripts/automerge.mjs [--pr <n>] [--dry-run]
import { readTree, toDoc } from "./lib.mjs";
import { validateRegistry } from "../src/registry/validate.js";
import { checkLogo } from "../src/registry/logo.js";
import { reviewClients } from "./review-clients.mjs";
import { reviewIdps } from "./review-idps.mjs";

export const MAX_FILES = 20;
const CLIENT_FILE = /^registry\/clients\/([a-z0-9-]{2,64})\.json$/;
const TRANSPARENCY_FILE = /^transparency\/\d{4}\/\d{2}\.(md|json)$/;
const IDP_FILE = /^registry\/idps\/([a-z0-9-]{2,32})\/(idp\.json|logo\.(png|webp|jpg))$/;
export const BOT = "github-actions[bot]";
const MARK = (sha) => `<!-- roamid-automerge:${sha} -->`;

export function githubApi(repo, token, fetchFn = fetch) {
  return async (path, { method = "GET", body } = {}) => {
    const r = await fetchFn(`https://api.github.com/repos/${repo}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
    return j;
  };
}

// Every file of a pull request, page by page.
export async function listFiles(api, number) {
  const all = [];
  for (let page = 1; page <= 40; page++) {
    const batch = await api(`/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("unexpected file list");
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// { merge: true } | { wait: reason } | { reasons: [...] }
export async function decide(pr, { api, repo, base = toDoc(readTree()), review = reviewClients, reviewIdp = reviewIdps, maxFiles = MAX_FILES }) {
  const reasons = [];
  const sha = pr.head.sha;
  if (pr.base.ref !== "main" || !pr.base.repo || pr.base.repo.full_name !== repo) return { reasons: ["only pull requests to main of this repository are merged automatically"], sha };
  if (!(pr.changed_files >= 1)) return { reasons: ["no files changed"], sha };
  if (pr.changed_files > maxFiles) return { reasons: [`${pr.changed_files} files: at most ${maxFiles} files are merged automatically`], sha };
  // The check run for this exact commit: from the pull_request event, or
  // dispatched for a bot branch (only the repository can dispatch).
  const runs = await api(`/actions/runs?head_sha=${sha}&per_page=20`);
  // A pull_request run that GitHub holds for approval ("action_required", for
  // pull requests opened by the workflow token) never ran: it is not a
  // verdict, the dispatched run for the same commit is.
  const check = (runs.workflow_runs || []).filter((r) => r.name === "check" && (r.event === "pull_request" || r.event === "workflow_dispatch") && r.conclusion !== "action_required").sort((a, b) => b.run_number - a.run_number)[0];
  if (!check || check.status !== "completed") return { wait: "the check workflow has not finished" };
  if (check.conclusion !== "success") reasons.push(`the check workflow ended with "${check.conclusion}"`);
  const files = await listFiles(api, pr.number);
  if (files.length !== pr.changed_files) return { reasons: [...reasons, `the file list is incomplete (${files.length} of ${pr.changed_files})`], sha };
  // The transparency record: only the bot, only its branch, only its files.
  if (files.some((f) => TRANSPARENCY_FILE.test(f.filename))) {
    for (const f of files) {
      if (!TRANSPARENCY_FILE.test(f.filename)) reasons.push(`${f.filename}: a transparency pull request changes only transparency/YYYY/MM.md and .json`);
      else if (!["added", "modified"].includes(f.status)) reasons.push(`${f.filename}: ${f.status} (only added or modified files)`);
    }
    if (!pr.user || pr.user.login !== BOT) reasons.push(`transparency/ is merged automatically only when ${BOT} opened the pull request`);
    if (!/^transparency\/\d{4}-\d{2}-\d{2}$/.test(pr.head && pr.head.ref || "") || !pr.head.repo || pr.head.repo.full_name !== repo) reasons.push("transparency/ is merged automatically only from a transparency/<date> branch of this repository");
    return reasons.length ? { reasons, sha } : { merge: true, sha };
  }
  if (files.some((f) => f.filename.startsWith("registry/idps/"))) return decideIdps(pr, files, { api, base, reviewIdp, reasons });
  const baseById = new Map(base.clients.map((c) => [c.client_id, c]));
  const changed = [];
  for (const f of files) {
    const m = CLIENT_FILE.exec(f.filename);
    if (!m) { reasons.push(`${f.filename}: only registry/clients/*.json is merged automatically`); continue; }
    if (!["added", "modified"].includes(f.status)) { reasons.push(`${f.filename}: ${f.status} (only added or modified files)`); continue; }
    const c = await api(`/contents/${f.filename}?ref=${sha}`);
    let entry;
    try { entry = JSON.parse(Buffer.from(c.content, "base64").toString("utf8")); } catch { reasons.push(`${f.filename}: not JSON`); continue; }
    if (!entry || entry.client_id !== m[1]) { reasons.push(`${f.filename}: the file name must equal client_id`); continue; }
    const before = baseById.get(entry.client_id);
    if (f.status === "modified" || before) {
      const owner = before && before.contact && before.contact.github;
      if (!owner || owner.toLowerCase() !== String(pr.user && pr.user.login).toLowerCase()) reasons.push(`${f.filename}: changes to an existing application are merged automatically only when opened by its contact.github (${owner || "-"})`);
      if (before && (!entry.contact || entry.contact.github !== before.contact.github)) reasons.push(`${f.filename}: contact.github cannot change in an automatic merge`);
    }
    changed.push(entry);
  }
  if (!reasons.length) {
    const merged = { idps: base.idps, clients: [...base.clients.filter((c) => !changed.some((e) => e.client_id === c.client_id)), ...changed] };
    const { dropped } = validateRegistry(merged, { strict: true });
    for (const d of dropped) if (changed.some((e) => e.client_id === d.id)) reasons.push(`${d.id}: ${d.errors.join("; ")}`);
    if (!reasons.length) {
      const r = await review(changed, merged);
      if (r.temporary) return { wait: r.reason };
      for (const x of r.results) for (const e of x.errors) reasons.push(`${x.id}: ${e.field}: ${e.message} (${e.code})`);
    }
  }
  return reasons.length ? { reasons, sha } : { merge: true, sha };
}

// Identity provider pull requests (see the rules at the top).
async function decideIdps(pr, files, { api, base, reviewIdp, reasons }) {
  const sha = pr.head.sha;
  const author = String(pr.user && pr.user.login).toLowerCase();
  const ids = new Set();
  const logos = [];
  for (const f of files) {
    const m = IDP_FILE.exec(f.filename);
    if (!m) { reasons.push(`${f.filename}: an identity provider pull request changes only registry/idps/<id>/idp.json and logo.<png|webp|jpg>`); continue; }
    if (!["added", "modified"].includes(f.status)) { reasons.push(`${f.filename}: ${f.status} (only added or modified files)`); continue; }
    ids.add(m[1]);
    if (m[2] !== "idp.json") logos.push({ id: m[1], path: f.filename, ext: m[3] });
  }
  if (reasons.length) return { reasons, sha };
  const baseById = new Map(base.idps.map((i) => [i.id, i]));
  const changed = [];
  for (const id of ids) {
    const path = `registry/idps/${id}/idp.json`;
    let entry;
    try { entry = JSON.parse(Buffer.from((await api(`/contents/${path}?ref=${sha}`)).content, "base64").toString("utf8")); } catch { reasons.push(`${path}: missing or not JSON`); continue; }
    if (!entry || entry.id !== id) { reasons.push(`${path}: the directory name must equal id`); continue; }
    if ("logo" in entry) reasons.push(`${path}: logo is set by the publish step; add the image as registry/idps/${id}/logo.<ext>`);
    const before = baseById.get(id);
    if (before) {
      const owner = before.contact && before.contact.github;
      if (!owner || owner.toLowerCase() !== author) reasons.push(`registry/idps/${id}/: changes to an existing identity provider are merged automatically only when opened by its contact.github (${owner || "-"})`);
      if (!entry.contact || entry.contact.github !== (before.contact && before.contact.github)) reasons.push(`${path}: contact.github cannot change in an automatic merge`);
    }
    // At most one logo in the directory on the head commit.
    const dir = await api(`/contents/registry/idps/${id}?ref=${sha}`).catch(() => []);
    if (Array.isArray(dir) && dir.filter((x) => /^logo\./.test(x.name)).length > 1) reasons.push(`registry/idps/${id}/: at most one logo file`);
    changed.push(entry);
  }
  for (const l of logos) {
    let bytes;
    try { bytes = Buffer.from((await api(`/contents/${l.path}?ref=${sha}`)).content, "base64"); } catch { reasons.push(`${l.path}: cannot be read`); continue; }
    for (const e of checkLogo(new Uint8Array(bytes), l.ext).errors) reasons.push(`${l.path}: ${e}`);
  }
  if (!reasons.length) {
    const merged = { idps: [...base.idps.filter((i) => !ids.has(i.id)), ...changed], clients: base.clients };
    const { dropped } = validateRegistry(merged, { strict: true });
    for (const d of dropped) if (ids.has(d.id)) reasons.push(`${d.id}: ${d.errors.join("; ")}`);
    if (!reasons.length) {
      const r = await reviewIdp(changed, merged);
      if (r.temporary) return { wait: r.reason };
      for (const x of r.results) for (const e of x.errors) reasons.push(`${x.id}: ${e.field}: ${e.message} (${e.code})`);
    }
  }
  return reasons.length ? { reasons, sha, idp: true } : { merge: true, sha };
}

export async function run({ api, repo, only, dry, base, review, reviewIdp, log = console.log, published = null }) {
  // The list endpoint leaves out changed_files (and other detail fields): every
  // pull request is read again on its own before it is reviewed.
  const listed = only ? [{ number: only }] : await api("/pulls?state=open&per_page=50");
  const prs = [];
  for (const p of listed) prs.push(await api(`/pulls/${p.number}`));
  const merged = [];
  for (const pr of prs) {
    // Drafts are never merged; a dry run of one named pull request may review a draft.
    if (pr.state !== "open" || (pr.draft && !(only && dry))) continue;
    const d = await decide(pr, { api, repo, base, review, reviewIdp }).catch((e) => ({ reasons: [`review failed: ${e.message}`], error: true }));
    if (d.wait) { log(`#${pr.number}: waiting (${d.wait})`); continue; }
    if (d.merge) {
      // Right before merging: the same head and the same files.
      const now = await api(`/pulls/${pr.number}`);
      if (now.head.sha !== d.sha || now.changed_files !== pr.changed_files || now.state !== "open") { log(`#${pr.number}: changed during review, next run`); continue; }
      log(`#${pr.number}: ${dry ? "would merge" : "merging"} ${d.sha}`);
      if (!dry) {
        await api(`/pulls/${pr.number}/merge`, { method: "PUT", body: { merge_method: "squash", commit_title: "update", commit_message: "", sha: d.sha } });
        // A merge with GITHUB_TOKEN does not start the push workflow: start the publish explicitly.
        await api("/actions/workflows/publish.yml/dispatches", { method: "POST", body: { ref: "main" } });
        merged.push(pr.number);
      }
      continue;
    }
    log(`#${pr.number}: not merged automatically:\n  - ${d.reasons.join("\n  - ")}`);
    if (dry || d.error || !d.sha) continue;
    const comments = await api(`/issues/${pr.number}/comments?per_page=100`);
    if (comments.some((c) => c.body.includes(MARK(d.sha)))) continue;
    await api(`/issues/${pr.number}/comments`, { method: "POST", body: { body: `${MARK(d.sha)}\nAutomatic review did not merge this pull request. A maintainer can still review it.\n\n${d.reasons.map((r) => `- ${r}`).join("\n")}\n\nRules: ${d.idp ? "docs/idp-requirements.md" : "docs/rp-integration.md, sections 1 and 12"}.` } });
  }
  // Reconcile: the published registry must be built from main's head. A
  // missing push event (or a merge by the workflow token) is caught here.
  if (!dry && !merged.length && published) {
    try {
      const head = (await api("/git/ref/heads/main")).object.sha;
      const live = await published();
      if (live && live !== head) { log(`published ${live.slice(0, 7)} is behind main ${head.slice(0, 7)}: dispatching publish`); await api("/actions/workflows/publish.yml/dispatches", { method: "POST", body: { ref: "main" } }); }
    } catch (e) { log(`publish reconcile skipped: ${e.message}`); }
  }
  return merged;
}

// For bot pull requests (opened with the workflow token): GitHub creates
// their pull_request "check" run but holds it ("action_required"). The
// ruleset counts only that run, so the bot releases it, for its own branch
// and the exact head commit it just pushed (a workflow-run approval, not a
// pull request review), waits for the result, then starts the automatic
// review for the pull request. Without a held run within a minute, "check"
// is dispatched on the branch instead (the schedule then completes it).
const BOT_BRANCH = /^(issue-\d+|transparency\/\d{4}-\d{2}-\d{2})$/;
export async function checkThenMerge(api, { branch, sha, pr, repo = process.env.GITHUB_REPOSITORY || "FadianRoam/roamid", wait = 420, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  if (!BOT_BRANCH.test(branch) || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`checkThenMerge: not a bot branch or commit (${branch})`);
  let released = false, dispatched = false;
  for (let t = 0; t < wait; t += 10) {
    if (t) await sleep(10000);
    const runs = ((await api(`/actions/runs?head_sha=${sha}&event=pull_request&per_page=20`)).workflow_runs || [])
      .filter((r) => r.name === "check" && r.path === ".github/workflows/check.yml" && r.event === "pull_request" && r.head_branch === branch && r.head_sha === sha && r.head_repository && r.head_repository.full_name === repo);
    const held = runs.find((r) => r.conclusion === "action_required");
    if (held && !released) { await api(`/actions/runs/${held.id}/approve`, { method: "POST" }); released = true; log(`released the held check run ${held.id} for ${sha.slice(0, 7)}`); continue; }
    const done = runs.filter((r) => r.status === "completed" && r.conclusion !== "action_required").sort((x, y) => y.run_number - x.run_number)[0];
    if (done) {
      log(`check on ${sha.slice(0, 7)}: ${done.conclusion}`);
      if (done.conclusion === "success" && pr) await api("/actions/workflows/automerge.yml/dispatches", { method: "POST", body: { ref: "main", inputs: { pr: String(pr) } } });
      return done.conclusion;
    }
    if (!runs.length && t >= 60 && !dispatched) { await api("/actions/workflows/check.yml/dispatches", { method: "POST", body: { ref: branch } }); dispatched = true; log(`no pull_request run for ${sha.slice(0, 7)}: dispatched check`); }
  }
  log(`check on ${sha.slice(0, 7)}: not finished; the scheduled automatic review picks the pull request up`);
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY || "FadianRoam/roamid";
  await run({
    api: githubApi(repo, process.env.GITHUB_TOKEN), repo,
    only: args.includes("--pr") ? Number(args[args.indexOf("--pr") + 1]) : Number(process.env.PR || 0) || null,
    dry: args.includes("--dry-run") || process.env.DRY_RUN === "true",
    published: async () => (await (await fetch(`https://fadianroam.github.io/roamid/registry.json?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) })).json()).commit,
  });
}
