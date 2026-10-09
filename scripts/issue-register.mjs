#!/usr/bin/env node
// Registration issues -> pull requests. Runs on the base repository with
// main checked out (workflow issue-register.yml). The issue body is data:
// it is parsed into fields, the entry is built and validated by
// scripts/scaffold.mjs, and only the resulting JSON is committed to a bot
// branch issue-<n> through the API. A pasted secret is removed from the
// issue and nothing is opened. The pull request then follows the normal
// path: the check workflow is dispatched for it, then the automatic review
// merges applications and identity providers that pass it.
import { readFileSync } from "node:fs";
import { buildClient, clientInstructions, buildIdp, idpInstructions, parseIssueForm, findSecrets, redactIssue, quote } from "./scaffold.mjs";
import { APP_FORM, IDP_FORM, APPEAL_FORM, labelsOf } from "./issue-forms.mjs";
import { githubApi, checkThenMerge } from "./automerge.mjs";
import { checkLogo } from "../src/registry/logo.js";

// An image attached to the issue form: only GitHub's own attachment hosts.
const ATTACH = /https:\/\/(?:github\.com\/user-attachments\/assets\/[0-9a-f-]{36}|(?:private-)?user-images\.githubusercontent\.com\/[^\s)"'<>]+)/;
export function attachmentUrl(text) {
  const m = ATTACH.exec(String(text || ""));
  return m ? m[0] : null;
}
// Download with a byte limit; the redirect goes to GitHub's storage.
async function download(url) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {} });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 200 * 1024) throw new Error("larger than 100 KB");
  return buf;
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// Returns { action: "refused"|"invalid"|"opened"|"updated"|"ignored", ... } and performs it through `api`.
export async function handleIssue(issue, { api, repo, log = console.log, appeal = postAppeal, fetchLogo = download, sleep }) {
  const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  if (labels.includes("appeal") && issue.state === "open") return handleAppeal(issue, { api, log, appeal });
  if (!labels.includes("registration") || issue.state !== "open") return { action: "ignored" };
  const kind = labels.includes("identity-provider") ? "idp" : labels.includes("application") ? "app" : null;
  if (!kind) return { action: "ignored" };
  const form = kind === "app" ? APP_FORM : IDP_FORM;
  const fields = parseIssueForm(issue.body, form);
  const comment = (body) => api(`/issues/${issue.number}/comments`, { method: "POST", body: { body } });

  const secrets = findSecrets(fields);
  if (secrets.length) {
    await api(`/issues/${issue.number}`, { method: "PATCH", body: { body: redactIssue(issue.body, labelsOf(form), secrets) } });
    await comment(`A field looked like a secret (${secrets.map((s) => quote(s, 40)).join(", ")}). It was removed from this issue and nothing was opened. Secrets never go through issues: for a client secret run \`npm run new:app\` locally, which stores only its SHA-256, or choose \`private_key_jwt\` or \`none\`. If the value was a real secret, treat it as exposed and replace it.`);
    log(`#${issue.number}: secret removed (${secrets.join(", ")})`);
    return { action: "refused", reason: "secret", fields: secrets };
  }
  if (kind === "app" && /^client_secret/.test(fields.auth || "")) {
    await comment("Client secrets are not registered through issues. Run `npm run new:app` locally (it generates the secret, shows it once and writes only its SHA-256) and open a pull request, or edit this issue to choose `private_key_jwt` or `none`.");
    return { action: "refused", reason: "client_secret" };
  }
  // The contact on GitHub is the person who opened the issue.
  fields.github = issue.user.login;
  const { entry, errors } = kind === "app" ? buildClient(fields) : buildIdp(fields);
  if (errors.length) {
    await comment(`The entry is not valid yet. Edit the issue to correct:\n\n${errors.slice(0, 20).map((e) => `- ${quote(e, 240)}`).join("\n")}`);
    return { action: "invalid", errors };
  }
  const id = kind === "app" ? entry.client_id : entry.id;
  const path = kind === "app" ? `registry/clients/${id}.json` : `registry/idps/${id}/idp.json`;
  // The optional logo (identity providers): downloaded from the attachment,
  // checked like CI. A problem becomes a comment; the entry still goes ahead.
  let logo = null;
  const logoNotes = [];
  if (kind === "idp" && fields.logo) {
    const url = attachmentUrl(fields.logo);
    if (!url) logoNotes.push("The logo field has no image attached to this issue; attach the file in the form (drag and drop).");
    else if (!/\[x\]/i.test(fields.logo_rights || "")) logoNotes.push("The logo was not added: tick \"The logo is the provider's own mark; I have the right to use it.\"");
    else {
      try {
        const bytes = await fetchLogo(url);
        const c = checkLogo(bytes, null);
        if (c.errors.length) logoNotes.push(`The logo was not added:\n\n${c.errors.map((e) => `- ${quote(e, 200)}`).join("\n")}`);
        else logo = { path: `registry/idps/${id}/logo.${c.ext}`, bytes };
      } catch (e) { logoNotes.push(`The logo could not be downloaded (${quote(e.message, 80)}); attach it again.`); }
    }
  }
  const branch = `issue-${issue.number}`;
  const exists = await api(`/contents/${path}?ref=main`).then(() => true, () => false);
  if (exists) {
    await comment(`${quote(path)} already exists on main; identifiers are permanent. Choose another identifier, or change that entry with a pull request from its contact.github.`);
    return { action: "invalid", errors: ["exists"] };
  }
  const main = await api("/git/ref/heads/main");
  const current = await api(`/git/ref/heads/${branch}`).catch(() => null);
  if (!current) await api("/git/refs", { method: "POST", body: { ref: `refs/heads/${branch}`, sha: main.object.sha } });
  // One file per issue branch: a changed identifier replaces the earlier file.
  const tree = current ? await api(`/git/trees/${current.object.sha}?recursive=1`).catch(() => null) : null;
  const keep = new Set([path, ...(logo ? [logo.path] : [])]);
  for (const t of (tree && tree.tree) || []) {
    if (t.type === "blob" && /^registry\/(clients\/[^/]+\.json|idps\/[^/]+\/(idp\.json|logo\.[a-z]+)|idps\/[^/]+\.json)$/.test(t.path) && !keep.has(t.path)) {
      const onMain = await api(`/contents/${t.path}?ref=main`).then(() => true, () => false);
      if (!onMain) await api(`/contents/${t.path}`, { method: "DELETE", body: { message: "update", sha: t.sha, branch } });
    }
  }
  const prev = await api(`/contents/${path}?ref=${branch}`).catch(() => null);
  let put = await api(`/contents/${path}`, { method: "PUT", body: { message: "update", content: b64(JSON.stringify(entry, null, 2) + "\n"), branch, ...(prev ? { sha: prev.sha } : {}) } });
  if (logo) {
    const prevLogo = await api(`/contents/${logo.path}?ref=${branch}`).catch(() => null);
    put = await api(`/contents/${logo.path}`, { method: "PUT", body: { message: "update", content: Buffer.from(logo.bytes).toString("base64"), branch, ...(prevLogo ? { sha: prevLogo.sha } : {}) } });
  }
  if (logoNotes.length) await comment(logoNotes.join("\n\n"));
  const open = await api(`/pulls?state=open&head=${repo.split("/")[0]}:${branch}`);
  let pr = open[0];
  if (!pr) {
    try {
      pr = await api("/pulls", { method: "POST", body: { title: "update", head: branch, base: "main", body: `Registration from #${issue.number} (issue form, opened by ${quote(issue.user.login, 40)}). Entries that pass the automated review are merged automatically.` } });
    } catch (e) {
      // The organization may not allow the workflow token to open pull
      // requests: the branch is ready, a maintainer opens it.
      if (!/HTTP 403/.test(e.message)) throw e;
      await api("/actions/workflows/check.yml/dispatches", { method: "POST", body: { ref: branch } });
      await comment(`The entry is on branch \`${branch}\` (${quote(path)}). A maintainer opens the pull request: https://github.com/${repo}/compare/main...${branch}?expand=1\n\n${(kind === "app" ? clientInstructions(entry) : idpInstructions(entry)).map((x) => `    ${x}`).join("\n")}`);
      log(`#${issue.number}: branch ${branch} ready; pull request not allowed for the workflow token`);
      return { action: "branch", branch, path, entry };
    }
  }
  const steps = kind === "app" ? clientInstructions(entry) : idpInstructions(entry);
  await comment(`Pull request #${pr.number} ${open[0] ? "updated" : "opened"} with ${quote(path)}${logo ? ` and ${quote(logo.path)}` : ""}.\n\n${steps.map((s) => `    ${s}`).join("\n")}\n\nWhen the checks pass and the domain is proven, it is merged automatically (the automatic review runs twice an hour) and live about 5 minutes after the merge.${kind === "idp" && /^client_secret_/.test(entry.client_auth || "") ? " With a client secret, the provider is offered once the secret has been handed over privately (SECURITY.md)." : ""}`);
  log(`#${issue.number}: ${open[0] ? "updated" : "opened"} PR #${pr.number} (${path})`);
  // Pull requests opened with the workflow token do not start pull_request
  // workflows: run the check for the branch, then the automatic review.
  const head = put && put.commit && put.commit.sha;
  if (head) await checkThenMerge(api, { branch, sha: head, pr: pr.number, log, ...(sleep ? { sleep } : {}) });
  return { action: open[0] ? "updated" : "opened", pr: pr.number, path, entry };
}

