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

// Per day (all applications together) and per identity provider, for /status.
export async function daily(env, days = 14) {
  const since = new Date(Date.now() - (days - 1) * 86400e3).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare("SELECT day, kind, SUM(n) AS n FROM events WHERE day >= ? GROUP BY day, kind ORDER BY day DESC").bind(since).all();
  const byDay = new Map();
  for (const r of results || []) { const d = byDay.get(r.day) || { day: r.day, started: 0, completed: 0, failed: 0 }; if (r.kind in d) d[r.kind] += r.n; byDay.set(r.day, d); }
  const { results: idps } = await env.DB.prepare("SELECT idp, kind, SUM(n) AS n FROM events WHERE day >= ? AND idp != '' GROUP BY idp, kind ORDER BY idp").bind(since).all();
  const byIdp = new Map();
  for (const r of idps || []) { const d = byIdp.get(r.idp) || { idp: r.idp, completed: 0, failed: 0 }; if (r.kind in d) d[r.kind] += r.n; byIdp.set(r.idp, d); }
  return { days, per_day: [...byDay.values()], per_idp: [...byIdp.values()] };
}
