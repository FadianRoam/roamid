// Automated review with the Worker's data: the shared checks (checks.js)
// plus names, bans, block lists and DNS; domain proofs; the cron jobs.

import { checkApp, needsDevelopment, proveAppDomain, resolvesPublic } from "./checks.js";
import { appEntry, DOMAIN_GRACE } from "./store.js";
import { lookupTxt } from "../registry/domains.js";
import { now } from "../lib/http.js";

export const BLOCKLISTS = {
  urlhaus: "https://urlhaus.abuse.ch/downloads/hostfile/",
  openphish: "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt",
};

let listMemo = null; // { at, map: host -> source }
export function resetListMemo() { listMemo = null; }

async function blockMap(env) {
  if (listMemo && now() - listMemo.at < 600) return listMemo.map;
  const map = new Map();
  try {
    const { results } = await env.DB.prepare("SELECT source, hosts FROM blocklists").all();
    for (const r of results || []) for (const h of String(r.hosts).split("\n")) if (h) map.set(h, r.source);
  } catch { /* none yet */ }
  listMemo = { at: now(), map };
  return map;
}

// A host or any parent domain of it on a list.
export async function blockedBy(env, host) {
  const map = await blockMap(env);
  const parts = String(host).toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) { const s = map.get(parts.slice(i).join(".")); if (s) return s; }
  return null;
}

export async function isBannedDomain(env, domain) {
  const parts = String(domain).toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (await env.DB.prepare("SELECT 1 FROM banned_domains WHERE domain = ?").bind(parts.slice(i).join(".")).first()) return true;
  }
  return false;
}

// Names already in use: identity providers, registry clients, console apps.
export async function namesInUse(env, reg) {
  const out = [];
  for (const i of reg.idps.values()) for (const n of [i.name.en, i.name.zh]) if (n) out.push({ id: i.id, name: n });
  for (const c of reg.clients.values()) for (const n of [c.name.en, c.name.zh]) if (n) out.push({ id: c.client_id, name: n });
  const { results } = await env.DB.prepare("SELECT client_id, name_en, name_zh FROM apps WHERE status != 'banned'").all();
  for (const r of results || []) for (const n of [r.name_en, r.name_zh]) if (n) out.push({ id: r.client_id, name: n });
  return out;
}

export async function reviewEntry(env, reg, entry, { resolve = true } = {}) {
  const development = needsDevelopment(entry);
  const r = await checkApp(entry, {
    development,
    names: await namesInUse(env, reg),
    banned: (d) => isBannedDomain(env, d),
    blocked: (h) => blockedBy(env, h),
    resolves: resolve ? (h) => resolvesPublic(h) : null,
  });
  return { ...r, development };
}

// Check the domain proof of one app now and bring its status in line:
// development while a callback is on localhost or the domain is unproven,
// active otherwise. Suspended and banned apps keep their status.
export async function checkAppDomain(env, row) {
  const t = now();
  const p = await proveAppDomain(row.domain, row.client_id, { lookupTxt });
  let verified = row.domain_verified_at, failing = row.domain_failing_since;
  if (p.ok) { verified = t; failing = null; } else if (verified && !failing) failing = t;
  await env.DB.prepare("UPDATE apps SET domain_verified_at = ?, domain_failing_since = ?, domain_checked_at = ?, domain_error = ? WHERE client_id = ?")
    .bind(verified || null, failing || null, t, p.ok ? null : String(p.error).slice(0, 300), row.client_id).run();
  const fresh = await env.DB.prepare("SELECT * FROM apps WHERE client_id = ?").bind(row.client_id).first();
  await settleStatus(env, fresh);
  return p;
}

// The block lists have loaded at least once (fail closed: until then no
// application becomes active).
export async function listsReady(env) {
  try {
    const { results } = await env.DB.prepare("SELECT source, entries, last_error FROM blocklists").all();
    const ok = new Set((results || []).filter((r) => r.last_error === null || r.entries > 0).map((r) => r.source));
    return Object.keys(BLOCKLISTS).every((s) => ok.has(s));
  } catch { return false; }
}

export async function settleStatus(env, row) {
  if (!row || row.status === "suspended" || row.status === "banned") return row && row.status;
  const entry = appEntry(row);
  const ready = await listsReady(env);
  const want = !needsDevelopment(entry) && entry.app.domain_verified && ready ? "active" : "development";
  if (want !== row.status) {
    const t = now();
    await env.DB.prepare("UPDATE apps SET status = ?, active_since = COALESCE(active_since, ?), updated_at = ? WHERE client_id = ?")
      .bind(want, want === "active" ? t : null, t, row.client_id).run();
    await env.DB.prepare("INSERT INTO audit (at, actor, target_kind, target_id, action, reason) VALUES (?, 'system', 'app', ?, ?, ?)")
      .bind(t, row.client_id, want === "active" ? "activated" : "development", want === "active" ? "sys_active" : (needsDevelopment(entry) ? "sys_localhost" : !entry.app.domain_verified ? "sys_no_proof" : "sys_lists_pending")).run();
  }
  return want;
}

// Cron: domain proofs that are due (new or failing: every 15 minutes; proven: daily).
export async function recheckApps(env, { max = 25 } = {}) {
  const t = now();
  const { results } = await env.DB.prepare(
    `SELECT * FROM apps WHERE status IN ('development', 'active') AND (domain_checked_at IS NULL
       OR (domain_verified_at IS NOT NULL AND domain_failing_since IS NULL AND domain_checked_at < ?)
       OR ((domain_verified_at IS NULL OR domain_failing_since IS NOT NULL) AND domain_checked_at < ?)) ORDER BY domain_checked_at LIMIT ?`,
  ).bind(t - 86400, t - 900, max).all();
  let n = 0;
  for (const row of results || []) { await checkAppDomain(env, row).catch((e) => console.error("[apps] domain", row.client_id, e && e.message)); n++; }
  // An active app whose proof has been failing past the grace period is shown as unverified (gate in store.js).
  return n;
}

// Cron: refresh the public block lists once a day.
export async function refreshBlocklists(env, { force = false } = {}) {
  const t = now();
  const out = {};
  for (const [source, url] of Object.entries(BLOCKLISTS)) {
    const row = await env.DB.prepare("SELECT fetched_at FROM blocklists WHERE source = ?").bind(source).first();
    if (!force && row && t - row.fetched_at < 86400) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.text()).slice(0, 4 * 1024 * 1024);
      const hosts = new Set();
      for (const line of body.split("\n")) {
        const l = line.trim();
        if (!l || l.startsWith("#")) continue;
        let h = l.includes("://") ? (() => { try { return new URL(l).hostname; } catch { return ""; } })() : l.split(/\s+/).pop();
        h = String(h).toLowerCase().replace(/\.$/, "");
        if (/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(h) && h !== "localhost") hosts.add(h);
      }
      const list = [...hosts].slice(0, 60000).join("\n");
      await env.DB.prepare(`INSERT INTO blocklists (source, hosts, entries, fetched_at, last_error) VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(source) DO UPDATE SET hosts = excluded.hosts, entries = excluded.entries, fetched_at = excluded.fetched_at, last_error = NULL`).bind(source, list, hosts.size, t).run();
      out[source] = hosts.size;
    } catch (e) {
      await env.DB.prepare(`INSERT INTO blocklists (source, hosts, entries, fetched_at, last_error) VALUES (?, '', 0, ?, ?)
        ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, last_error = excluded.last_error`).bind(source, t, String(e.message || e).slice(0, 200)).run();
      out[source] = `error: ${e.message || e}`;
    }
  }
  resetListMemo();
  return out;
}

export { DOMAIN_GRACE };
