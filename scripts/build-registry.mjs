#!/usr/bin/env node
// Build registry.json from registry/ for GitHub Pages. Fails when any entry
// is invalid: main only ever publishes a registry that passed every rule.
//   node scripts/build-registry.mjs <out dir> [commit sha]
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readTree, toDoc, logoOf } from "./lib.mjs";
import { checkLogo } from "../src/registry/logo.js";
import { validateRegistry, checkFileNames } from "../src/registry/validate.js";

const out = process.argv[2] || "_site";
const commit = process.argv[3] || process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const files = readTree();
const errs = checkFileNames(files);
const { idps, clients, dropped } = validateRegistry(toDoc(files), { strict: true });
for (const d of dropped) errs.push(`${d.kind} ${d.id}: ${d.errors.join("; ")}`);
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
mkdirSync(out, { recursive: true });
// Logos: published next to registry.json under a content-hashed name and
// described in the entry; the instance downloads and re-checks them.
for (const i of idps) {
  const f = logoOf(files, i.id);
  if (!f) continue;
  const c = checkLogo(f.bytes, f.ext);
  const sha256 = createHash("sha256").update(f.bytes).digest("hex");
  i.logo = { path: `${i.id}.${sha256.slice(0, 8)}.${c.ext}`, sha256, type: c.type, width: c.width, height: c.height };
  writeFileSync(join(out, i.logo.path), f.bytes);
}
const doc = { version: 1, commit, generated_at: new Date().toISOString(), idps, clients };
writeFileSync(join(out, "registry.json"), JSON.stringify(doc, null, 2) + "\n");
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>RoamID registry</title><p>RoamID registry, built from commit <code>${commit}</code>: <a href="registry.json">registry.json</a>. Source: <a href="https://github.com/FadianRoam/roamid">github.com/FadianRoam/roamid</a>.</p>\n`);
console.log(`registry.json: ${idps.length} identity providers, ${clients.length} clients, commit ${commit}`);
