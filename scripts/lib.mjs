// Shared by the CI scripts: read the registry from the working tree or from
// a git revision.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export function readTree(root = ".") {
  const files = [];
  for (const kind of ["idps", "clients"]) {
    const dir = join(root, "registry", kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (f.startsWith(".")) continue;
      const path = `registry/${kind}/${f}`;
      let json = null;
      try { json = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { /* reported by checkFileNames */ }
      files.push({ path, kind, json });
    }
  }
  return files;
}

export function readRevision(rev) {
  let list = "";
  try { list = execFileSync("git", ["ls-tree", "-r", "--name-only", rev, "--", "registry/"], { encoding: "utf8" }); } catch { return null; }
  const files = [];
  for (const path of list.split("\n").filter(Boolean)) {
    const m = /^registry\/(idps|clients)\/[^/]+\.json$/.exec(path);
    if (!m) continue;
    let json = null;
    try { json = JSON.parse(execFileSync("git", ["show", `${rev}:${path}`], { encoding: "utf8" })); } catch { /* ignore */ }
    files.push({ path, kind: m[1], json });
  }
  return files;
}

export function toDoc(files) {
  return {
    idps: files.filter((f) => f.kind === "idps" && f.json).map((f) => f.json),
    clients: files.filter((f) => f.kind === "clients" && f.json).map((f) => f.json),
  };
}

export const idsOf = (files) => ({
  idps: files.filter((f) => f.kind === "idps").map((f) => f.path.slice("registry/idps/".length, -5)),
  clients: files.filter((f) => f.kind === "clients").map((f) => f.path.slice("registry/clients/".length, -5)),
});
