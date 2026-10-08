// The registry rules. One module, used by CI (scripts/check.mjs,
// scripts/build-registry.mjs) and by the Worker when it loads registry.json,
// so a rule cannot pass in one place and fail in the other.
//
//   validateIdp(entry)          -> [errors]
//   validateClient(entry)       -> [errors]
//   validateRegistry(doc)       -> { idps, clients, dropped }   entry by entry
//   checkFileNames(files)       -> [errors]                     CI only
//   checkImmutable(base, head)  -> [errors]                     CI only

import idpSchema from "../../schema/idp.schema.json" with { type: "json" };
import idpSamlSchema from "../../schema/idp-saml2.schema.json" with { type: "json" };
import clientSchema from "../../schema/client.schema.json" with { type: "json" };
import clientSamlSchema from "../../schema/client-saml2.schema.json" with { type: "json" };

export { idpSchema, idpSamlSchema, clientSchema, clientSamlSchema };

const CERT_RE = /^(-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*|[A-Za-z0-9+/=\s]+)$/;

export const LIMITS = { idps: 500, clients: 5000, bytes: 2 * 1024 * 1024 };
export const ID_RE = /^[a-z0-9-]{2,32}$/;
export const CLIENT_ID_RE = /^[a-z0-9-]{2,64}$/;

