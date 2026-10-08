// Daily counters without personal data: kind, IdP, client, error code.

export async function count(env, kind, { idp = "", client = "", code = "" } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      "INSERT INTO events (day, kind, idp, client_id, code, n) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(day, kind, idp, client_id, code) DO UPDATE SET n = n + 1",
    ).bind(day, kind, String(idp).slice(0, 32), String(client).slice(0, 64), String(code).slice(0, 40)).run();
  } catch (e) {
    console.error("[events]", e && e.message);
  }
}

export async function summary(env, days = 7) {
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    "SELECT kind, code, SUM(n) AS n FROM events WHERE day >= ? GROUP BY kind, code ORDER BY kind, code",
  ).bind(since).all();
  const out = { days, started: 0, completed: 0, failed: 0, failures: {} };
  for (const r of results || []) {
    if (r.kind === "failed") { out.failed += r.n; out.failures[r.code || "unknown"] = r.n; } else if (r.kind in out) out[r.kind] += r.n;
  }
  return out;
}
