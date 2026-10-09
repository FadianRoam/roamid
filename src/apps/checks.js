// Automated review of applications. One module for the console (Worker) and
// for the pull-request auto-merge job (Node): no Worker-only APIs. Network
// and storage are passed in as functions.
//
//   checkApp(entry, ctx) -> { errors: [{ code, field, message }], hosts: [...] }
//
// entry: { client_id, protocol, name: {en, zh}, domain, homepage,
//          redirect_uris | acs_urls, post_logout_redirect_uris }
// ctx:   { development, names: [{ id, name, owner? }], reserved: [name],
//          resolves(host) -> bool, blocked(host) -> source|null,
//          banned(domain) -> bool }   (each async, each optional)

import reserved from "../../policy/reserved-names.json" with { type: "json" };

export const RESERVED = reserved.names;
export const LIMITS = { perCreator: 10, globalPerDay: 200, nameMin: 2, nameMax: 60 };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
// A domain inside a name: "example.com", "foo.co".
const DOMAIN_IN_NAME = /[\p{L}\p{N}-]+\s*[.。．]\s*[a-z]{2,}(?![\p{L}])/iu;
const NAME_CHARS = /^[\p{L}\p{M}\p{N} \-_.&'()·:,，：（）]+$/u;

// Characters that look like Latin letters, to their Latin form (Unicode
// confusables, the subset that matters for names written in Latin script).
const CONFUSABLE = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ԛ": "q", "ԝ": "w", "ӏ": "l", "ʋ": "v",
  "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o", "Р": "p", "С": "c", "Т": "t", "Х": "x", "У": "y", "І": "i", "Ј": "j", "Ѕ": "s",
  "α": "a", "ο": "o", "ρ": "p", "ν": "v", "τ": "t", "ι": "i", "κ": "k", "χ": "x", "υ": "u", "ϲ": "c", "ε": "e",
  "Α": "a", "Β": "b", "Ε": "e", "Ζ": "z", "Η": "h", "Ι": "i", "Κ": "k", "Μ": "m", "Ν": "n", "Ο": "o", "Ρ": "p", "Τ": "t", "Υ": "y", "Χ": "x",
  "0": "o", "1": "l", "|": "l", "!": "i", "$": "s", "@": "a", "ı": "i", "ł": "l", "ø": "o", "ß": "ss",
};

// The confusable skeleton of a name: compatibility-normalized, lower case,
// look-alike characters folded, "rn" -> "m", "vv" -> "w", "cl" -> "d",
// separators and accents removed.
export function skeleton(s) {
  let t = String(s || "").normalize("NFKD").replace(/\p{M}/gu, "");
  t = [...t].map((c) => CONFUSABLE[c] ?? c).join("").toLowerCase();
  t = t.replace(/[^\p{L}\p{N}]/gu, "");
  return t.replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d").replace(/i/g, "l");
}

const scriptOf = (c) => (/\p{Script=Latin}/u.test(c) ? "Latin" : /\p{Script=Cyrillic}/u.test(c) ? "Cyrillic" : /\p{Script=Greek}/u.test(c) ? "Greek" : null);

// Latin mixed with Cyrillic or Greek letters in one name.
export function mixedScripts(s) {
  const set = new Set([...String(s || "")].map(scriptOf).filter(Boolean));
  return set.size > 1;
}

const err = (code, field, message) => ({ code, field, message });

