#!/usr/bin/env node
// Automatic merge of application pull requests (registry/clients only).
//
// Runs on the base repository (workflow_run after "check", and on a
// schedule) with the base branch checked out. It never checks out or runs
// code from a pull request: the diff and the changed files are read through
// the GitHub API as data, and reviewed with this branch's code.
//
// A pull request is merged when
//   - the "check" workflow succeeded for its head commit;
//   - every changed file is registry/clients/<client_id>.json, added or
//     modified (no removal, no rename, nothing else);
//   - a modified entry's pull request is opened by the GitHub account in the
//     entry's contact.github on the base branch, which stays the same;
//   - every changed entry passes the registry rules and the automated
//     application review (scripts/review-clients.mjs), domain proof included.
// Otherwise it comments once per head commit with the reasons and leaves the
// pull request to a person.
//
//   node scripts/automerge.mjs [--pr <n>] [--dry-run]
import { readTree, toDoc } from "./lib.mjs";
import { validateRegistry } from "../src/registry/validate.js";
import { reviewClients } from "./review-clients.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run") || process.env.DRY_RUN === "true";
const only = args.includes("--pr") ? Number(args[args.indexOf("--pr") + 1]) : Number(process.env.PR || 0) || null;
const repo = process.env.GITHUB_REPOSITORY || "FadianRoam/roamid";
const token = process.env.GITHUB_TOKEN;
const api = async (path, { method = "GET", body } = {}) => {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return j;
};
const CLIENT_FILE = /^registry\/clients\/([a-z0-9-]{2,64})\.json$/;
const MARK = (sha) => `<!-- roamid-automerge:${sha} -->`;

async function decide(pr) {
  const reasons = [];
  const sha = pr.head.sha;
  const runs = await api(`/actions/runs?head_sha=${sha}&event=pull_request&per_page=20`);
  const check = (runs.workflow_runs || []).filter((r) => r.name === "check").sort((a, b) => b.run_number - a.run_number)[0];
  if (!check || check.status !== "completed") return { wait: true, reasons: ["the check workflow has not finished"] };
  if (check.conclusion !== "success") reasons.push(`the check workflow ended with "${check.conclusion}"`);
  const files = await api(`/pulls/${pr.number}/files?per_page=100`);
  const base = toDoc(readTree());
  const baseById = new Map(base.clients.map((c) => [c.client_id, c]));
  const changed = [];
  for (const f of files) {
    const m = CLIENT_FILE.exec(f.filename);
    if (!m) { reasons.push(`${f.filename}: only registry/clients/*.json is merged automatically`); continue; }
    if (!["added", "modified"].includes(f.status)) { reasons.push(`${f.filename}: ${f.status} (only added or modified files)`); continue; }
    const c = await api(`/contents/${encodeURIComponent(f.filename).replace(/%2F/g, "/")}?ref=${sha}`);
    let entry;
    try { entry = JSON.parse(Buffer.from(c.content, "base64").toString("utf8")); } catch { reasons.push(`${f.filename}: not JSON`); continue; }
    if (entry.client_id !== m[1]) { reasons.push(`${f.filename}: the file name must equal client_id`); continue; }
    const before = baseById.get(entry.client_id);
    if (f.status === "modified" || before) {
      const owner = before && before.contact && before.contact.github;
      if (!owner || owner.toLowerCase() !== pr.user.login.toLowerCase()) reasons.push(`${f.filename}: changes to an existing application are merged automatically only when opened by its contact.github (${owner || "-"})`);
      if (before && entry.contact && entry.contact.github !== before.contact.github) reasons.push(`${f.filename}: contact.github cannot change in an automatic merge`);
    }
    changed.push(entry);
  }
  if (!files.length) reasons.push("no files changed");
  if (!reasons.length) {
    const merged = { idps: base.idps, clients: [...base.clients.filter((c) => !changed.some((e) => e.client_id === c.client_id)), ...changed] };
    const { dropped } = validateRegistry(merged, { strict: true });
    for (const d of dropped) if (changed.some((e) => e.client_id === d.id)) reasons.push(`${d.id}: ${d.errors.join("; ")}`);
    if (!reasons.length) for (const r of await reviewClients(changed, merged)) for (const e of r.errors) reasons.push(`${r.id}: ${e.field}: ${e.message} (${e.code})`);
  }
  return { reasons, sha };
}

const prs = only ? [await api(`/pulls/${only}`)] : await api("/pulls?state=open&per_page=50");
for (const pr of prs) {
  if (pr.state !== "open" || pr.draft) continue;
  const d = await decide(pr).catch((e) => ({ reasons: [`review failed: ${e.message}`], error: true }));
  if (d.wait) { console.log(`#${pr.number}: waiting (${d.reasons[0]})`); continue; }
  if (!d.reasons.length) {
    console.log(`#${pr.number}: ${dry ? "would merge" : "merging"} ${pr.head.sha}`);
    if (!dry) {
      await api(`/pulls/${pr.number}/merge`, { method: "PUT", body: { merge_method: "squash", commit_title: "update", commit_message: "", sha: pr.head.sha } });
      // A merge with GITHUB_TOKEN does not start the push workflow: start the publish explicitly.
      await api("/actions/workflows/publish.yml/dispatches", { method: "POST", body: { ref: pr.base.ref } });
    }
    continue;
  }
  console.log(`#${pr.number}: not merged automatically:\n  - ${d.reasons.join("\n  - ")}`);
  if (dry || d.error || !d.sha) continue;
  const comments = await api(`/issues/${pr.number}/comments?per_page=100`);
  if (comments.some((c) => c.body.includes(MARK(d.sha)))) continue;
  await api(`/issues/${pr.number}/comments`, { method: "POST", body: { body: `${MARK(d.sha)}\nAutomatic review did not merge this pull request. A maintainer can still review it.\n\n${d.reasons.map((r) => `- ${r}`).join("\n")}\n\nRules: docs/rp-integration.md, section 1 and section 12.` } });
}
