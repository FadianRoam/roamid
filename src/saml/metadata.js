// The SAML configuration of an identity provider: inline in the registry
// entry, or from its metadata_url. Metadata is refreshed every 6 hours (cron
// and on use); the last good copy is kept when a fetch fails, but never past
// its validUntil.

import { parseIdpMetadata } from "./build.js";
import { SamlError } from "./xml.js";
import { toPem, certInfo } from "./certs.js";
import { now } from "../lib/http.js";

const REFRESH = 6 * 3600;

async function fetchMetadata(url) {
  const res = await fetch(url, { headers: { Accept: "application/samlmetadata+xml, application/xml, text/xml" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new SamlError("saml_metadata", `metadata returned HTTP ${res.status}`);
  const body = await res.text();
  return parseIdpMetadata(body);
}

export async function refreshMetadata(env, idp) {
  const t = now();
  try {
    const m = await fetchMetadata(idp.metadata_url);
    if (idp.entity_id && m.entity_id !== idp.entity_id) throw new SamlError("saml_metadata", "entityID in the metadata differs from the registry");
    if (m.valid_until && m.valid_until <= t) throw new SamlError("saml_metadata", "the metadata has expired (validUntil)");
    if (!/^https:\/\//.test(m.sso_url)) throw new SamlError("saml_metadata", "SingleSignOnService is not https");
    await env.DB.prepare(
      `INSERT INTO saml_metadata (idp, entity_id, sso_url, certs, valid_until, fetched_at, checked_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(idp) DO UPDATE SET entity_id = excluded.entity_id, sso_url = excluded.sso_url, certs = excluded.certs, valid_until = excluded.valid_until,
         fetched_at = excluded.fetched_at, checked_at = excluded.checked_at, last_error = NULL`,
    ).bind(idp.id, m.entity_id, m.sso_url, JSON.stringify(m.certs), m.valid_until, t, t).run();
    return { ok: true };
  } catch (e) {
    const error = String(e.message || e).slice(0, 200);
    await env.DB.prepare("UPDATE saml_metadata SET checked_at = ?, last_error = ? WHERE idp = ?").bind(t, error, idp.id).run();
    return { ok: false, error };
  }
}

// { entity_id, sso_url, certs: [PEM] }
export async function samlConfig(env, idp) {
  if (!idp.metadata_url) return { entity_id: idp.entity_id, sso_url: idp.sso_url, certs: idp.certs.map(toPem) };
  let row = await env.DB.prepare("SELECT * FROM saml_metadata WHERE idp = ?").bind(idp.id).first();
  if (!row || now() - row.checked_at > REFRESH) {
    await refreshMetadata(env, idp);
    row = await env.DB.prepare("SELECT * FROM saml_metadata WHERE idp = ?").bind(idp.id).first();
  }
  if (!row) throw new SamlError("saml_metadata", "the provider's metadata could not be loaded");
  if (row.valid_until && row.valid_until <= now()) throw new SamlError("saml_metadata", "the provider's metadata has expired");
  return { entity_id: row.entity_id, sso_url: row.sso_url, certs: JSON.parse(row.certs).map(toPem) };
}

// Health of a SAML identity provider: metadata loads (or is inline) and a
// signing certificate is valid now.
export async function samlHealth(env, idp) {
  try {
    if (idp.metadata_url) {
      const r = await refreshMetadata(env, idp);
      if (!r.ok) return { state: "down", error: r.error };
    }
    const c = await samlConfig(env, idp);
    const t = now();
    const valid = c.certs.some((p) => { try { const i = certInfo(p); return i.notBefore <= t && i.notAfter > t; } catch { return false; } });
    return valid ? { state: "up", error: null } : { state: "degraded", error: "no signing certificate is currently valid" };
  } catch (e) {
    return { state: "down", error: String(e.message || e).slice(0, 200) };
  }
}
