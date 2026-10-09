// Domain proofs (docs/idp-requirements.md, "Domain" and "Email domains").
//
// An IdP entry has a `domain` (who operates it) and may list email_domains
// (which addresses it is authoritative for). Each is proven by a DNS TXT record
// _roamid.<domain> whose value is roamid-idp=<idp id>. CI checks the record
// on the pull request; the Worker checks new domains as soon as the registry
// lists them and every domain again once a day. A domain whose record has
// gone keeps its authority for GRACE seconds after the first failed check,
// then loses it until the record is back.

import { domainBase, proofName, proofValue, emailInDomain } from "./validate.js";
import { now } from "../lib/http.js";

export const GRACE = 48 * 3600;
export const RECHECK = 24 * 3600;
export const PENDING_RECHECK = 15 * 60;
const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];

// TXT strings at `name` over DNS-over-HTTPS (JSON). Throws when no resolver answers.
export async function lookupTxt(name) {
  let lastErr = "no resolver answered";
  for (const r of RESOLVERS) {
    try {
      const res = await fetch(`${r}?name=${encodeURIComponent(name)}&type=TXT`, {
        headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const j = await res.json();
      if (j.Status !== 0 && j.Status !== 3) { lastErr = `DNS status ${j.Status}`; continue; }
      return (j.Answer || []).filter((a) => a.type === 16).map((a) => {
        // "\"part one\" \"part two\"" -> "part onepart two"
        const parts = String(a.data).match(/"((?:[^"\\]|\\.)*)"/g);
        return parts ? parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, "$1")).join("") : String(a.data);
      });
    } catch (e) {
      lastErr = e && e.message || String(e);
    }
  }
  throw new Error(lastErr);
}

export async function proveDomain(domain, idpId) {
  const values = await lookupTxt(proofName(domain));
  return values.some((v) => v.trim() === proofValue(idpId));
}

// Bring domain_proofs in line with the registry and run the checks that are due.
export async function checkDomainProofs(env, reg, { force = false, max = 50 } = {}) {
  const t = now();
  const want = [];
  for (const idp of reg.idps.values()) {
    for (const d of new Set([...(idp.domain ? [idp.domain] : []), ...(idp.email_domains || [])])) want.push({ domain: d, idp: idp.id });
  }
  const { results } = await env.DB.prepare("SELECT * FROM domain_proofs").all();
  const rows = new Map((results || []).map((r) => [`${r.domain}|${r.idp}`, r]));
  const keep = new Set(want.map((w) => `${w.domain}|${w.idp}`));
  for (const [k, r] of rows) if (!keep.has(k)) await env.DB.prepare("DELETE FROM domain_proofs WHERE domain = ? AND idp = ?").bind(r.domain, r.idp).run();
  let checked = 0;
  for (const w of want) {
    const r = rows.get(`${w.domain}|${w.idp}`);
    const due = force || !r || !r.checked_at
      || (r.verified_at && !r.failing_since ? t - r.checked_at >= RECHECK : t - r.checked_at >= PENDING_RECHECK);
    if (!due || checked >= max) continue;
    checked++;
    let ok = false, error = null;
    try {
      ok = await proveDomain(w.domain, w.idp);
      if (!ok) error = `TXT ${proofName(w.domain)} does not contain ${proofValue(w.idp)}`;
    } catch (e) {
      error = `DNS lookup failed: ${String(e.message || e).slice(0, 120)}`;
    }
    if (ok) {
      await env.DB.prepare(
        `INSERT INTO domain_proofs (domain, idp, verified_at, checked_at, failing_since, last_error) VALUES (?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(domain, idp) DO UPDATE SET verified_at = excluded.verified_at, checked_at = excluded.checked_at, failing_since = NULL, last_error = NULL`,
      ).bind(w.domain, w.idp, t, t).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO domain_proofs (domain, idp, verified_at, checked_at, failing_since, last_error) VALUES (?, ?, NULL, ?, NULL, ?)
         ON CONFLICT(domain, idp) DO UPDATE SET checked_at = excluded.checked_at, last_error = excluded.last_error,
           failing_since = CASE WHEN domain_proofs.verified_at IS NOT NULL THEN COALESCE(domain_proofs.failing_since, excluded.checked_at) ELSE NULL END`,
      ).bind(w.domain, w.idp, t, error).run();
    }
  }
  return checked;
}

export function proofState(row, t = now()) {
  if (!row || !row.verified_at) return "unverified";
  if (!row.failing_since) return "verified";
  return t - row.failing_since < GRACE ? "grace" : "lost";
}

// IdP id -> its `domain`, for the providers whose domain is proven now.
export async function provenIdpDomains(env, reg) {
  const { results } = await env.DB.prepare("SELECT * FROM domain_proofs").all();
  const t = now();
  const ok = new Set((results || []).filter((r) => ["verified", "grace"].includes(proofState(r, t))).map((r) => `${r.domain}|${r.idp}`));
  const out = new Map();
  for (const i of reg.idps.values()) if (i.domain && ok.has(`${i.domain}|${i.id}`)) out.set(i.id, i.domain);
  return out;
}

// The declared domains of `idp` that are authoritative now.
export async function authoritativeDomains(env, idp) {
  const doms = idp.email_domains || [];
  if (!doms.length) return [];
  const { results } = await env.DB.prepare("SELECT * FROM domain_proofs WHERE idp = ?").bind(idp.id).all();
  const t = now();
  const ok = new Set((results || []).filter((r) => ["verified", "grace"].includes(proofState(r, t))).map((r) => r.domain));
  return doms.filter((d) => ok.has(d));
}

// email_authority for an address: "authoritative" when the provider says
// the address is verified and its domain is one of the provider's proven
// domains; otherwise "asserted".
export function emailAuthority(email, upstreamVerified, domains) {
  if (!upstreamVerified || typeof email !== "string") return "asserted";
  return domains.some((d) => emailInDomain(email, d)) ? "authoritative" : "asserted";
}

export { domainBase };