const EMAIL_RE = /^[^\s@<>()",;:\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

// The subset of JSON Schema 2020-12 that the two schemas use.
export function checkSchema(schema, value, path = "") {
  const errs = [];
  const at = path || "(entry)";
  if (schema.type) {
    const t = typeOf(value);
    const ok = schema.type === t || (schema.type === "number" && (t === "integer" || t === "number"));
    if (!ok) return [`${at}: must be ${schema.type}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${at}: too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${at}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errs.push(`${at}: does not match ${schema.pattern}`);
    if (schema.format === "uri") { try { new URL(value); } catch { errs.push(`${at}: not a URL`); } }
    if (schema.format === "email" && !EMAIL_RE.test(value)) errs.push(`${at}: not an email address`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${at}: at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errs.push(`${at}: items must be unique`);
    if (schema.items) value.forEach((v, i) => errs.push(...checkSchema(schema.items, v, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path ? path + "." : ""}${k}: required`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties && schema.properties[k];
      if (sub) errs.push(...checkSchema(sub, v, path ? `${path}.${k}` : k));
      else if (schema.additionalProperties === false) errs.push(`${path ? path + "." : ""}${k}: unknown field`);
    }
  }
  return errs;
}

function parseUrl(s) { try { return new URL(s); } catch { return null; } }

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// An https URL without credentials, query or fragment (issuer, homepage).
function httpsUrl(s, field, { allowQuery = false } = {}) {
  const u = parseUrl(s);
  if (!u) return [`${field}: not a URL`];
  const e = [];
  if (u.protocol !== "https:") e.push(`${field}: must use https`);
  if (u.username || u.password) e.push(`${field}: must not contain credentials`);
  if (u.hash || String(s).includes("#")) e.push(`${field}: must not contain a fragment`);
  if (!allowQuery && u.search) e.push(`${field}: must not contain a query`);
  return e;
}

// Redirect URIs are compared byte for byte. https, or http only on a
// loopback host for local development (RFC 8252 section 7.3). No fragment,
// no wildcard, no credentials.
export function redirectUriErrors(s, field) {
  const u = parseUrl(s);
  if (!u) return [`${field}: not a URL`];
  const e = [];
  const loopback = u.protocol === "http:" && LOOPBACK.has(u.hostname);
  if (u.protocol !== "https:" && !loopback) e.push(`${field}: must use https (http is allowed only for localhost)`);
  if (u.username || u.password) e.push(`${field}: must not contain credentials`);
  if (String(s).includes("#")) e.push(`${field}: must not contain a fragment`);
  if (String(s).includes("*")) e.push(`${field}: wildcards are not allowed`);
  if (/\s/.test(String(s))) e.push(`${field}: must not contain whitespace`);
  return e;
}

export function validateIdp(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return ["entry: must be an object"];
  if (entry.protocol === "saml2") return validateSamlIdp(entry);
  const errs = checkSchema(idpSchema, entry);
  if (errs.length) return errs;
  errs.push(...httpsUrl(entry.issuer, "issuer"));
  errs.push(...httpsUrl(entry.homepage, "homepage", { allowQuery: true }));
  if (entry.protocol === "oidc" && !entry.scopes.includes("openid")) errs.push("scopes: must include openid");
  if (entry.client_assertion_aud && entry.client_auth !== "private_key_jwt") errs.push("client_assertion_aud: only with client_auth private_key_jwt");
  const doms = (entry.email_domains || []).map(domainBase);
  if (new Set(doms).size !== doms.length) errs.push("email_domains: a domain is listed twice");
  return errs;
}

function validateSamlIdp(entry) {
  const errs = checkSchema(idpSamlSchema, entry);
  if (errs.length) return errs;
  errs.push(...httpsUrl(entry.homepage, "homepage", { allowQuery: true }));
  if (entry.metadata_url) {
    errs.push(...httpsUrl(entry.metadata_url, "metadata_url", { allowQuery: true }));
    if (entry.sso_url || entry.certs) errs.push("sso_url and certs: not allowed with metadata_url (they come from the metadata)");
  } else {
    if (!entry.entity_id) errs.push("entity_id: required without metadata_url");
    if (!entry.sso_url) errs.push("sso_url: required without metadata_url");
    else errs.push(...httpsUrl(entry.sso_url, "sso_url", { allowQuery: true }));
    if (!entry.certs) errs.push("certs: required without metadata_url");
  }
  (entry.certs || []).forEach((c, i) => { if (!CERT_RE.test(c)) errs.push(`certs[${i}]: not a certificate`); });
  const doms = (entry.email_domains || []).map(domainBase);
  if (new Set(doms).size !== doms.length) errs.push("email_domains: a domain is listed twice");
  return errs;
}

// The key that must be unique across identity providers.
export const idpKey = (e) => (e.protocol === "saml2" ? `saml:${e.entity_id || e.metadata_url}` : `oidc:${e.issuer}`);

// "*.example.org" -> "example.org"; "example.org" -> "example.org".
export const domainBase = (d) => String(d).replace(/^\*\./, "");

// The DNS name that proves a declared domain, and the TXT value it must hold.
export const proofName = (d) => `_roamid.${domainBase(d)}`;
export const proofValue = (idpId) => `roamid-idp=${idpId}`;

// Does declared domain `a` overlap declared domain `b`? Equal names overlap;
// a wildcard overlaps every name below its base.
export function domainsOverlap(a, b) {
  const ba = domainBase(a), bb = domainBase(b);
  const wa = a.startsWith("*."), wb = b.startsWith("*.");
  if (a === b) return true;
  if (wa && bb.endsWith("." + ba)) return true;
  if (wb && ba.endsWith("." + bb)) return true;
  if (wa && wb && ba === bb) return true;
  return false;
}

// Is `email` inside declared domain `d`? Exact domain, or a subdomain of a
// "*." declaration. Case-insensitive.
export function emailInDomain(email, d) {
  const at = String(email).lastIndexOf("@");
  if (at < 1) return false;
  const host = String(email).slice(at + 1).toLowerCase();
  if (d.startsWith("*.")) return host.endsWith("." + domainBase(d));
  return host === d;
}

export function validateClient(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return ["entry: must be an object"];
  if (entry.protocol === "saml2") return validateSamlClient(entry);
  const errs = checkSchema(clientSchema, entry);
  if (errs.length) return errs;
  errs.push(...httpsUrl(entry.homepage, "homepage", { allowQuery: true }));
  entry.redirect_uris.forEach((u, i) => errs.push(...redirectUriErrors(u, `redirect_uris[${i}]`)));
  (entry.post_logout_redirect_uris || []).forEach((u, i) => errs.push(...redirectUriErrors(u, `post_logout_redirect_uris[${i}]`)));
  const m = entry.token_endpoint_auth_method;
  if (m === "none") {
    if (entry.client_secret_sha256) errs.push("client_secret_sha256: not allowed for a public client (none)");
    if (entry.jwks_uri) errs.push("jwks_uri: not allowed for a public client (none)");
  } else if (m === "private_key_jwt") {
    if (!entry.jwks_uri) errs.push("jwks_uri: required for private_key_jwt");
    else errs.push(...httpsUrl(entry.jwks_uri, "jwks_uri", { allowQuery: true }));
    if (entry.client_secret_sha256) errs.push("client_secret_sha256: not allowed with private_key_jwt");
  } else {
    if (!entry.client_secret_sha256) errs.push(`client_secret_sha256: required for ${m}`);
    if (entry.jwks_uri) errs.push(`jwks_uri: not allowed with ${m}`);
  }
  if (entry.subject_type === "pairwise") {
    const hosts = new Set(entry.redirect_uris.map((u) => parseUrl(u)?.host));
    if (hosts.size !== 1) errs.push("subject_type pairwise: all redirect_uris must be on one host (the sector)");
  }
  return errs;
}

function validateSamlClient(entry) {
  const errs = checkSchema(clientSamlSchema, entry);
  if (errs.length) return errs;
  errs.push(...httpsUrl(entry.homepage, "homepage", { allowQuery: true }));
  entry.acs_urls.forEach((u, i) => errs.push(...redirectUriErrors(u, `acs_urls[${i}]`)));
  if (entry.sign_cert && !CERT_RE.test(entry.sign_cert)) errs.push("sign_cert: not a certificate");
  if (entry.subject_type === "pairwise" && new Set(entry.acs_urls.map((u) => parseUrl(u)?.host)).size !== 1) errs.push("subject_type pairwise: all acs_urls must be on one host (the sector)");
  return errs;
}

// The sector of a pairwise client: the one host its redirect (or ACS) URLs share.
export function sectorOf(client) {
  return new URL((client.redirect_uris || client.acs_urls)[0]).host;
}

// Load a registry document entry by entry. An invalid entry is dropped with
// its reasons; the rest is kept. Cross-entry rules (unique ids and issuers,
// allowed_idps that exist) are applied in file order: the first holder of an
// id wins. `strict` (CI) reports unknown allowed_idps as errors; at run time
// they are only filtered out.
export function validateRegistry(doc, { strict = false } = {}) {
  const dropped = [];
  const idps = [];
  const clients = [];
  const list = (v) => (Array.isArray(v) ? v : []);
  if (list(doc && doc.idps).length > LIMITS.idps) dropped.push({ kind: "registry", id: "idps", errors: [`more than ${LIMITS.idps} identity providers`] });
  if (list(doc && doc.clients).length > LIMITS.clients) dropped.push({ kind: "registry", id: "clients", errors: [`more than ${LIMITS.clients} clients`] });
  const ids = new Set(), issuers = new Set(), cids = new Set(), spIds = new Set();
  for (const e of list(doc && doc.idps).slice(0, LIMITS.idps)) {
    const id = e && typeof e.id === "string" ? e.id : "(unknown)";
    const errs = validateIdp(e);
    if (!errs.length && ids.has(e.id)) errs.push("id: duplicate");
    if (!errs.length && issuers.has(idpKey(e))) errs.push(`${e.protocol === "saml2" ? "entity_id" : "issuer"}: already registered by another entry`);
    if (!errs.length) {
      for (const d of e.email_domains || []) {
        const other = idps.find((o) => (o.email_domains || []).some((od) => domainsOverlap(d, od)));
        if (other) errs.push(`email_domains: ${d} is already claimed by ${other.id}`);
      }
    }
    if (errs.length) { dropped.push({ kind: "idp", id, errors: errs }); continue; }
    ids.add(e.id); issuers.add(idpKey(e)); idps.push(e);
  }
  for (const e of list(doc && doc.clients).slice(0, LIMITS.clients)) {
    const id = e && typeof e.client_id === "string" ? e.client_id : "(unknown)";
    const errs = validateClient(e);
    if (!errs.length && cids.has(e.client_id)) errs.push("client_id: duplicate");
    if (!errs.length && (/^app-/.test(e.client_id) || e.client_id === "roamid-console" || e.client_id === "roamid-test")) errs.push("client_id: reserved (app-… identifiers belong to console applications)");
    if (!errs.length && e.protocol === "saml2" && spIds.has(e.entity_id)) errs.push("entity_id: already registered by another entry");
    if (!errs.length && strict && e.allowed_idps) {
      for (const a of e.allowed_idps) if (!ids.has(a)) errs.push(`allowed_idps: unknown identity provider ${a}`);
    }
    if (errs.length) { dropped.push({ kind: "client", id, errors: errs }); continue; }
    cids.add(e.client_id); if (e.protocol === "saml2") spIds.add(e.entity_id); clients.push(e);
  }
  return { idps, clients, dropped };
}

// CI: every file is registry/idps/<id>.json or registry/clients/<client_id>.json
// and its name equals the identifier inside it.
export function checkFileNames(files) {
  const errs = [];
  for (const f of files) {
    const m = /^registry\/(idps|clients)\/([^/]+)\.json$/.exec(f.path);
    if (!m) { errs.push(`${f.path}: files go in registry/idps/<id>.json or registry/clients/<client_id>.json`); continue; }
    if (!f.json || typeof f.json !== "object") { errs.push(`${f.path}: not valid JSON`); continue; }
    const want = m[1] === "idps" ? f.json.id : f.json.client_id;
    if (want !== m[2]) errs.push(`${f.path}: file name must equal the ${m[1] === "idps" ? "id" : "client_id"} (${String(want)})`);
  }
  return errs;
}

// CI: identifiers are permanent. Every IdP id and client_id on the base
// branch must still exist on the head, in the same file. A rename is a
// delete plus an add and is refused the same way. Retire with
// "status": "disabled".
export function checkImmutable(base, head) {
  const errs = [];
  for (const kind of ["idps", "clients"]) {
    const have = new Set(head[kind] || []);
    for (const id of base[kind] || []) {
      if (!have.has(id)) errs.push(`registry/${kind}/${id}.json: ${kind === "idps" ? "id" : "client_id"} "${id}" was removed or renamed; identifiers are permanent, set "status": "disabled" instead`);
    }
  }
  return errs;
}
