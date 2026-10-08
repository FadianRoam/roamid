// The registry at run time.
//
// CI publishes registry.json (with the commit it was built from) to GitHub
// Pages. The cron fetches it every 5 minutes, validates it with the same
// module CI uses, drops invalid entries one by one, and keeps the result in
// D1 as the last good copy. A fetch or parse failure keeps the previous copy.
// When D1 has no copy yet, the first request syncs.

import { validateRegistry, LIMITS } from "./validate.js";
import { now } from "../lib/http.js";

const MEMO_TTL = 30;
let memo = null; // { at, value }

function shape(row) {
  const doc = JSON.parse(row.doc);
  return {
    commit: row.commit_sha,
    generated_at: row.generated_at,
    synced_at: row.synced_at,
    checked_at: row.checked_at,
    last_error: row.last_error,
    dropped: JSON.parse(row.dropped),
    idps: new Map(doc.idps.map((e) => [e.id, e])),
    clients: new Map(doc.clients.map((e) => [e.client_id, e])),
  };
}

export function resetMemo() { memo = null; }

// The registry with the operator's emergency overrides applied: an
// identity provider disabled by the operator reads as status "disabled"
// everywhere, without waiting for a registry change.
export async function getRegistry(env) {
  const reg = await loadRegistry(env);
  let ov;
  try { ov = (await env.DB.prepare("SELECT idp, reason FROM idp_overrides WHERE disabled = 1").all()).results || []; } catch { ov = []; }
  if (!ov.length) return reg;
  const idps = new Map(reg.idps);
  for (const o of ov) {
    const i = idps.get(o.idp);
    if (i) idps.set(o.idp, { ...i, status: "disabled", override: { reason: o.reason || null } });
  }
  return { ...reg, idps };
}

async function loadRegistry(env) {
  if (memo && now() - memo.at < MEMO_TTL) return memo.value;
  let row = await env.DB.prepare("SELECT * FROM registry_cache WHERE id = 1").first();
  if (!row) {
    await syncRegistry(env);
    row = await env.DB.prepare("SELECT * FROM registry_cache WHERE id = 1").first();
  }
  const value = row ? shape(row) : { commit: null, idps: new Map(), clients: new Map(), dropped: [], synced_at: null, checked_at: null, last_error: "registry not loaded yet" };
  memo = { at: now(), value };
  return value;
}

async function fetchDoc(url) {
  const bust = `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 60000)}`;
  const res = await fetch(bust, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000), cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`registry fetch: HTTP ${res.status}`);
  const body = await res.text();
  if (body.length > LIMITS.bytes) throw new Error("registry fetch: document too large");
  let doc;
  try { doc = JSON.parse(body); } catch { throw new Error("registry fetch: not JSON"); }
  if (!doc || doc.version !== 1 || !/^[0-9a-f]{40}$/.test(String(doc.commit || "")) || !Array.isArray(doc.idps) || !Array.isArray(doc.clients)) {
    throw new Error("registry fetch: not a version 1 registry document");
  }
  return doc;
}

// Returns { ok, commit, idps, clients, dropped, error }.
export async function syncRegistry(env, { url = env.REGISTRY_URL } = {}) {
  const t = now();
  const prev = await env.DB.prepare("SELECT commit_sha, doc FROM registry_cache WHERE id = 1").first();
  let doc;
  try {
    doc = await fetchDoc(url);
  } catch (e) {
    const error = String(e && e.message || e).slice(0, 300);
    if (prev) await env.DB.prepare("UPDATE registry_cache SET checked_at = ?, last_error = ? WHERE id = 1").bind(t, error).run();
    memo = null;
    console.error("[registry]", error);
    return { ok: false, error };
  }
  const { idps, clients, dropped } = validateRegistry(doc);
  // A document whose every entry fails is more likely a broken build than an
  // intended registry: keep the last good copy.
  if (prev && (doc.idps.length + doc.clients.length) > 0 && !idps.length && !clients.length) {
    const error = "registry fetch: every entry failed validation; keeping the last good copy";
    await env.DB.prepare("UPDATE registry_cache SET checked_at = ?, last_error = ? WHERE id = 1").bind(t, error).run();
    memo = null;
    return { ok: false, error, dropped };
  }
  for (const d of dropped) console.warn("[registry] dropped", d.kind, d.id, d.errors.join("; "));
  await env.DB.prepare(
    `INSERT INTO registry_cache (id, commit_sha, generated_at, synced_at, checked_at, doc, dropped, last_error)
     VALUES (1, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET commit_sha = excluded.commit_sha, generated_at = excluded.generated_at,
       synced_at = excluded.synced_at, checked_at = excluded.checked_at, doc = excluded.doc, dropped = excluded.dropped, last_error = NULL`,
  ).bind(doc.commit, String(doc.generated_at || ""), t, t, JSON.stringify({ idps, clients }), JSON.stringify(dropped)).run();
  memo = null;
  return { ok: true, commit: doc.commit, idps: idps.length, clients: clients.length, dropped };
}
