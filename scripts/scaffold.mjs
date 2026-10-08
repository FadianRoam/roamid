// Building registry entries from plain fields: shared by `npm run new:app`,
// `npm run new:idp` and the issue-form workflow. Pure functions, no network,
// no dependencies. Every field is data; nothing in it is executed.

import { validateClient, validateIdp, proofName, proofValue } from "../src/registry/validate.js";
import { checkName, checkUrl, checkDomainSyntax, appProofName, appProofValue, appProofUrl } from "../src/apps/checks.js";

export const BASE_URL = "https://id.fadianro.am";
const str = (v, max = 500) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);
const lines = (v) => str(v, 4000).split(/\n|,|\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
const lower = (v, max) => str(v, max).toLowerCase();

// fields: client_id, name_en, name_zh, domain, homepage, protocol, redirect_uris,
// post_logout_redirect_uris, auth, jwks_uri, subject_type, allowed_idps,
// entity_id, acs_urls, sign_cert, github, email, client_secret_sha256
export function buildClient(f) {
  const protocol = f.protocol === "saml2" ? "saml2" : "oidc";
  const e = {
    $schema: protocol === "saml2" ? "../../schema/client-saml2.schema.json" : "../../schema/client.schema.json",
    client_id: lower(f.client_id, 64), protocol,
    name: { en: str(f.name_en, 80), ...(str(f.name_zh) ? { zh: str(f.name_zh, 80) } : {}) },
    homepage: str(f.homepage, 300), domain: lower(f.domain, 253).replace(/\.$/, ""),
    contact: { github: str(f.github, 39), email: str(f.email, 254) },
  };
  if (protocol === "saml2") {
    e.entity_id = str(f.entity_id, 500);
    e.acs_urls = lines(f.acs_urls);
    if (str(f.sign_cert)) e.sign_cert = str(f.sign_cert, 8000);
  } else {
    e.redirect_uris = lines(f.redirect_uris);
    const plr = lines(f.post_logout_redirect_uris);
    if (plr.length) e.post_logout_redirect_uris = plr;
    e.token_endpoint_auth_method = ["none", "private_key_jwt", "client_secret_basic", "client_secret_post"].includes(f.auth) ? f.auth : "none";
    if (e.token_endpoint_auth_method === "private_key_jwt") e.jwks_uri = str(f.jwks_uri, 300);
    if (/^client_secret_/.test(e.token_endpoint_auth_method)) e.client_secret_sha256 = lower(f.client_secret_sha256, 64);
  }
  e.subject_type = f.subject_type === "pairwise" ? "pairwise" : "public";
  const allowed = lines(f.allowed_idps);
  if (allowed.length) e.allowed_idps = allowed;
  e.status = "active";
  const errors = [...validateClient(e)];
  if (/^app-/.test(e.client_id) || ["roamid-console", "roamid-test"].includes(e.client_id)) errors.push("client_id: reserved for the console");
  // The automated review's offline rules (names, domain, URLs); DNS and the
  // domain proof are checked later by CI and the automatic merge.
  errors.push(...checkDomainSyntax(e.domain).map((x) => `domain: ${x.message}`));
  for (const k of ["en", "zh"]) if (e.name[k]) errors.push(...checkName(e.name[k], `name.${k}`).map((x) => `${x.field}: ${x.message}`));
  for (const u of [e.homepage, ...(e.redirect_uris || e.acs_urls || []), ...(e.post_logout_redirect_uris || [])]) {
    errors.push(...checkUrl(u, "url", { domain: e.domain }).map((x) => `${u}: ${x.message}`));
  }
  return { entry: e, errors: [...new Set(errors)] };
}

export function clientInstructions(e) {
  return [
    `File: registry/clients/${e.client_id}.json`,
    "Prove the domain with one of:",
    `  DNS TXT  ${appProofName(e.domain)}  "${appProofValue(e.client_id)}"`,
    `  or the file ${appProofUrl(e.domain)} containing the line ${e.client_id}`,
    e.protocol === "saml2" ? `IdP metadata: ${BASE_URL}/saml/idp/metadata.xml` : `Issuer: ${BASE_URL}  (discovery: ${BASE_URL}/.well-known/openid-configuration)`,
  ];
}

// fields: id, name_en, name_zh, protocol, issuer, homepage, client_id, client_auth,
// scopes, email_domains, metadata_url, entity_id, sso_url, certs, sub_source,
// email_attribute_verified, github, email
export function buildIdp(f) {
  const protocol = f.protocol === "saml2" ? "saml2" : "oidc";
  const e = {
    $schema: protocol === "saml2" ? "../../../schema/idp-saml2.schema.json" : "../../../schema/idp.schema.json",
    id: lower(f.id, 32), protocol,
    name: { en: str(f.name_en, 80), ...(str(f.name_zh) ? { zh: str(f.name_zh, 80) } : {}) },
  };
  if (protocol === "saml2") {
    e.homepage = str(f.homepage, 300);
    e.contact = { github: str(f.github, 39), email: str(f.email, 254) };
    if (str(f.metadata_url)) { e.metadata_url = str(f.metadata_url, 500); if (str(f.entity_id)) e.entity_id = str(f.entity_id, 500); }
    else { e.entity_id = str(f.entity_id, 500); e.sso_url = str(f.sso_url, 500); e.certs = str(f.certs, 16000).split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean).slice(0, 4); }
    e.sub_source = str(f.sub_source, 200) || "nameid";
    e.email_attribute_verified = /^(true|yes|1)$/i.test(str(f.email_attribute_verified));
  } else {
    e.issuer = str(f.issuer, 300);
    e.homepage = str(f.homepage, 300);
    e.contact = { github: str(f.github, 39), email: str(f.email, 254) };
    e.client_id = str(f.client_id, 200);
    e.client_auth = ["private_key_jwt", "client_secret_basic", "client_secret_post"].includes(f.client_auth) ? f.client_auth : "private_key_jwt";
    e.scopes = lines(f.scopes).length ? lines(f.scopes) : ["openid", "email", "profile"];
  }
  const doms = lines(f.email_domains).map((d) => d.toLowerCase());
  if (doms.length) e.email_domains = doms;
  e.status = "active";
  return { entry: e, errors: validateIdp(e) };
}

