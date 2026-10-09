// The registry at run time.
//
// CI publishes registry.json (with the commit it was built from) to GitHub
// Pages. The cron fetches it every 5 minutes, validates it with the same
// module CI uses, drops invalid entries one by one, and keeps the result in
// D1 as the last good copy. A fetch or parse failure keeps the previous copy.
// When D1 has no copy yet, the first request syncs.

import { checkLogo } from "./logo.js";
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
// everywhere, without waiting for a registry change. An active OpenID
// Connect provider with client_secret_* reads as disabled with `awaiting:
// "secret"` until its secret (IDP_SECRET_<ID>) is set: an entry can be
// merged automatically before the secret has been handed over.
export const secretVar = (id) => "IDP_SECRET_" + id.toUpperCase().replace(/-/g, "_");
const awaitsSecret = (env, i) => i.status === "active" && i.protocol !== "saml2" && /^client_secret_/.test(i.client_auth || "") && !env[secretVar(i.id)];
export async function getRegistry(env) {
  let reg = await loadRegistry(env);
  if ([...reg.idps.values()].some((i) => awaitsSecret(env, i))) {
    const idps = new Map(reg.idps);
    for (const i of idps.values()) if (awaitsSecret(env, i)) idps.set(i.id, { ...i, status: "disabled", awaiting: "secret" });
    reg = { ...reg, idps };
  }
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
  await syncLogos(env, url, idps);
  try { for (const i of idps) await env.DB.prepare("INSERT INTO idp_seen (idp, first_seen) VALUES (?, ?) ON CONFLICT(idp) DO NOTHING").bind(i.id, t).run(); } catch { /* before the migration */ }
  await env.DB.prepare(
    `INSERT INTO registry_cache (id, commit_sha, generated_at, synced_at, checked_at, doc, dropped, last_error)
     VALUES (1, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET commit_sha = excluded.commit_sha, generated_at = excluded.generated_at,
       synced_at = excluded.synced_at, checked_at = excluded.checked_at, doc = excluded.doc, dropped = excluded.dropped, last_error = NULL`,
  ).bind(doc.commit, String(doc.generated_at || ""), t, t, JSON.stringify({ idps, clients }), JSON.stringify(dropped)).run();
  memo = null;
  return { ok: true, commit: doc.commit, idps: idps.length, clients: clients.length, dropped };
}

// Logos named in registry.json: downloaded once per content hash from the
// registry's own origin and re-checked here; an entry whose logo cannot be
// verified is shown without it (monogram).
async function syncLogos(env, registryUrl, idps) {
  const want = new Set();
  for (const i of idps) {
    if (!i.logo) continue;
    const l = i.logo;
    try {
      const have = await env.DB.prepare("SELECT sha256 FROM idp_logos WHERE path = ?").bind(l.path).first();
      if (!have) {
        const r = await fetch(new URL(l.path, registryUrl).href, { signal: AbortSignal.timeout(10000), cf: { cacheTtl: 0 } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const c = checkLogo(bytes, l.path.split(".").pop());
        if (c.errors.length) throw new Error(c.errors.join("; "));
        if (c.type !== l.type || c.width !== l.width || c.height !== l.height) throw new Error("type or dimensions differ from registry.json");
        const sum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
        if (sum !== l.sha256) throw new Error("sha256 differs from registry.json");
        let bin = ""; for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
        await env.DB.prepare("INSERT INTO idp_logos (path, idp, type, sha256, width, height, data, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO NOTHING")
          .bind(l.path, i.id, c.type, sum, c.width, c.height, btoa(bin), now()).run();
      } else if (have.sha256 !== l.sha256) throw new Error("stored sha256 differs");
      want.add(l.path);
    } catch (e) {
      console.warn("[registry] logo refused", i.id, String(e && e.message || e).slice(0, 200));
      delete i.logo;
    }
  }
  try {
    const { results } = await env.DB.prepare("SELECT path FROM idp_logos").all();
    for (const r of results || []) if (!want.has(r.path)) await env.DB.prepare("DELETE FROM idp_logos WHERE path = ?").bind(r.path).run();
  } catch { /* table missing before the migration */ }
}

// GET /logos/<id>.<sha8>.<ext>
export async function serveLogo(env, path) {
  const m = /^\/logos\/([a-z0-9-]{2,32}\.[0-9a-f]{8}\.(?:png|webp|jpg))$/.exec(path);
  const base = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" };
  const row = m ? await env.DB.prepare("SELECT type, data FROM idp_logos WHERE path = ?").bind(m[1]).first() : null;
  if (!row) return new Response("not found", { status: 404, headers: { ...base, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { ...base, "Content-Type": row.type, "Cache-Control": "public, max-age=31536000, immutable", "Content-Disposition": "inline", "Content-Length": String(bytes.length) } });
}

// id -> first time this instance loaded the provider (unix seconds).
export async function addedMap(env) {
  try { const { results } = await env.DB.prepare("SELECT idp, first_seen FROM idp_seen").all(); return Object.fromEntries((results || []).map((r) => [r.idp, r.first_seen])); } catch { return {}; }
}
