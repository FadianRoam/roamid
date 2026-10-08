#!/usr/bin/env node
// Registration issues -> pull requests. Runs on the base repository with
// main checked out (workflow issue-register.yml). The issue body is data:
// it is parsed into fields, the entry is built and validated by
// scripts/scaffold.mjs, and only the resulting JSON is committed to a bot
// branch issue-<n> through the API. A pasted secret is removed from the
// issue and nothing is opened. The pull request then follows the normal
// path: the check workflow is dispatched for it; applications are merged by
// the automatic review, identity providers wait for a maintainer.
import { readFileSync } from "node:fs";
import { buildClient, clientInstructions, buildIdp, idpInstructions, parseIssueForm, findSecrets, redactIssue, quote } from "./scaffold.mjs";
import { APP_FORM, IDP_FORM, labelsOf } from "./issue-forms.mjs";
import { githubApi } from "./automerge.mjs";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// Returns { action: "refused"|"invalid"|"opened"|"updated"|"ignored", ... } and performs it through `api`.
export async function handleIssue(issue, { api, repo, log = console.log }) {
  const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
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
  const path = `registry/${kind === "app" ? "clients" : "idps"}/${id}.json`;
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
  for (const t of (tree && tree.tree) || []) {
    if (/^registry\/(clients|idps)\/[^/]+\.json$/.test(t.path) && t.path !== path) {
      const onMain = await api(`/contents/${t.path}?ref=main`).then(() => true, () => false);
      if (!onMain) await api(`/contents/${t.path}`, { method: "DELETE", body: { message: "update", sha: t.sha, branch } });
    }
  }
  const prev = await api(`/contents/${path}?ref=${branch}`).catch(() => null);
  await api(`/contents/${path}`, { method: "PUT", body: { message: "update", content: b64(JSON.stringify(entry, null, 2) + "\n"), branch, ...(prev ? { sha: prev.sha } : {}) } });
  const open = await api(`/pulls?state=open&head=${repo.split("/")[0]}:${branch}`);
  let pr = open[0];
  if (!pr) pr = await api("/pulls", { method: "POST", body: { title: "update", head: branch, base: "main", body: `Registration from #${issue.number} (issue form, opened by ${quote(issue.user.login, 40)}). ${kind === "app" ? "Applications that pass the automated review are merged automatically." : "Identity providers are reviewed by a maintainer."}` } });
  // Pull requests opened with the workflow token do not start pull_request
  // workflows: run the check for the branch explicitly.
  await api("/actions/workflows/check.yml/dispatches", { method: "POST", body: { ref: branch } });
  const steps = kind === "app" ? clientInstructions(entry) : idpInstructions(entry);
  await comment(`Pull request #${pr.number} ${open[0] ? "updated" : "opened"} with ${quote(path)}.\n\n${steps.map((s) => `    ${s}`).join("\n")}\n\n${kind === "app" ? "When the checks pass and the domain is proven, it is merged automatically and live about 5 minutes later." : "A maintainer reviews identity providers (docs/registry.md)."}`);
  log(`#${issue.number}: ${open[0] ? "updated" : "opened"} PR #${pr.number} (${path})`);
  return { action: open[0] ? "updated" : "opened", pr: pr.number, path, entry };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repo = process.env.GITHUB_REPOSITORY;
  await handleIssue(event.issue, { api: githubApi(repo, process.env.GITHUB_TOKEN), repo });
}
