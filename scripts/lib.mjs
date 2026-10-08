// Shared by the CI scripts: read the registry from the working tree or from
// a git revision.
//   registry/idps/<id>/idp.json        identity provider
//   registry/idps/<id>/logo.<ext>      optional logo (png, webp or jpg)
//   registry/clients/<client_id>.json  application
// The earlier layout registry/idps/<id>.json is still read (from base
// revisions) so that moving an entry keeps its identifier.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const IDP_JSON = /^registry\/idps\/([^/]+)\/idp\.json$/;
const IDP_LEGACY = /^registry\/idps\/([^/]+)\.json$/;
const IDP_LOGO = /^registry\/idps\/([^/]+)\/logo\.([a-z]+)$/;
const CLIENT = /^registry\/clients\/([^/]+)\.json$/;

// One record per file: { path, kind: "idps" | "clients" | "logo" | "other", id, json?, bytes? }.
function classify(path, read) {
  let m;
  const parse = () => { try { return JSON.parse(read().toString("utf8")); } catch { return null; } };
  if ((m = IDP_JSON.exec(path)) || (m = IDP_LEGACY.exec(path))) return { path, kind: "idps", id: m[1], json: parse() };
  if ((m = CLIENT.exec(path))) return { path, kind: "clients", id: m[1], json: parse() };
  if ((m = IDP_LOGO.exec(path))) return { path, kind: "logo", id: m[1], ext: m[2], bytes: read() };
  return { path, kind: "other" };
}

// A record from a path and its content (an object for JSON, bytes otherwise); for tests.
export const fileRecord = (path, content) => classify(path, () => (content instanceof Uint8Array ? Buffer.from(content) : Buffer.from(JSON.stringify(content))));

export function readTree(root = ".") {
  const files = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs).sort()) {
      if (f.startsWith(".")) continue;
      const r = `${rel}/${f}`;
      if (statSync(join(root, r)).isDirectory()) walk(r);
      else files.push(classify(r, () => readFileSync(join(root, r))));
    }
  };
  walk("registry/idps");
  walk("registry/clients");
  return files;
}

export function readRevision(rev) {
  let list = "";
  try { list = execFileSync("git", ["ls-tree", "-r", "--name-only", rev, "--", "registry/"], { encoding: "utf8" }); } catch { return null; }
  return list.split("\n").filter((p) => /^registry\/(idps|clients)\//.test(p))
    .map((p) => classify(p, () => { try { return execFileSync("git", ["show", `${rev}:${p}`]); } catch { return Buffer.alloc(0); } }));
}

export function toDoc(files) {
  return {
    idps: files.filter((f) => f.kind === "idps" && f.json).map((f) => f.json),
    clients: files.filter((f) => f.kind === "clients" && f.json).map((f) => f.json),
  };
}

// Identifiers by path: registry/idps/<id>.json and registry/idps/<id>/idp.json
// are the same identifier, so the move between the layouts is not a rename.
export const idsOf = (files) => ({
  idps: files.filter((f) => f.kind === "idps").map((f) => f.id),
  clients: files.filter((f) => f.kind === "clients").map((f) => f.id),
});

export const logoOf = (files, id) => files.find((f) => f.kind === "logo" && f.id === id) || null;
