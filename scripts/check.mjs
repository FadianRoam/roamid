#!/usr/bin/env node
// Registry check for pull requests and pushes. No secrets.
//
//   node scripts/check.mjs [--base <git rev>] [--probe] [--summary <file>]
//
// 1. file names: registry/idps/<id>.json, registry/clients/<client_id>.json
// 2. every entry against the schemas and rules (src/registry/validate.js)
// 3. identifiers are permanent: nothing on --base may be removed or renamed
// 4. an identity provider added against --base declares its `domain`
// 5. --probe: for identity providers added or changed against --base, load
//    the discovery document and check the domain and email domain TXT proofs
// Exit status 1 when anything fails. --summary appends a Markdown report
// (GitHub job summary).
import { appendFileSync } from "node:fs";
import { readTree, readRevision, toDoc, idsOf } from "./lib.mjs";
import { checkLogo } from "../src/registry/logo.js";
import { validateRegistry, checkFileNames, checkImmutable, proofName, proofValue } from "../src/registry/validate.js";
import { probeIdp } from "./probe-idp.mjs";
import { proveDomain } from "../src/registry/domains.js";
import { reviewClients } from "./review-clients.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const base = opt("--base");
const probe = args.includes("--probe");
const summaryFile = opt("--summary");

const errors = [];
const report = [];
const files = readTree();
errors.push(...checkFileNames(files));
for (const f of files.filter((x) => x.kind === "logo")) {
  const c = checkLogo(f.bytes, f.ext);
  if (!c.errors.length) report.push(`- ${f.id}: logo ${f.path}, ${c.type}, ${c.width}×${c.height}, ${(f.bytes.length / 1024).toFixed(1)} KB (maintainer: check that it is the provider's own mark)`);
}
const head = toDoc(files);
const { idps, clients, dropped } = validateRegistry(head, { strict: true });
for (const d of dropped) errors.push(`${d.kind} ${d.id}: ${d.errors.join("; ")}`);
report.push(`Entries: ${idps.length} identity providers, ${clients.length} clients.`);

let changed = idps;
let added = [];
let beforeClients = new Map();
if (base) {
  const baseFiles = readRevision(base);
  if (!baseFiles) {
    errors.push(`cannot read the base revision ${base}`);
  } else {
    errors.push(...checkImmutable(idsOf(baseFiles), idsOf(files)));
    const before = new Map(baseFiles.filter((f) => f.kind === "idps" && f.json).map((f) => [f.json.id, JSON.stringify(f.json)]));
    changed = idps.filter((i) => before.get(i.id) !== JSON.stringify(i));
    added = idps.filter((i) => !before.has(i.id));
    beforeClients = new Map(baseFiles.filter((f) => f.kind === "clients" && f.json).map((f) => [f.json.client_id, JSON.stringify(f.json)]));
  }
}

// The operator's domain: required for a new provider; an older entry without
// one is reported and keeps working until it adds one.
for (const idp of added) if (!idp.domain && idp.status === "active") errors.push(`idp ${idp.id}: domain: required; the provider's own domain, proven by DNS TXT _roamid.<domain> "roamid-idp=${idp.id}"`);
for (const idp of changed) if (!idp.domain && !added.includes(idp)) report.push(`- ${idp.id}: no domain declared yet (required for new providers; add "domain" and its TXT record)`);

if (probe) {
  for (const idp of changed) {
    if (idp.status !== "active") { report.push(`- ${idp.id}: disabled, not probed`); continue; }
    const pr = await probeIdp(idp);
    for (const e of pr.errors) errors.push(`idp ${idp.id}: ${e}`);
    for (const n of pr.notes) report.push(`- ${idp.id}: ${n}`);
    for (const d of new Set([...(idp.domain ? [idp.domain] : []), ...(idp.email_domains || [])])) {
      const what = d === idp.domain ? ((idp.email_domains || []).includes(d) ? "domain and email domain" : "domain") : "email domain";
      try {
        if (await proveDomain(d, idp.id)) report.push(`- ${idp.id}: ${what} ${d} proven (${proofName(d)} TXT ${proofValue(idp.id)})`);
        else errors.push(`idp ${idp.id}: ${what} ${d}: TXT ${proofName(d)} does not contain ${proofValue(idp.id)}`);
      } catch (e) {
        errors.push(`idp ${idp.id}: ${what} ${d}: DNS lookup failed: ${e.message}`);
      }
    }
  }
  if (!changed.length) report.push("No identity provider added or changed.");
  // Applications added or changed: the automated review that decides an
  // automatic merge. Its findings are reported, not counted as errors here
  // (a maintainer can still merge by hand).
  const changedClients = clients.filter((c) => beforeClients.get(c.client_id) !== JSON.stringify(c));
  if (changedClients.length) {
    report.push("", "Automated application review (automatic merge needs every application to pass):");
    const rv = await reviewClients(changedClients, head);
    if (rv.temporary) report.push(`- the review could not complete: ${rv.reason}`);
    else for (const r of rv.results) report.push(r.errors.length ? `- ${r.id}: not eligible: ${r.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}` : `- ${r.id}: passed${r.status === "active" ? ", domain proven" : ""}`);
  }
}

const ok = errors.length === 0;
const md = [`## RoamID registry check: ${ok ? "passed" : "failed"}`, "", ...report, "", ...(ok ? [] : ["### Errors", "", ...errors.map((e) => `- ${e}`)]), ""].join("\n");
console.log(md);
if (summaryFile) appendFileSync(summaryFile, md + "\n");
process.exit(ok ? 0 : 1);
