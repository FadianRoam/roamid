// Applications at run time: one resolver over the registry (pull requests),
// the console (D1 table apps) and the built-in console client.
//
//   resolveClient(env, reg, clientId, proto) -> { client, gate } | null
//   resolveSamlSp(env, reg, entityId)        -> { client, gate } | null
//
// `client` has the registry entry shape. Console apps carry `app` with the
// review state; `gate` is the reason sign-in must stop before the picker
// (app_suspended, app_banned, app_unverified), or null.

import { now } from "../lib/http.js";

export const CONSOLE_CLIENT_ID = "roamid-console";
export const DOMAIN_GRACE = 72 * 3600;

export const TEST_CLIENT_ID = "roamid-test";

export function consoleClient(env) {
  return {
    client_id: CONSOLE_CLIENT_ID, protocol: "oidc", status: "active", builtin: true,
    name: { en: "RoamID console", zh: "RoamID 控制台" }, homepage: `${env.BASE_URL}/console`,
    redirect_uris: [`${env.BASE_URL}/console/callback`], token_endpoint_auth_method: "none", subject_type: "public",
    domain: new URL(env.BASE_URL).host,
  };
}

// /test/<idp>: a sign-in that only shows the normalized claims.
export function testClient(env) {
  return {
    client_id: TEST_CLIENT_ID, protocol: "oidc", status: "active", builtin: true,
    name: { en: "RoamID test page", zh: "RoamID 测试页" }, homepage: `${env.BASE_URL}/test`,
    redirect_uris: [`${env.BASE_URL}/test/callback`], token_endpoint_auth_method: "none", subject_type: "pairwise",
    domain: new URL(env.BASE_URL).host,
  };
}

// A D1 apps row in the registry client shape.
export function appEntry(row) {
  let cfg = {};
  try { cfg = JSON.parse(row.config || "{}"); } catch { /* empty config */ }
  return {
    client_id: row.client_id, protocol: row.protocol, status: "active",
    name: { en: row.name_en, ...(row.name_zh ? { zh: row.name_zh } : {}) }, homepage: row.homepage, domain: row.domain,
    ...cfg,
    ...(row.secret_sha256 ? { client_secret_sha256: row.secret_sha256 } : {}),
    ...(row.secret_sha256_old ? { client_secret_sha256_old: row.secret_sha256_old } : {}),
    app: {
      status: row.status, reason: row.status_reason || null, created_by: row.created_by, created_at: row.created_at,
      active_since: row.active_since, limit_lifted: !!row.limit_lifted,
      domain_verified: domainVerified(row), domain_failing_since: row.domain_failing_since || null,
    },
  };
}

// The domain proof holds: verified once, and not failing for longer than the grace period.
export function domainVerified(row, t = now()) {
  if (!row.domain_verified_at) return false;
  return !row.domain_failing_since || t - row.domain_failing_since < DOMAIN_GRACE;
}

export function gateOf(client) {
  const a = client.app;
  if (!a) return null;
  if (a.status === "banned") return "app_banned";
  if (a.status === "suspended") return "app_suspended";
  if (a.status === "active" && !a.domain_verified) return "app_unverified";
  return null;
}

export async function loadApp(env, clientId) {
  if (!/^app-[a-z0-9]{6,40}$/.test(String(clientId || ""))) return null;
  return env.DB.prepare("SELECT * FROM apps WHERE client_id = ?").bind(clientId).first();
}

export async function resolveClient(env, reg, clientId, proto = "oidc") {
  const id = String(clientId || "");
  let client = null;
  if (id === CONSOLE_CLIENT_ID) client = consoleClient(env);
  else if (id === TEST_CLIENT_ID) client = testClient(env);
  else if (reg.clients.has(id)) { const c = reg.clients.get(id); client = c.status === "active" ? c : null; }
  else { const row = await loadApp(env, id); client = row ? appEntry(row) : null; }
  if (!client || client.protocol !== proto) return null;
  return { client, gate: gateOf(client) };
}

export async function resolveSamlSp(env, reg, entityId) {
  for (const c of reg.clients.values()) if (c.protocol === "saml2" && c.status === "active" && c.entity_id === entityId) return { client: c, gate: null };
  const row = await env.DB.prepare("SELECT * FROM apps WHERE protocol = 'saml2' AND json_extract(config, '$.entity_id') = ?").bind(String(entityId || "")).first();
  if (!row) return null;
  const client = appEntry(row);
  return { client, gate: gateOf(client) };
}

// Owners and co-owners of a console app (public subs).
export async function isOwner(env, clientId, sub) {
  const r = await env.DB.prepare("SELECT 1 FROM app_owners WHERE client_id = ? AND sub = ?").bind(clientId, sub).first();
  return !!r;
}