export function idpInstructions(e) {
  const out = [`File: registry/idps/${e.id}/idp.json (optional logo: registry/idps/${e.id}/logo.png, .webp or .jpg)`];
  if (e.protocol === "saml2") {
    out.push(`Service provider metadata to load at your IdP: ${BASE_URL}/saml/sp/metadata.xml?idp=${e.id}`, `ACS URL: ${BASE_URL}/saml/acs/${e.id}`);
  } else {
    out.push(`Redirect URI to register at your IdP: ${BASE_URL}/callback/${e.id}`);
    if (e.client_auth === "private_key_jwt") out.push(`JWKS URI to register for the client: ${BASE_URL}/client-jwks.json`);
    else out.push("Send the client secret to the RoamID operator privately (SECURITY.md); it is never put in the repository.");
  }
  for (const d of e.email_domains || []) out.push(`DNS TXT  ${proofName(d)}  "${proofValue(e.id)}"`);
  return out;
}

// ---- GitHub issue forms ----------------------------------------------------------

// Issue forms are rendered as "### <label>\n\n<value>". Returns label -> value
// ("_No response_" is empty). Only the labels in `known` are kept.
export function parseIssueForm(body, known) {
  const out = {};
  const parts = String(body || "").replace(/\r/g, "").split(/^### /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const label = (nl < 0 ? p : p.slice(0, nl)).trim();
    const key = known[label];
    if (!key || key in out) continue;
    let v = nl < 0 ? "" : p.slice(nl + 1).trim();
    if (v === "_No response_") v = "";
    v = v.replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
    out[key] = v.slice(0, 16000);
  }
  return out;
}

// A pasted secret: a private key, or "secret"/"password"/"token" with a value,
// or a long random-looking string outside the fields where one is expected.
const SECRET_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(client_?secret|secret|password|passwd|api[_-]?key|token)\b\s*[:=]\s*\S{8,}/i;
const RANDOM_RE = /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_=-])/;
const CERT_FIELDS = new Set(["sign_cert", "certs"]);
export function findSecrets(fields) {
  const hits = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "logo" || k === "logo_rights") continue;
    if (SECRET_RE.test(v)) { hits.push(k); continue; }
    if (CERT_FIELDS.has(k) || k === "client_secret_sha256") continue;
    const plain = String(v).replace(/https?:\/\/\S+/g, "");
    if (RANDOM_RE.test(plain) && !/^[a-f0-9]{64}$/.test(plain.trim())) hits.push(k);
  }
  return hits;
}

// The issue body with the values of `keys` replaced.
export function redactIssue(body, labelsByKey, keys) {
  let out = String(body || "");
  for (const k of keys) {
    const label = labelsByKey[k];
    if (!label) continue;
    const re = new RegExp(`(^### ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n)([\\s\\S]*?)(?=^### |$(?![\\s\\S]))`, "m");
    out = out.replace(re, "$1\n[removed: this field looked like a secret]\n\n");
  }
  return out;
}

// Text from an issue, made safe to quote in a comment: one line, no
// mentions, no markup, no HTML.
export function quote(s, max = 200) {
  return "`" + String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/`/g, "'").replace(/@/g, "@​").replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›")).slice(0, max) + "`";
}
