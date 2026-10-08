#!/usr/bin/env node
// Automatic merge of application pull requests (registry/clients only).
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
//   - the head commit and the file count are unchanged right before merging.
// A review that cannot complete (live data or a block list unavailable)
// leaves the pull request for the next run. Otherwise it comments once per
// head commit with the reasons and leaves the pull request to a person.
//
//   node scripts/automerge.mjs [--pr <n>] [--dry-run]
import { readTree, toDoc } from "./lib.mjs";
import { validateRegistry } from "../src/registry/validate.js";
import { reviewClients } from "./review-clients.mjs";

export const MAX_FILES = 20;
const CLIENT_FILE = /^registry\/clients\/([a-z0-9-]{2,64})\.json$/;
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
export async function decide(pr, { api, repo, base = toDoc(readTree()), review = reviewClients, maxFiles = MAX_FILES }) {
  const reasons = [];
  const sha = pr.head.sha;
  if (pr.base.ref !== "main" || !pr.base.repo || pr.base.repo.full_name !== repo) return { reasons: ["only pull requests to main of this repository are merged automatically"], sha };
  if (!(pr.changed_files >= 1)) return { reasons: ["no files changed"], sha };
  if (pr.changed_files > maxFiles) return { reasons: [`${pr.changed_files} files: at most ${maxFiles} files are merged automatically`], sha };
  const runs = await api(`/actions/runs?head_sha=${sha}&event=pull_request&per_page=20`);
  const check = (runs.workflow_runs || []).filter((r) => r.name === "check").sort((a, b) => b.run_number - a.run_number)[0];
  if (!check || check.status !== "completed") return { wait: "the check workflow has not finished" };
  if (check.conclusion !== "success") reasons.push(`the check workflow ended with "${check.conclusion}"`);
  const files = await listFiles(api, pr.number);
  if (files.length !== pr.changed_files) return { reasons: [...reasons, `the file list is incomplete (${files.length} of ${pr.changed_files})`], sha };
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

export async function run({ api, repo, only, dry, base, review, log = console.log }) {
  const prs = only ? [await api(`/pulls/${only}`)] : await api("/pulls?state=open&per_page=50");
  const merged = [];
  for (const pr of prs) {
    // Drafts are never merged; a dry run of one named pull request may review a draft.
    if (pr.state !== "open" || (pr.draft && !(only && dry))) continue;
    const d = await decide(pr, { api, repo, base, review }).catch((e) => ({ reasons: [`review failed: ${e.message}`], error: true }));
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
    await api(`/issues/${pr.number}/comments`, { method: "POST", body: { body: `${MARK(d.sha)}\nAutomatic review did not merge this pull request. A maintainer can still review it.\n\n${d.reasons.map((r) => `- ${r}`).join("\n")}\n\nRules: docs/rp-integration.md, sections 1 and 12.` } });
  }
  return merged;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY || "FadianRoam/roamid";
  await run({
    api: githubApi(repo, process.env.GITHUB_TOKEN), repo,
    only: args.includes("--pr") ? Number(args[args.indexOf("--pr") + 1]) : Number(process.env.PR || 0) || null,
    dry: args.includes("--dry-run") || process.env.DRY_RUN === "true",
  });
}
