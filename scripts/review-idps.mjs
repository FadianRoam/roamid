// The automated review of identity provider entries in a pull request: the
// operator's domain proven by DNS TXT, the email domains proven, the
// discovery document or SAML metadata loaded, the name checked like an
// application name, and no host on a block list or banned. Network only;
// nothing from the pull request is executed.
//
// Fails closed: when the live data or a block list cannot be loaded, the
// verdict is { temporary: true } and nothing is merged in this run.
import { checkName, RESERVED } from "../src/apps/checks.js";
import { lookupTxt as dohTxt } from "../src/registry/domains.js";
import { proofName, proofValue, domainBase } from "../src/registry/validate.js";
import { blockSet, LIVE } from "./review-clients.mjs";
import { probeIdp } from "./probe-idp.mjs";

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
const err = (code, field, message) => ({ code, field, message });

// entries: changed identity provider entries; doc: the whole registry after the change.
// Returns { temporary, reason } or { results: [{ id, errors }] }.
export async function reviewIdps(entries, doc, { fetchFn = fetch, lookupTxt = dohTxt, probe = probeIdp } = {}) {
  let live, blocks;
  try {
    const r = await fetchFn(`${LIVE}/apps.json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    live = await r.json();
    if (!live || !Array.isArray(live.apps) || !Array.isArray(live.banned_domains)) throw new Error("malformed");
  } catch (e) { return { temporary: true, reason: `${LIVE}/apps.json could not be loaded (${e.message})` }; }
  try { blocks = await blockSet(fetchFn); } catch (e) { return { temporary: true, reason: `a block list could not be loaded (${e.message})` }; }
  const banned = new Set(live.banned_domains);
  const blockedBy = (h) => { const p = h.split("."); for (let i = 0; i < p.length - 1; i++) { const s = blocks.get(p.slice(i).join(".")); if (s) return s; } return null; };
  const isBanned = (h) => [...banned].some((b) => h === b || h.endsWith(`.${b}`));
  const results = [];
  for (const e of entries) {
    const errors = [];
    if (!["active", "disabled"].includes(e.status)) errors.push(err("status", "status", "active or disabled"));
    if (!e.domain) { errors.push(err("domain_missing", "domain", "the provider's own domain is required for automatic review")); results.push({ id: e.id, errors }); continue; }
    // The operator's domain and the email domains: one TXT record each.
    for (const d of new Set([e.domain, ...(e.email_domains || []).map(domainBase)])) {
      try {
        if (!(await lookupTxt(proofName(d))).some((v) => v.trim() === proofValue(e.id))) errors.push(err("domain_unproven", d === e.domain ? "domain" : "email_domains", `TXT ${proofName(d)} does not contain ${proofValue(e.id)}`));
      } catch (x) { return { temporary: true, reason: `DNS lookup for ${proofName(d)} failed (${x.message})` }; }
    }
    // Names: reserved names, and the names of other providers and applications
    // (applications on the provider's own domain do not count).
    const names = [];
    for (const i of doc.idps) if (i.id !== e.id) for (const n of [i.name && i.name.en, i.name && i.name.zh]) if (n) names.push({ id: i.id, name: n, ...(i.domain ? { domain: i.domain } : {}) });
    for (const c of doc.clients) for (const n of [c.name && c.name.en, c.name && c.name.zh]) if (n) names.push({ id: c.client_id, name: n, domain: c.domain || null });
    for (const a of live.apps) for (const n of [a.name && a.name.en, a.name && a.name.zh]) if (n) names.push({ id: a.client_id, name: n, domain: a.domain || null });
    for (const [field, n] of [["name.en", e.name && e.name.en], ["name.zh", e.name && e.name.zh]]) if (n) errors.push(...checkName(n, field, { names, self: e.id, reserved: RESERVED, domain: e.domain, proven: true }));
    // Hosts: not banned, not on a block list.
    for (const h of new Set([e.domain, ...["issuer", "homepage", "metadata_url", "sso_url"].map((f) => e[f] && hostOf(e[f])).filter(Boolean)])) {
      if (isBanned(h)) errors.push(err("domain_banned", "domain", `${h} is banned`));
      const src = blockedBy(h);
      if (src) errors.push(err("reputation", "domain", `${h} is on the ${src} block list`));
    }
    if (e.status === "active" && !errors.length) {
      const p = await probe(e, { fetchFn });
      for (const m of p.errors) errors.push(err("probe", e.protocol === "saml2" ? "metadata_url" : "issuer", m));
    }
    results.push({ id: e.id, errors });
  }
  return { results };
}