// `names` holds the names in use. An identity provider's entry carries
// `owner`, its proven domain (DNS TXT). An application whose domain is
// exactly that domain belongs to the same operator and may use the
// provider's name, so a provider can register its own sites as RoamID
// applications (their callbacks may still be on subdomains). Exactly, not
// a subdomain: a subdomain can be someone else's (hosting, user pages) and
// an application's own proof may be a file on its web server. Applications
// on that domain do not block each other's names either, so an unproven
// application cannot hold the name against the operator; it becomes active
// only after proving the domain.
export function checkName(name, field, { names = [], self = null, reserved = RESERVED, domain = null } = {}) {
  const own = !!domain && names.some((o) => o.owner && o.owner === domain);
  const out = [];
  const n = String(name || "").trim();
  if (n.length < LIMITS.nameMin || n.length > LIMITS.nameMax) out.push(err("name_length", field, `between ${LIMITS.nameMin} and ${LIMITS.nameMax} characters`));
  if (!NAME_CHARS.test(n)) out.push(err("name_chars", field, "letters, digits, spaces and - _ . & ' ( ) only"));
  if (DOMAIN_IN_NAME.test(n)) out.push(err("name_domain", field, "a name must not contain a domain name"));
  if (mixedScripts(n)) out.push(err("name_mixed_script", field, "Latin letters mixed with Cyrillic or Greek letters"));
  const sk = skeleton(n);
  if (!sk) return out;
  const words = n.split(/[\s\-_.&'()·:,，：（）]+/u).map(skeleton).filter(Boolean);
  for (const r of reserved) {
    const rs = skeleton(r);
    // Five characters or more: anywhere in the name. Shorter: a whole word.
    if (rs.length >= 5 || /[^\x00-\x7f]/.test(rs) ? sk.includes(rs) : sk === rs || words.includes(rs)) { out.push(err("name_reserved", field, `too close to the reserved name "${r}"`)); break; }
  }
  for (const o of names) {
    if (o.id === self) continue;
    if (own && (o.owner === domain || (!o.owner && o.domain === domain))) continue;
    if (skeleton(o.name) === sk) { out.push(err("name_taken", field, `too close to the name of ${o.id}`)); break; }
  }
  return out;
}

// The host of a URL in lower case, or null.
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } }

export const inDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

export function checkDomainSyntax(domain) {
  const d = String(domain || "").toLowerCase();
  if (!HOST_RE.test(d) || IPV4.test(d)) return [err("domain_invalid", "domain", "a domain name such as example.com")];
  return [];
}

// A callback, logout or ACS URL. Exact (compared byte for byte), https,
// without credentials, fragment, wildcard or IP literal; on the app's domain.
// http://localhost, 127.0.0.1 and [::1] only in development.
export function checkUrl(u, field, { domain, development = false } = {}) {
  const out = [];
  let url;
  try { url = new URL(u); } catch { return [err("url_invalid", field, "not a URL")]; }
  if (url.href !== u && url.href !== `${u}/`) out.push(err("url_not_normal", field, `write it as ${url.href}`));
  if (String(u).includes("*")) out.push(err("url_wildcard", field, "no wildcards"));
  if (url.username || url.password) out.push(err("url_userinfo", field, "no user name or password in the URL"));
  if (url.hash || String(u).includes("#")) out.push(err("url_fragment", field, "no fragment"));
  const host = url.hostname.toLowerCase();
  const loop = LOOPBACK.has(host) || LOOPBACK.has(`[${host}]`);
  if (loop) {
    if (!development) out.push(err("url_localhost_active", field, "localhost is allowed only in development mode"));
    if (url.protocol !== "http:" && url.protocol !== "https:") out.push(err("url_scheme", field, "http or https"));
    return out;
  }
  if (url.protocol !== "https:") out.push(err("url_https", field, "must use https"));
  if (IPV4.test(host) || host.startsWith("[") || host.includes(":")) out.push(err("url_ip", field, "use a host name, not an IP address"));
  else if (domain && !inDomain(host, domain)) out.push(err("url_off_domain", field, `the host must be ${domain} or a subdomain of it`));
  return out;
}

