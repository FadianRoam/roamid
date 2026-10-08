// RoamID as a relying party of a community identity provider (OIDC).

import { b64url, randomToken, sha256b64url } from "../lib/b64.js";
import { sign, verify, SUPPORTED_ALGS } from "../lib/jwt.js";
import { clientKeys } from "../lib/keys.js";
import { now } from "../lib/http.js";
import { emailAuthority } from "../registry/domains.js";

export const UPSTREAM_TIMEOUT = 10000;
const DISCOVERY_TTL = 3600;
const JWKS_TTL = 3600;
const JWKS_MIN_REFRESH = 30;
const discoveryCache = new Map(); // issuer -> { at, doc }
const jwksCache = new Map();      // jwks_uri -> { at, keys }

export class UpstreamError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function resetUpstreamCaches() { discoveryCache.clear(); jwksCache.clear(); }

async function getJson(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) });
  } catch (e) {
    throw new UpstreamError("upstream_unreachable", `${new URL(url).host}: ${e && e.name === "TimeoutError" ? "timed out" : "unreachable"}`);
  }
  const body = await res.text();
  if (body.length > 512 * 1024) throw new UpstreamError("upstream_bad_response", `${new URL(url).host}: response too large`);
  let data = null;
  try { data = JSON.parse(body); } catch { /* handled below */ }
  return { status: res.status, data };
}

const isHttps = (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };

// The provider's discovery document, checked against the registry entry.
export async function discovery(idp, { fresh = false } = {}) {
  const hit = discoveryCache.get(idp.issuer);
  if (!fresh && hit && now() - hit.at < DISCOVERY_TTL) return hit.doc;
  const url = idp.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const { status, data } = await getJson(url, { headers: { Accept: "application/json" } });
  if (status !== 200 || !data || typeof data !== "object") throw new UpstreamError("upstream_discovery_failed", `discovery returned HTTP ${status}`);
  const problems = discoveryProblems(idp, data);
  if (problems.length) throw new UpstreamError("upstream_discovery_failed", problems.join("; "));
  discoveryCache.set(idp.issuer, { at: now(), doc: data });
  return data;
}

// What RoamID needs from a provider (docs/idp-requirements.md). Also used by
// the CI probe.
export function discoveryProblems(idp, d) {
  const p = [];
  if (d.issuer !== idp.issuer) p.push(`issuer in discovery (${d.issuer}) differs from the registry (${idp.issuer})`);
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) if (!isHttps(d[k])) p.push(`${k} missing or not https`);
  if (d.userinfo_endpoint !== undefined && !isHttps(d.userinfo_endpoint)) p.push("userinfo_endpoint not https");
  if (Array.isArray(d.response_types_supported) && !d.response_types_supported.includes("code")) p.push("response type code not supported");
  if (!Array.isArray(d.code_challenge_methods_supported) || !d.code_challenge_methods_supported.includes("S256")) p.push("PKCE S256 not advertised (code_challenge_methods_supported)");
  if (Array.isArray(d.response_modes_supported) && !d.response_modes_supported.includes("query")) p.push("response_mode query not supported");
  const algs = Array.isArray(d.id_token_signing_alg_values_supported) ? d.id_token_signing_alg_values_supported : ["RS256"];
  if (!algs.some((a) => a === "RS256" || a === "ES256")) p.push("ID tokens are not signed with RS256 or ES256");
  const methods = Array.isArray(d.token_endpoint_auth_methods_supported) ? d.token_endpoint_auth_methods_supported : ["client_secret_basic"];
  if (!methods.includes(idp.client_auth)) p.push(`client authentication ${idp.client_auth} not advertised`);
  return p;
}

async function jwks(uri, { force = false } = {}) {
  const hit = jwksCache.get(uri);
  if (hit && (!force ? now() - hit.at < JWKS_TTL : now() - hit.at < JWKS_MIN_REFRESH)) return hit.keys;
  const { status, data } = await getJson(uri, { headers: { Accept: "application/json" } });
  if (status !== 200 || !data || !Array.isArray(data.keys)) throw new UpstreamError("upstream_jwks_failed", `JWKS returned HTTP ${status}`);
  jwksCache.set(uri, { at: now(), keys: data.keys });
  return data.keys;
}

// Verify a JWS against a JWKS URI; on an unknown kid, refetch once.
export async function verifyWithJwks(token, uri, algs) {
  try {
    return await verify(token, await jwks(uri), algs);
  } catch (e) {
    if (e.code !== "no_key") throw e;
    return verify(token, await jwks(uri, { force: true }), algs);
  }
}

export function secretName(idpId) {
  return "IDP_SECRET_" + idpId.toUpperCase().replace(/-/g, "_");
}

