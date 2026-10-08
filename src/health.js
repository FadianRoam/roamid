// Identity provider health, probed by the cron: discovery and JWKS.
//   up        discovery loads, matches the registry, and the JWKS loads
//   degraded  it loads but no longer meets the requirements
//   down      it does not load

import { discovery, UpstreamError, resetUpstreamCaches } from "./oidc/upstream.js";
import { now } from "./lib/http.js";

async function probe(idp) {
  try {
    const d = await discovery(idp, { fresh: true });
    const r = await fetch(d.jwks_uri, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
    const j = r.ok ? await r.json().catch(() => null) : null;
    if (!j || !Array.isArray(j.keys) || !j.keys.length) return { state: "degraded", error: `JWKS returned HTTP ${r.status}` };
    return { state: "up", error: null };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 200);
    if (e instanceof UpstreamError && e.code === "upstream_discovery_failed" && !/HTTP/.test(msg)) return { state: "degraded", error: msg };
    return { state: "down", error: msg };
  }
}

export async function probeIdps(env, reg) {
  const t = now();
  const active = [...reg.idps.values()].filter((i) => i.status === "active");
  const results = await Promise.all(active.map(async (idp) => ({ idp, ...(await probe(idp)) })));
  for (const r of results) {
    await env.DB.prepare(
      `INSERT INTO idp_health (idp, state, checked_at, last_ok, last_error) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(idp) DO UPDATE SET state = excluded.state, checked_at = excluded.checked_at,
         last_ok = COALESCE(excluded.last_ok, idp_health.last_ok), last_error = excluded.last_error`,
    ).bind(r.idp.id, r.state, t, r.state === "up" ? t : null, r.error).run();
  }
  await env.DB.prepare(`DELETE FROM idp_health WHERE idp NOT IN (${active.map(() => "?").join(",") || "''"})`).bind(...active.map((i) => i.id)).run();
  return results.map((r) => ({ idp: r.idp.id, state: r.state }));
}

export { resetUpstreamCaches };
