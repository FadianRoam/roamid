// RoamID as an OpenID Provider to registered applications.

import { b64url, randomToken, sha256, sha256b64url, sha256hex, safeEqual } from "../lib/b64.js";
import { sign, verify, decode } from "../lib/jwt.js";
import { signingKeys } from "../lib/keys.js";
import { json, html, redirect, cookie, getCookie, readForm, now, newNonce, corsPreflight } from "../lib/http.js";
import { allow } from "../lib/ratelimit.js";
import { clientIp } from "../lib/edgesig.js";
import { count } from "../lib/events.js";
import { getRegistry } from "../registry/store.js";
import { sectorOf } from "../registry/validate.js";
import { authoritativeDomains } from "../registry/domains.js";
import { authorizeUrl, completeLogin, normalize, subjectFor, verifyWithJwks, UpstreamError } from "./upstream.js";
import { pickLang, pickTheme, localName, t } from "../ui/i18n.js";
import { pickerPage, errorPage, messagePage } from "../ui/pages.js";

export const TX_TTL = 600;
export const CODE_TTL = 60;
export const TOKEN_TTL = 3600;
export const BINDING_COOKIE = "__Host-rid_b";
export const LAST_COOKIE = "__Host-rid_last";
const SCOPES = ["openid", "email", "profile"];