// The authorization request to the provider. Returns { url, state, nonce, verifier }.
export async function authorizeUrl(env, idp, tx) {
  const d = await discovery(idp);
  const state = randomToken(24), nonce = randomToken(24), verifier = randomToken(48);
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("client_id", idp.client_id);
  u.searchParams.set("redirect_uri", callbackUrl(env, idp));
  u.searchParams.set("scope", idp.scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", await sha256b64url(verifier));
  u.searchParams.set("code_challenge_method", "S256");
  if (tx.prompt) u.searchParams.set("prompt", tx.prompt);
  if (tx.max_age !== null && tx.max_age !== undefined) u.searchParams.set("max_age", String(tx.max_age));
  if (tx.login_hint) u.searchParams.set("login_hint", tx.login_hint);
  return { url: u.toString(), state, nonce, verifier };
}

export const callbackUrl = (env, idp) => `${env.BASE_URL}/callback/${idp.id}`;

async function clientAuth(env, idp, d, params, headers) {
  if (idp.client_auth === "private_key_jwt") {
    const { signer } = await clientKeys(env);
    const t = now();
    const aud = idp.client_assertion_aud === "issuer" ? idp.issuer : d.token_endpoint;
    const assertion = await sign({ iss: idp.client_id, sub: idp.client_id, aud, jti: randomToken(16), iat: t, exp: t + 60 }, signer);
    params.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    params.set("client_assertion", assertion);
    return;
  }
  const secret = env[secretName(idp.id)];
  if (!secret) throw new UpstreamError("upstream_not_configured", `no client secret configured for ${idp.id}`);
  if (idp.client_auth === "client_secret_post") {
    params.set("client_id", idp.client_id);
    params.set("client_secret", secret);
  } else {
    const form = (s) => encodeURIComponent(s).replace(/%20/g, "+");
    headers.Authorization = "Basic " + btoa(`${form(idp.client_id)}:${form(secret)}`);
  }
}

// Exchange the code, verify the ID token, read userinfo. Returns the
// provider's claims (sub included) and auth details.
export async function completeLogin(env, idp, tx, code) {
  const d = await discovery(idp);
  const params = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(env, idp), code_verifier: tx.up_verifier });
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  await clientAuth(env, idp, d, params, headers);
  const { status, data } = await getJson(d.token_endpoint, { method: "POST", headers, body: params.toString() });
  if (status !== 200 || !data) throw new UpstreamError("upstream_token_failed", `token endpoint returned HTTP ${status}${data && data.error ? ` (${String(data.error).slice(0, 60)})` : ""}`);
  if (typeof data.id_token !== "string") throw new UpstreamError("upstream_token_failed", "no id_token in the token response");
  const algs = Array.isArray(d.id_token_signing_alg_values_supported)
    ? d.id_token_signing_alg_values_supported.filter((a) => SUPPORTED_ALGS.includes(a)) : ["RS256"];
  let payload;
  try {
    ({ payload } = await verifyWithJwks(data.id_token, d.jwks_uri, algs.length ? algs : ["RS256"]));
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError("upstream_id_token_invalid", `ID token signature: ${e.message}`);
  }
  const problems = idTokenProblems(payload, { issuer: idp.issuer, clientId: idp.client_id, nonce: tx.up_nonce });
  if (problems.length) throw new UpstreamError("upstream_id_token_invalid", problems.join("; "));
  let claims = { ...payload };
  if (d.userinfo_endpoint && typeof data.access_token === "string") {
    try {
      const ui = await getJson(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${data.access_token}`, Accept: "application/json" } });
      if (ui.status === 200 && ui.data && typeof ui.data === "object") {
        if (ui.data.sub !== payload.sub) throw new UpstreamError("upstream_userinfo_mismatch", "userinfo sub differs from the ID token");
        claims = { ...ui.data, ...pick(payload, ["iss", "aud", "sub", "nonce", "auth_time", "acr", "amr"]) };
      }
    } catch (e) {
      if (e.code === "upstream_userinfo_mismatch") throw e;
      // userinfo is optional: the ID token's claims are used alone.
    }
  }
  return claims;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export function idTokenProblems(p, { issuer, clientId, nonce, skew = 120 }) {
  const t = now();
  const out = [];
  if (p.iss !== issuer) out.push(`iss ${JSON.stringify(p.iss)} is not the registered issuer`);
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(clientId)) out.push("aud does not contain the client_id");
  if (aud.length > 1 && p.azp !== clientId) out.push("azp is not the client_id");
  if (typeof p.exp !== "number" || p.exp + skew < t) out.push("expired");
  if (typeof p.iat === "number" && p.iat - skew > t) out.push("issued in the future");
  if (typeof p.nbf === "number" && p.nbf - skew > t) out.push("not yet valid");
  if (p.nonce !== nonce) out.push("nonce mismatch");
  if (typeof p.sub !== "string" || !p.sub || p.sub.length > 255) out.push("sub missing or invalid");
  return out;
}

// Normalized claims from the provider's claims, the registry mapping and the
// provider's proven email domains (see ../registry/domains.js).
//   email            passed through when the provider releases it
//   email_verified   true only when email_authority is "authoritative"
//   email_authority  "authoritative" | "asserted"
export function normalize(idp, upstream, domains = []) {
  const m = idp.claims || {};
  const get = (k) => upstream[m[k] || k];
  const out = {};
  const email = get("email");
  if (typeof email === "string" && email.length <= 254 && email.includes("@")) {
    const v = get("email_verified");
    const upstreamVerified = v === true || v === "true";
    out.email = email;
    out.email_authority = emailAuthority(email, upstreamVerified, domains);
    out.email_verified = out.email_authority === "authoritative";
  }
  for (const k of ["name", "preferred_username", "picture"]) {
    const v = get(k);
    if (typeof v === "string" && v.length <= 500) out[k] = v;
  }
  if (typeof upstream.auth_time === "number") out.auth_time = upstream.auth_time;
  if (typeof upstream.acr === "string") out.acr = upstream.acr.slice(0, 200);
  return out;
}

// sub for a client: public = b64url(SHA-256(idp "|" upstream sub)); pairwise
// mixes in the client's sector (its redirect URI host) first.
export async function subjectFor(idpId, upstreamSub, client, sector) {
  if (client.subject_type === "pairwise") return sha256b64url(`${sector}|${idpId}|${upstreamSub}`);
  return sha256b64url(`${idpId}|${upstreamSub}`);
}

export { b64url };
