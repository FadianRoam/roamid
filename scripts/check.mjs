#!/usr/bin/env node
// Registry check for pull requests and pushes. No secrets.
//
//   node scripts/check.mjs [--base <git rev>] [--probe] [--summary <file>]
//
// 1. file names: registry/idps/<id>.json, registry/clients/<client_id>.json
// 2. every entry against the schemas and rules (src/registry/validate.js)
// 3. identifiers are permanent: nothing on --base may be removed or renamed
// 4. --probe: for identity providers added or changed against --base, load
//    the discovery document and check the email domain TXT proofs
// Exit status 1 when anything fails. --summary appends a Markdown report
// (GitHub job summary).
import { appendFileSync } from "node:fs";
import { readTree, readRevision, toDoc, idsOf } from "./lib.mjs";
import { validateRegistry, checkFileNames, checkImmutable, proofName, proofValue } from "../src/registry/validate.js";
import { discoveryProblems } from "../src/oidc/upstream.js";
import { parseIdpMetadata } from "../src/saml/build.js";
import { certInfo } from "../src/saml/certs.js";
import { proveDomain } from "../src/registry/domains.js";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const base = opt("--base");
const probe = args.includes("--probe");
const summaryFile = opt("--summary");

const errors = [];
const report = [];
const files = readTree();
errors.push(...checkFileNames(files));
const head = toDoc(files);
const { idps, clients, dropped } = validateRegistry(head, { strict: true });
for (const d of dropped) errors.push(`${d.kind} ${d.id}: ${d.errors.join("; ")}`);
report.push(`Entries: ${idps.length} identity providers, ${clients.length} clients.`);

let changed = idps;
if (base) {
  const baseFiles = readRevision(base);
  if (!baseFiles) {
    errors.push(`cannot read the base revision ${base}`);
  } else {
    errors.push(...checkImmutable(idsOf(baseFiles), idsOf(files)));
    const before = new Map(baseFiles.filter((f) => f.kind === "idps" && f.json).map((f) => [f.json.id, JSON.stringify(f.json)]));
    changed = idps.filter((i) => before.get(i.id) !== JSON.stringify(i));
  }
}

if (probe) {
  for (const idp of changed) {
    if (idp.status !== "active") { report.push(`- ${idp.id}: disabled, not probed`); continue; }
    if (idp.protocol === "saml2") await probeSaml(idp);
    else {
      const url = idp.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const p = discoveryProblems(idp, d);
        if (p.length) errors.push(`idp ${idp.id}: ${p.join("; ")}`);
        else report.push(`- ${idp.id}: discovery OK (${url})`);
      } catch (e) {
        errors.push(`idp ${idp.id}: discovery ${url}: ${e.message}`);
      }
    }
    for (const d of idp.email_domains || []) {
      try {
        if (await proveDomain(d, idp.id)) report.push(`- ${idp.id}: email domain ${d} proven (${proofName(d)} TXT ${proofValue(idp.id)})`);
        else errors.push(`idp ${idp.id}: email domain ${d}: TXT ${proofName(d)} does not contain ${proofValue(idp.id)}`);
      } catch (e) {
        errors.push(`idp ${idp.id}: email domain ${d}: DNS lookup failed: ${e.message}`);
      }
    }
  }
  if (!changed.length) report.push("No identity provider added or changed.");
}

// A SAML identity provider: its metadata (or the inline values) and its
// signing certificates.
async function probeSaml(idp) {
  let m = { entity_id: idp.entity_id, sso_url: idp.sso_url, certs: idp.certs || [], valid_until: null };
  const now = Math.floor(Date.now() / 1000);
  if (idp.metadata_url) {
    try {
      const r = await fetch(idp.metadata_url, { signal: AbortSignal.timeout(10000), redirect: "manual", headers: { Accept: "application/samlmetadata+xml, application/xml" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      m = parseIdpMetadata(await r.text());
    } catch (e) {
      errors.push(`idp ${idp.id}: metadata ${idp.metadata_url}: ${e.message}`);
      return;
    }
    if (idp.entity_id && m.entity_id !== idp.entity_id) errors.push(`idp ${idp.id}: entityID in the metadata (${m.entity_id}) differs from entity_id`);
    if (m.valid_until && m.valid_until <= now) errors.push(`idp ${idp.id}: the metadata has expired (validUntil)`);
    if (!/^https:\/\//.test(m.sso_url || "")) errors.push(`idp ${idp.id}: SingleSignOnService is not https`);
  }
  let valid = 0;
  for (const c of m.certs) {
    try {
      const i = certInfo(c);
      if (i.notBefore <= now && i.notAfter > now) valid++;
      report.push(`- ${idp.id}: signing certificate ${i.subject.replace(/\n/g, ", ")}, valid until ${new Date(i.notAfter * 1000).toISOString().slice(0, 10)}`);
    } catch (e) { errors.push(`idp ${idp.id}: a signing certificate cannot be read`); }
  }
  if (!valid) errors.push(`idp ${idp.id}: no signing certificate is valid now`);
  else report.push(`- ${idp.id}: SAML ${idp.metadata_url ? `metadata OK (${idp.metadata_url})` : "inline configuration OK"}, entity ${m.entity_id}, SSO ${m.sso_url}`);
}

const ok = errors.length === 0;
const md = [`## RoamID registry check: ${ok ? "passed" : "failed"}`, "", ...report, "", ...(ok ? [] : ["### Errors", "", ...errors.map((e) => `- ${e}`)]), ""].join("\n");
console.log(md);
if (summaryFile) appendFileSync(summaryFile, md + "\n");
process.exit(ok ? 0 : 1);
