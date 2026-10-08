// SQLite in memory behind the subset of the D1 interface the Worker uses,
// with the real migrations applied.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function memoryD1() {
  const sql = new DatabaseSync(":memory:");
  const dir = join(root, "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(readFileSync(join(dir, f), "utf8"));
  const norm = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
  const stmt = (q, params = []) => ({
    bind: (...p) => stmt(q, p.map(norm)),
    first: async () => sql.prepare(q).get(...params) || null,
    all: async () => ({ results: sql.prepare(q).all(...params) }),
    run: async () => { const r = sql.prepare(q).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { raw: sql, prepare: (q) => stmt(q), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}