// The full automated review of one application entry.
export async function checkApp(entry, ctx = {}) {
  const errors = [];
  const domain = String(entry.domain || "").toLowerCase();
  const development = !!ctx.development;
  errors.push(...checkDomainSyntax(domain));
  const names = ctx.names || [];
  errors.push(...checkName(entry.name && entry.name.en, "name.en", { names, self: entry.client_id, reserved: ctx.reserved || RESERVED, domain }));
  if (entry.name && entry.name.zh) errors.push(...checkName(entry.name.zh, "name.zh", { names, self: entry.client_id, reserved: ctx.reserved || RESERVED, domain }));
  const urls = [];
  if (entry.homepage) urls.push(["homepage", entry.homepage, false]);
  const cb = entry.protocol === "saml2" ? entry.acs_urls : entry.redirect_uris;
  if (!Array.isArray(cb) || !cb.length) errors.push(err("url_missing", entry.protocol === "saml2" ? "acs_urls" : "redirect_uris", "at least one is required"));
  (cb || []).forEach((u, i) => urls.push([`${entry.protocol === "saml2" ? "acs_urls" : "redirect_uris"}[${i}]`, u, true]));
  (entry.post_logout_redirect_uris || []).forEach((u, i) => urls.push([`post_logout_redirect_uris[${i}]`, u, true]));
  for (const [field, u, devOk] of urls) {
    const e = checkUrl(u, field, { domain: errors.some((x) => x.field === "domain") ? null : domain, development: development && devOk });
    if (field === "homepage" && e.some((x) => x.code === "url_localhost_active")) { errors.push(err("url_localhost_active", field, "the homepage must be a public https page")); continue; }
    errors.push(...e);
  }
  // A SAML application's entity ID is an https URL on its own domain (or a
  // subdomain): it is the Audience of the assertions RoamID issues, so it
  // must not name another service.
  if (entry.protocol === "saml2") {
    let u = null; try { u = new URL(String(entry.entity_id || "")); } catch { /* not a URL */ }
    const okHost = u && u.protocol === "https:" && !u.username && !u.password && !u.port && domain && inDomain(u.hostname.toLowerCase(), domain);
    if (!okHost) errors.push(err("entity_domain", "entity_id", `must be an https URL on ${domain || "the application's domain"} or a subdomain of it`));
  }
  const hosts = [...new Set(urls.map(([, u]) => hostOf(u)).filter((h) => h && !LOOPBACK.has(h) && h !== "[::1]"))];
  if (!errors.length) {
    if (ctx.banned && (await ctx.banned(domain))) errors.push(err("domain_banned", "domain", "this domain belongs to an application that was banned"));
    for (const h of [domain, ...hosts]) {
      const src = ctx.blocked ? await ctx.blocked(h) : null;
      if (src) { errors.push(err("reputation", "domain", `${h} is listed by ${src}`)); break; }
    }
    if (ctx.resolves) {
      for (const h of hosts) if (!(await ctx.resolves(h))) errors.push(err("host_unresolved", "redirect_uris", `${h} does not resolve in public DNS`));
    }
  }
  return { errors, hosts };
}

// Development mode is needed exactly when a callback is on a loopback host.
export function needsDevelopment(entry) {
  const cb = [...(entry.redirect_uris || entry.acs_urls || []), ...(entry.post_logout_redirect_uris || [])];
  return cb.some((u) => { const h = hostOf(u); return h && (LOOPBACK.has(h) || h === "[::1]"); });
}

// Domain proof: TXT _roamid-app.<domain> = "roamid-app=<client_id>", or
// https://<domain>/.well-known/roamid-app.txt with the client_id on a line.
export const appProofName = (domain) => `_roamid-app.${domain}`;
export const appProofValue = (clientId) => `roamid-app=${clientId}`;
export const appProofUrl = (domain) => `https://${domain}/.well-known/roamid-app.txt`;

export async function proveAppDomain(domain, clientId, { lookupTxt, fetchFn = fetch } = {}) {
  let txtError = null;
  try {
    const values = await lookupTxt(appProofName(domain));
    if (values.some((v) => v.trim() === appProofValue(clientId))) return { ok: true, method: "dns" };
  } catch (e) { txtError = e.message || String(e); }
  try {
    const r = await fetchFn(appProofUrl(domain), { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { Accept: "text/plain" } });
    if (r.ok) {
      const body = (await r.text()).slice(0, 4096);
      if (body.split(/\r?\n/).some((l) => l.trim() === clientId || l.trim() === appProofValue(clientId))) return { ok: true, method: "well-known" };
      return { ok: false, error: `${appProofUrl(domain)} does not contain ${clientId}` };
    }
    return { ok: false, error: `TXT ${appProofName(domain)} not found${txtError ? ` (${txtError})` : ""}; ${appProofUrl(domain)} returned HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: `TXT ${appProofName(domain)} not found${txtError ? ` (${txtError})` : ""}; ${appProofUrl(domain)}: ${e.message || e}` };
  }
}

// Public DNS: true when the host has an A or AAAA record (DNS over HTTPS).
export async function resolvesPublic(host, { fetchFn = fetch } = {}) {
  for (const type of ["A", "AAAA"]) {
    try {
      const r = await fetchFn(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      if ((j.Answer || []).some((a) => a.type === 1 || a.type === 28)) return true;
    } catch { /* next */ }
  }
  return false;
}