// Appeals: the statement goes to the operator's queue through the RoamID
// instance (APPEAL_TOKEN); nothing is committed.
async function postAppeal(body) {
  const r = await fetch(`${process.env.ROAMID_URL || "https://id.fadianro.am"}/admin/appeal`, { method: "POST", headers: { Authorization: `Bearer ${process.env.APPEAL_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function handleAppeal(issue, { api, log, appeal }) {
  const comment = (body) => api(`/issues/${issue.number}/comments`, { method: "POST", body: { body } });
  const f = parseIssueForm(issue.body, APPEAL_FORM);
  const secrets = findSecrets({ text: f.text || "" }).length ? ["text"] : [];
  if (secrets.length) {
    await api(`/issues/${issue.number}`, { method: "PATCH", body: { body: redactIssue(issue.body, labelsOf(APPEAL_FORM), secrets) } });
    await comment("The statement looked like it contained a secret. It was removed from this issue; please write the appeal again without it.");
    return { action: "refused", reason: "secret" };
  }
  const target_id = String(f.target_id || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,64}$/.test(target_id) || String(f.text || "").trim().length < 5) {
    await comment("The appeal needs the target identifier (client_id or identity provider id) and a statement. Edit the issue to add them.");
    return { action: "invalid" };
  }
  const r = await appeal({ issue: issue.number, login: issue.user.login, target_kind: /identity/.test(f.target_type || "") ? "idp" : "app", target_id, text: `${f.text}${f.decision ? `\n\nDecision record: ${f.decision}` : ""}\n\nGitHub issue #${issue.number}` });
  if (r.status === 404) { await comment(`${quote(target_id, 64)} is not a registered application or identity provider. Edit the issue to correct it.`); return { action: "invalid" }; }
  if (r.status !== 200) { log(`#${issue.number}: appeal not delivered (${r.status})`); throw new Error(`appeal endpoint: HTTP ${r.status}`); }
  if (!r.body.duplicate) await comment("Received. The appeal is in the operator's queue; the decision is recorded in transparency/ and answered here.");
  log(`#${issue.number}: appeal ${r.body.id}`);
  return { action: "appeal", id: r.body.id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repo = process.env.GITHUB_REPOSITORY;
  await handleIssue(event.issue, { api: githubApi(repo, process.env.GITHUB_TOKEN), repo });
}