export function discoveryDoc(env) {
  const b = env.BASE_URL;
  return {
    issuer: b,
    authorization_endpoint: `${b}/authorize`,
    token_endpoint: `${b}/token`,
    userinfo_endpoint: `${b}/userinfo`,
    jwks_uri: `${b}/jwks.json`,
    end_session_endpoint: `${b}/logout`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public", "pairwise"],
    id_token_signing_alg_values_supported: ["ES256"],
    userinfo_signing_alg_values_supported: ["none"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256", "PS256", "ES256"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "acr", "azp", "at_hash", "idp", "idp_name", "email", "email_verified", "email_authority", "name", "preferred_username", "picture"],
    claim_types_supported: ["normal"],
    prompt_values_supported: ["none", "login", "consent", "select_account"],
    ui_locales_supported: ["en", "zh-CN"],
    claims_parameter_supported: false,
    request_parameter_supported: false,
    request_uri_parameter_supported: false,
    require_request_uri_registration: false,
    authorization_response_iss_parameter_supported: true,
    frontchannel_logout_supported: false,
    backchannel_logout_supported: false,
    service_documentation: "https://github.com/FadianRoam/roamid/blob/main/docs/rp-integration.md",
    op_policy_uri: "https://github.com/FadianRoam/roamid/blob/main/README.md",
  };
}

// ---- helpers -------------------------------------------------------------

function reqId(request) {
  return request.headers.get("CF-Ray") || randomToken(9);
}

function view(request, extra = {}) {
  return { lang: pickLang(request, extra), theme: pickTheme(request), nonce: newNonce(), path: new URL(request.url).pathname + new URL(request.url).search };
}

function errorHtml(request, code, { status = 400, detail, backUrl, rpName, uiLocales } = {}) {
  const v = view(request, { uiLocales });
  const rid = reqId(request);
  console.warn("[roamid] error", code, rid, detail || "");
  return html(errorPage({ ...v, path: "/", code, requestId: rid, detail, backUrl, rpName }), { status, nonce: v.nonce });
}

function rpRedirect(env, redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  u.searchParams.set("iss", env.BASE_URL);
  return u.toString();
}

function rpError(env, tx, error, description) {
  return rpRedirect(env, tx.redirect_uri, { error, error_description: description, state: tx.state });
}

function activeClient(reg, clientId) {
  const c = reg.clients.get(String(clientId || ""));
  return c && c.status === "active" && c.protocol === "oidc" ? c : null;
}

// The IdPs a client may use, in registry order.
export function idpsFor(reg, client) {
  const all = [...reg.idps.values()].filter((i) => i.status === "active");
  return client.allowed_idps ? all.filter((i) => client.allowed_idps.includes(i.id)) : all;
}

async function loadTx(env, id) {
  if (!id || typeof id !== "string" || id.length > 64) return null;
  const tx = await env.DB.prepare("SELECT * FROM tx WHERE id = ?").bind(id).first();
  return tx && tx.expires > now() ? tx : null;
}

async function bindingOk(request, tx) {
  const b = getCookie(request, BINDING_COOKIE);
  return !!b && safeEqual(await sha256b64url(b), tx.binding);
}

// ---- /authorize ------------------------------------------------------------

export async function authorize(request, env) {
  if (!(await allow(env, "authorize", await clientIp(request, env)))) return errorHtml(request, "rate_limited", { status: 429 });
  const q = request.method === "POST" ? (await readForm(request)) || new URLSearchParams() : new URL(request.url).searchParams;
  const reg = await getRegistry(env);
  if (!reg.commit) return errorHtml(request, "registry_unavailable", { status: 503 });
  const uiLocales = q.get("ui_locales");
  const client = activeClient(reg, q.get("client_id"));
  if (!client) return errorHtml(request, "invalid_client", { detail: `client_id: ${String(q.get("client_id") || "").slice(0, 80)}`, uiLocales });
  const redirectUri = q.get("redirect_uri") || "";
  if (!client.redirect_uris.includes(redirectUri)) return errorHtml(request, "invalid_redirect_uri", { detail: redirectUri.slice(0, 200), uiLocales });
  const state = q.get("state");
  const back = (error, description) => redirect(rpRedirect(env, redirectUri, { error, error_description: description, state }));
  for (const k of ["client_id", "redirect_uri", "response_type", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "prompt", "max_age", "login_hint", "ui_locales", "acr_values", "idp_hint", "response_mode"]) {
    if (q.getAll(k).length > 1) return back("invalid_request", `${k} repeated`);
  }
  if (q.get("request")) return back("request_not_supported", "request objects are not supported");
  if (q.get("request_uri")) return back("request_uri_not_supported", "request_uri is not supported");
  if (q.get("response_type") !== "code") return back("unsupported_response_type", "response_type must be code");
  if (q.get("response_mode") && q.get("response_mode") !== "query") return back("invalid_request", "response_mode must be query");
  const scopes = String(q.get("scope") || "").split(" ").filter(Boolean);
  if (!scopes.includes("openid")) return back("invalid_scope", "scope must include openid");
  const scope = scopes.filter((s) => SCOPES.includes(s)).join(" ");
  if (state && state.length > 2048) return back("invalid_request", "state too long");
  const nonce = q.get("nonce");
  if (nonce && nonce.length > 512) return back("invalid_request", "nonce too long");
  const cc = q.get("code_challenge");
  const ccm = q.get("code_challenge_method");
  if (cc || client.token_endpoint_auth_method === "none") {
    if (!cc) return back("invalid_request", "PKCE code_challenge is required for this client");
    if (ccm !== "S256") return back("invalid_request", "code_challenge_method must be S256");
    if (!/^[A-Za-z0-9_-]{43}$/.test(cc)) return back("invalid_request", "code_challenge is not a S256 challenge");
  }
  const prompts = String(q.get("prompt") || "").split(" ").filter(Boolean);
  if (prompts.some((p) => !["none", "login", "consent", "select_account"].includes(p))) return back("invalid_request", "unsupported prompt value");
  if (prompts.includes("none") && prompts.length > 1) return back("invalid_request", "prompt=none cannot be combined");
  let maxAge = null;
  if (q.get("max_age") !== null && q.get("max_age") !== "") {
    if (!/^\d{1,9}$/.test(q.get("max_age"))) return back("invalid_request", "max_age must be a non-negative integer");
    maxAge = Number(q.get("max_age"));
  }
  const allowed = idpsFor(reg, client);
  // Which IdP, if it is already decided: idp_hint, else (unless the person
  // is asked to choose) the remembered choice for prompt=none.
  const hint = q.get("idp_hint");
  let chosen = null;
  if (hint) {
    chosen = allowed.find((i) => i.id === hint) || null;
    if (!chosen && prompts.includes("none")) return back("interaction_required", "idp_hint is not available for this client");
  }
  if (!chosen && prompts.includes("none")) {
    const last = getCookie(request, LAST_COOKIE);
    chosen = allowed.find((i) => i.id === last) || null;
    if (!chosen) return back("interaction_required", "an identity provider must be chosen");
  }
  if (prompts.includes("select_account")) chosen = hint ? chosen : null;

  const binding = getCookie(request, BINDING_COOKIE) || randomToken(32);
  const tx = {
    id: randomToken(24), binding: await sha256b64url(binding), client_id: client.client_id, redirect_uri: redirectUri, scope,
    state, nonce, code_challenge: cc, prompt: prompts.filter((p) => p !== "select_account").join(" ") || null, max_age: maxAge,
    login_hint: (q.get("login_hint") || "").slice(0, 254) || null, acr_values: (q.get("acr_values") || "").slice(0, 200) || null,
    ui_locales: (uiLocales || "").slice(0, 50) || null, expires: now() + TX_TTL,
  };
  await env.DB.prepare(
    `INSERT INTO tx (id, binding, client_id, redirect_uri, scope, state, nonce, code_challenge, prompt, max_age, login_hint, acr_values, ui_locales, expires)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(tx.id, tx.binding, tx.client_id, tx.redirect_uri, tx.scope, tx.state, tx.nonce, tx.code_challenge, tx.prompt, tx.max_age, tx.login_hint, tx.acr_values, tx.ui_locales, tx.expires).run();
  await count(env, "started", { client: client.client_id });
  const cookies = [cookie(BINDING_COOKIE, binding, { maxAge: 3600 })];
  if (chosen) return goUpstream(request, env, tx, chosen, cookies);
  return redirect(`/select?tx=${encodeURIComponent(tx.id)}`, { status: 303, cookies });
}

async function goUpstream(request, env, tx, idp, cookies = []) {
  let up;
  try {
    up = await authorizeUrl(env, idp, tx);
  } catch (e) {
    const code = e instanceof UpstreamError ? e.code : "server_error";
    await count(env, "failed", { idp: idp.id, client: tx.client_id, code });
    const reg = await getRegistry(env);
    const client = reg.clients.get(tx.client_id);
    return errorHtml(request, code, { status: 502, detail: e.message, backUrl: rpError(env, tx, "temporarily_unavailable", `roamid:${code}`), rpName: localName(client, pickLang(request)), uiLocales: tx.ui_locales });
  }
  if (up.url && tx.acr_values) { const u = new URL(up.url); u.searchParams.set("acr_values", tx.acr_values); up.url = u.toString(); }
  await env.DB.prepare("UPDATE tx SET idp = ?, up_state = ?, up_nonce = ?, up_verifier = ? WHERE id = ?")
    .bind(idp.id, await sha256b64url(up.state), up.nonce, up.verifier, tx.id).run();
  return redirect(up.url, { status: 303, cookies: [...cookies, cookie(LAST_COOKIE, idp.id, { maxAge: 365 * 86400 })] });
}

// ---- /select ---------------------------------------------------------------

export async function select(request, env) {
  if (!(await allow(env, "authorize", await clientIp(request, env)))) return errorHtml(request, "rate_limited", { status: 429 });
  const form = request.method === "POST" ? await readForm(request) : null;
  const txId = request.method === "POST" ? form && form.get("tx") : new URL(request.url).searchParams.get("tx");
  const tx = await loadTx(env, txId);
  if (!tx || tx.idp) return errorHtml(request, "tx_expired");
  if (!(await bindingOk(request, tx))) return errorHtml(request, "tx_browser");
  const reg = await getRegistry(env);
  const client = activeClient(reg, tx.client_id);
  if (!client) return errorHtml(request, "invalid_client");
  const allowed = idpsFor(reg, client);
  const lang = pickLang(request, { uiLocales: tx.ui_locales });
  if (request.method === "POST") {
    const id = form && form.get("idp");
    const idp = reg.idps.get(String(id || ""));
    if (!idp) return errorHtml(request, "idp_unknown", { uiLocales: tx.ui_locales });
    if (idp.status !== "active") return errorHtml(request, "idp_disabled", { uiLocales: tx.ui_locales });
    if (!allowed.includes(idp)) return errorHtml(request, "idp_not_allowed", { uiLocales: tx.ui_locales });
    return goUpstream(request, env, tx, idp);
  }
  const v = view(request, { uiLocales: tx.ui_locales });
  const health = await healthMap(env);
  return html(pickerPage({ ...v, lang, tx: tx.id, client, idps: allowed, last: getCookie(request, LAST_COOKIE), cancelUrl: rpError(env, tx, "access_denied", "the user cancelled"), health }), { nonce: v.nonce });
}

export async function healthMap(env) {
  try {
    const { results } = await env.DB.prepare("SELECT idp, state FROM idp_health").all();
    return Object.fromEntries((results || []).map((r) => [r.idp, r.state]));
  } catch { return {}; }
}

// ---- /callback/<idp> -------------------------------------------------------

export async function callback(request, env, idpId) {
  if (!(await allow(env, "authorize", await clientIp(request, env)))) return errorHtml(request, "rate_limited", { status: 429 });
  const q = new URL(request.url).searchParams;
  const st = q.get("state");
  if (!st || st.length > 200) return errorHtml(request, "tx_expired");
  const tx = await env.DB.prepare("SELECT * FROM tx WHERE up_state = ?").bind(await sha256b64url(st)).first();
  if (!tx || tx.expires <= now()) return errorHtml(request, "tx_expired");
  if (!(await bindingOk(request, tx))) return errorHtml(request, "tx_browser");
  // Single use: whatever happens next, this transaction is finished.
  const del = await env.DB.prepare("DELETE FROM tx WHERE id = ?").bind(tx.id).run();
  if (!del.meta || del.meta.changes !== 1) return errorHtml(request, "tx_expired");
  const reg = await getRegistry(env);
  const client = activeClient(reg, tx.client_id);
  if (!client) return errorHtml(request, "invalid_client");
  const rpName = localName(client, pickLang(request, { uiLocales: tx.ui_locales }));
  const fail = async (code, detail, rpErr = "server_error") => {
    await count(env, "failed", { idp: idpId, client: tx.client_id, code });
    return errorHtml(request, code, { status: 400, detail, backUrl: rpError(env, tx, rpErr, `roamid:${code}`), rpName, uiLocales: tx.ui_locales });
  };
  // Each IdP has its own callback path, and the transaction remembers which
  // one it went to: a response for one provider at another's path is a mix-up.
  if (tx.idp !== idpId) return fail("upstream_issuer_mismatch", "callback path does not match the chosen identity provider");
  const idp = reg.idps.get(idpId);
  if (!idp || idp.status !== "active") return fail("idp_disabled");
  if (q.has("iss") && q.get("iss") !== idp.issuer) return fail("upstream_issuer_mismatch", "iss parameter does not match the registered issuer");
  if (q.get("error")) {
    const e = String(q.get("error")).slice(0, 60);
    await count(env, "failed", { idp: idpId, client: tx.client_id, code: `upstream_${e}` });
    // Pass the provider's standard errors through (prompt=none answers,
    // a cancelled sign-in); anything else becomes access_denied.
    const pass = ["login_required", "interaction_required", "consent_required", "account_selection_required", "access_denied", "temporarily_unavailable"];
    return redirect(rpError(env, tx, pass.includes(e) ? e : "access_denied", `roamid:upstream_error ${e}`));
  }
  const code = q.get("code");
  if (!code || code.length > 2048) return fail("upstream_bad_response", "no authorization code");
  let upstream;
  try {
    upstream = await completeLogin(env, idp, tx, code);
  } catch (e) {
    return fail(e instanceof UpstreamError ? e.code : "server_error", e.message);
  }
  const domains = await authoritativeDomains(env, idp);
  const claims = normalize(idp, upstream, domains);
  const sub = await subjectFor(idp.id, upstream.sub, client, client.subject_type === "pairwise" ? sectorOf(client) : null);
  const t0 = now();
  const full = { sub, idp: idp.id, idp_name: idp.name.en, ...claims, auth_time: claims.auth_time || t0 };
  const ourCode = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO codes (code_hash, client_id, redirect_uri, code_challenge, nonce, scope, idp, claims, auth_time, expires)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(await sha256b64url(ourCode), tx.client_id, tx.redirect_uri, tx.code_challenge, tx.nonce, tx.scope, idp.id, JSON.stringify(full), full.auth_time, t0 + CODE_TTL).run();
  await count(env, "completed", { idp: idp.id, client: tx.client_id });
  return redirect(rpRedirect(env, tx.redirect_uri, { code: ourCode, state: tx.state }));
}

// ---- /token ----------------------------------------------------------------

function tokenError(error, description, status = 400, headers = {}) {
  return json({ error, error_description: description }, { status, cors: true, headers: { Pragma: "no-cache", ...headers } });
}

// Authenticate the client with its registered method. Returns { client } or { error }.
async function authenticateClient(request, env, reg, form) {
  const authz = request.headers.get("Authorization") || "";
  let method, clientId, secret;
  if (/^Basic /i.test(authz)) {
    let dec;
    try { dec = atob(authz.slice(6).trim()); } catch { return { error: tokenError("invalid_client", "malformed Basic credentials", 401, { "WWW-Authenticate": 'Basic realm="roamid"' }) }; }
    const i = dec.indexOf(":");
    if (i < 0) return { error: tokenError("invalid_client", "malformed Basic credentials", 401, { "WWW-Authenticate": 'Basic realm="roamid"' }) };
    const un = (s) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return null; } };
    clientId = un(dec.slice(0, i)); secret = un(dec.slice(i + 1)); method = "client_secret_basic";
    if (form.get("client_secret") || form.get("client_assertion")) return { error: tokenError("invalid_request", "more than one client authentication method") };
  } else if (form.get("client_assertion_type") || form.get("client_assertion")) {
    if (form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return { error: tokenError("invalid_client", "unsupported client_assertion_type", 401) };
    method = "private_key_jwt";
    try { clientId = decode(form.get("client_assertion")).payload.iss; } catch { return { error: tokenError("invalid_client", "malformed client_assertion", 401) }; }
    if (form.get("client_id") && form.get("client_id") !== clientId) return { error: tokenError("invalid_client", "client_id does not match the assertion", 401) };
    if (form.get("client_secret")) return { error: tokenError("invalid_request", "more than one client authentication method") };
  } else if (form.get("client_secret")) {
    method = "client_secret_post"; clientId = form.get("client_id"); secret = form.get("client_secret");
  } else {
    method = "none"; clientId = form.get("client_id");
  }
  const client = activeClient(reg, clientId);
  if (!client) return { error: tokenError("invalid_client", "unknown or disabled client", 401) };
  if (client.token_endpoint_auth_method !== method) return { error: tokenError("invalid_client", `this client authenticates with ${client.token_endpoint_auth_method}`, 401) };
  if (method === "client_secret_basic" || method === "client_secret_post") {
    if (!secret || !safeEqual(await sha256hex(secret), client.client_secret_sha256)) return { error: tokenError("invalid_client", "client authentication failed", 401, method === "client_secret_basic" ? { "WWW-Authenticate": 'Basic realm="roamid"' } : {}) };
  }
  if (method === "private_key_jwt") {
    const err = await checkAssertion(env, client, form.get("client_assertion"));
    if (err) return { error: tokenError("invalid_client", err, 401) };
  }
  return { client };
}

async function checkAssertion(env, client, assertion) {
  let payload;
  try {
    ({ payload } = await verifyWithJwks(assertion, client.jwks_uri, ["RS256", "PS256", "ES256"]));
  } catch (e) { return `client_assertion: ${e.message}`; }
  const t0 = now();
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== client.client_id || payload.sub !== client.client_id) return "client_assertion: iss and sub must be the client_id";
  if (!aud.includes(`${env.BASE_URL}/token`) && !aud.includes(env.BASE_URL)) return "client_assertion: aud must be the issuer or the token endpoint";
  if (typeof payload.exp !== "number" || payload.exp < t0 - 30) return "client_assertion: expired";
  if (payload.exp > t0 + 600) return "client_assertion: lifetime longer than 10 minutes";
  if (typeof payload.jti !== "string" || !payload.jti || payload.jti.length > 200) return "client_assertion: jti required";
  const r = await env.DB.prepare("INSERT INTO jti (k, expires) VALUES (?, ?) ON CONFLICT(k) DO NOTHING")
    .bind(await sha256b64url(`${client.client_id}|${payload.jti}`), payload.exp + 60).run();
  if (!r.meta || r.meta.changes !== 1) return "client_assertion: jti already used";
  return null;
}

export async function token(request, env) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "POST") return tokenError("invalid_request", "use POST", 405);
  if (!(await allow(env, "token", await clientIp(request, env)))) return tokenError("slow_down", "rate limited", 429, { "Retry-After": "60" });
  const form = await readForm(request);
  if (!form) return tokenError("invalid_request", "body must be application/x-www-form-urlencoded");
  for (const k of ["grant_type", "code", "redirect_uri", "code_verifier", "client_id"]) if (form.getAll(k).length > 1) return tokenError("invalid_request", `${k} repeated`);
  const reg = await getRegistry(env);
  const auth = await authenticateClient(request, env, reg, form);
  if (auth.error) return auth.error;
  const client = auth.client;
  if (!(await allow(env, "client", client.client_id))) return tokenError("slow_down", "rate limited", 429, { "Retry-After": "60" });
  if (form.get("grant_type") !== "authorization_code") return tokenError("unsupported_grant_type", "only authorization_code is supported");
  const code = form.get("code") || "";
  const codeHash = await sha256b64url(code);
  const row = await env.DB.prepare("SELECT * FROM codes WHERE code_hash = ?").bind(codeHash).first();
  if (!row || row.client_id !== client.client_id) return tokenError("invalid_grant", "unknown authorization code");
  if (row.used) {
    // Replay (RFC 6749 section 4.1.2): revoke what the first use issued.
    if (row.token_hash) await env.DB.prepare("DELETE FROM tokens WHERE token_hash = ?").bind(row.token_hash).run();
    await count(env, "failed", { idp: row.idp, client: client.client_id, code: "code_replay" });
    return tokenError("invalid_grant", "authorization code already used");
  }
  if (row.expires <= now()) return tokenError("invalid_grant", "authorization code expired");
  if (row.redirect_uri !== form.get("redirect_uri")) return tokenError("invalid_grant", "redirect_uri does not match the authorization request");
  if (row.code_challenge) {
    const v = form.get("code_verifier") || "";
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(v) || !safeEqual(await sha256b64url(v), row.code_challenge)) return tokenError("invalid_grant", "PKCE verification failed");
  } else if (form.get("code_verifier")) {
    return tokenError("invalid_grant", "code_verifier sent but no code_challenge was used");
  }
  const accessToken = randomToken(32);
  const atHash = await sha256b64url(accessToken);
  const claim = await env.DB.prepare("UPDATE codes SET used = 1, token_hash = ?, claims = '{}' WHERE code_hash = ? AND used = 0").bind(atHash, codeHash).run();
  if (!claim.meta || claim.meta.changes !== 1) return tokenError("invalid_grant", "authorization code already used");
  const claims = JSON.parse(row.claims);
  const scoped = scopeClaims(claims, row.scope);
  const t0 = now();
  await env.DB.prepare("INSERT INTO tokens (token_hash, client_id, claims, scope, expires) VALUES (?, ?, ?, ?, ?)")
    .bind(atHash, client.client_id, JSON.stringify(scoped), row.scope, t0 + TOKEN_TTL).run();
  const { signer } = await signingKeys(env);
  const half = (await sha256(accessToken)).slice(0, 16);
  const idToken = await sign({
    iss: env.BASE_URL, aud: client.client_id, azp: client.client_id, iat: t0, exp: t0 + TOKEN_TTL,
    ...(row.nonce ? { nonce: row.nonce } : {}), at_hash: b64url(half), ...scoped,
  }, signer);
  return json({ access_token: accessToken, token_type: "Bearer", expires_in: TOKEN_TTL, id_token: idToken, scope: row.scope },
    { cors: true, headers: { Pragma: "no-cache" } });
}

// The claims a scope releases. sub, idp, idp_name and auth_time always.
export function scopeClaims(claims, scope) {
  const s = String(scope).split(" ");
  const out = { sub: claims.sub, idp: claims.idp, idp_name: claims.idp_name, auth_time: claims.auth_time };
  if (claims.acr) out.acr = claims.acr;
  if (s.includes("email")) for (const k of ["email", "email_verified", "email_authority"]) if (claims[k] !== undefined) out[k] = claims[k];
  if (s.includes("profile")) for (const k of ["name", "preferred_username", "picture"]) if (claims[k] !== undefined) out[k] = claims[k];
  return out;
}

// ---- /userinfo -------------------------------------------------------------

export async function userinfo(request, env) {
  if (request.method === "OPTIONS") return corsPreflight();
  const bad = (desc) => json({ error: "invalid_token", error_description: desc }, { status: 401, cors: true, headers: { "WWW-Authenticate": `Bearer error="invalid_token", error_description="${desc}"` } });
  if (!(await allow(env, "userinfo", await clientIp(request, env)))) return json({ error: "slow_down" }, { status: 429, cors: true, headers: { "Retry-After": "60" } });
  let tok = null;
  const authz = request.headers.get("Authorization") || "";
  if (/^Bearer /i.test(authz)) tok = authz.slice(7).trim();
  else if (request.method === "POST") { const f = await readForm(request); tok = f && f.get("access_token"); }
  if (!tok) return json({ error: "invalid_request" }, { status: 401, cors: true, headers: { "WWW-Authenticate": 'Bearer realm="roamid"' } });
  const row = await env.DB.prepare("SELECT claims, expires FROM tokens WHERE token_hash = ?").bind(await sha256b64url(tok)).first();
  if (!row || row.expires <= now()) return bad("token is invalid or expired");
  const c = JSON.parse(row.claims);
  delete c.auth_time;
  return json(c, { cors: true });
}

// ---- /logout ---------------------------------------------------------------

// RP-initiated logout. RoamID keeps no session: it forgets the remembered
// IdP choice and the browser binding, then returns to the application when
// post_logout_redirect_uri is registered for it.
export async function logout(request, env) {
  const q = request.method === "POST" ? (await readForm(request)) || new URLSearchParams() : new URL(request.url).searchParams;
  const cookies = [cookie(LAST_COOKIE, "", { maxAge: 0 }), cookie(BINDING_COOKIE, "", { maxAge: 0 })];
  const reg = await getRegistry(env);
  let clientId = q.get("client_id");
  const hint = q.get("id_token_hint");
  if (hint) {
    try {
      const { jwks } = await signingKeys(env);
      const { payload } = await verify(hint, jwks.keys, ["ES256"]);
      if (payload.iss !== env.BASE_URL) throw new Error("iss");
      const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
      if (clientId && clientId !== aud) clientId = null; else clientId = aud;
    } catch { clientId = null; }
  }
  const client = activeClient(reg, clientId);
  const plr = q.get("post_logout_redirect_uri");
  if (plr && client && (client.post_logout_redirect_uris || []).includes(plr)) {
    const u = new URL(plr);
    if (q.get("state")) u.searchParams.set("state", q.get("state"));
    return redirect(u.toString(), { cookies });
  }
  const v = view(request, { uiLocales: q.get("ui_locales") });
  return html(messagePage({ ...v, title: t(v.lang, "out_title"), lead: t(v.lang, "out_lead") }), { nonce: v.nonce, cookies });
}
