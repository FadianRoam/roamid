#!/usr/bin/env node
// Scripted conformance checks against a running instance, modelled on the
// OpenID Foundation "Basic OP" and "Config OP" test plans (the requirements
// those plans test that apply to RoamID's profile: code flow, PKCE, query
// response mode). Results are printed as a Markdown table.
//
//   node scripts/conformance.mjs [--base https://id.fadianro.am] [--code-from <cmd>]
//
// Part 1 needs nothing. Part 2 needs one authorization code for the demo
// client: set CODE, CODE_VERIFIER and NONCE (the values of one completed
// sign-in at /demo, e.g. from a browser automation), and the token-level
// checks run as well.
import { createPublicKey, verify as cverify, createHash } from "node:crypto";

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : process.env.BASE) || "https://id.fadianro.am";
const CLIENT = "roamid-demo", RU = `${BASE}/demo/callback`;
const rows = [];
const check = (id, ok, detail = "") => { rows.push([id, ok ? "pass" : "FAIL", String(detail).replace(/\|/g, "/").slice(0, 140)]); };
const get = (path, init = {}) => fetch(path.startsWith("http") ? path : BASE + path, { redirect: "manual", ...init });
const authz = (params) => `/authorize?${new URLSearchParams({ client_id: CLIENT, redirect_uri: RU, response_type: "code", scope: "openid", state: "cs-1", code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256", ...params })}`;
const loc = (r) => { try { return new URL(r.headers.get("location"), BASE); } catch { return null; } };

// ---- Part 1: discovery, keys, endpoints, authorization errors ----
const d = await (await get("/.well-known/openid-configuration")).json();
check("config: issuer equals the base URL", d.issuer === BASE, d.issuer);
for (const k of ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"]) check(`config: ${k} is https on the issuer`, String(d[k]).startsWith(`${BASE}/`), d[k]);
check("config: response_types_supported = [code]", JSON.stringify(d.response_types_supported) === '["code"]');
check("config: subject_types_supported has public", (d.subject_types_supported || []).includes("public"));
check("config: id_token_signing_alg_values_supported has ES256, no none", d.id_token_signing_alg_values_supported.includes("ES256") && !d.id_token_signing_alg_values_supported.includes("none"));
check("config: code_challenge_methods_supported = [S256]", JSON.stringify(d.code_challenge_methods_supported) === '["S256"]');
check("config: scopes_supported has openid", d.scopes_supported.includes("openid"));
check("config: authorization_response_iss_parameter_supported", d.authorization_response_iss_parameter_supported === true);
const jwks = await (await get("/jwks.json")).json();
check("keys: JWKS has EC P-256 keys with kid and no private part", jwks.keys.length > 0 && jwks.keys.every((k) => k.kty === "EC" && k.crv === "P-256" && k.kid && !k.d), jwks.keys.map((k) => k.kid).join(","));
let r = await get(authz({}).replace(`client_id=${CLIENT}`, "client_id=no-such-client"));
check("authorize: unknown client -> error page, no redirect", r.status >= 400 && !r.headers.get("location"), r.status);
r = await get(authz({ redirect_uri: "https://evil.example/cb" }));
check("authorize: unregistered redirect_uri -> error page, no redirect", r.status >= 400 && !r.headers.get("location"), r.status);
r = await get(authz({ response_type: "token" }));
let u = loc(r);
check("authorize: response_type=token -> unsupported_response_type with state and iss", u && u.searchParams.get("error") === "unsupported_response_type" && u.searchParams.get("state") === "cs-1" && u.searchParams.get("iss") === BASE, u && u.search);
r = await get(authz({ scope: "email" }));
u = loc(r);
check("authorize: scope without openid -> invalid_scope", u && u.searchParams.get("error") === "invalid_scope", u && u.search);
r = await get(authz({ request: "eyJhbGciOiJub25lIn0.e30." }));
u = loc(r);
check("authorize: request object -> request_not_supported", u && u.searchParams.get("error") === "request_not_supported", u && u.search);
r = await get(authz({ code_challenge: "", code_challenge_method: "" }));
u = loc(r);
check("authorize: public client without PKCE -> invalid_request", u && u.searchParams.get("error") === "invalid_request", u && u.search);
r = await get(authz({ code_challenge_method: "plain" }));
u = loc(r);
check("authorize: PKCE plain -> invalid_request", u && u.searchParams.get("error") === "invalid_request", u && u.search);
r = await get(authz({ prompt: "none" }));
u = loc(r);
check("authorize: prompt=none without a choice -> interaction_required", u && u.searchParams.get("error") === "interaction_required", u && u.search);
r = await get(`${authz({})}&state=again`);
u = loc(r);
check("authorize: a repeated parameter -> invalid_request", u && u.searchParams.get("error") === "invalid_request", u && u.search);
r = await get(authz({ response_mode: "form_post" }));
u = loc(r);
check("authorize: response_mode=form_post -> invalid_request", u && u.searchParams.get("error") === "invalid_request", u && u.search);
r = await get(authz({}));
check("authorize: a valid request reaches the picker", r.status === 303 && /\/select\?tx=/.test(r.headers.get("location") || ""), r.headers.get("location"));
r = await get("/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: "not-a-code", redirect_uri: RU, client_id: CLIENT, code_verifier: "x".repeat(43) }) });
let j = await r.json();
check("token: unknown code -> 400 invalid_grant, no-store", r.status === 400 && j.error === "invalid_grant" && /no-store/.test(r.headers.get("cache-control")), `${r.status} ${j.error}`);
r = await get("/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: CLIENT }) });
j = await r.json();
check("token: grant_type=password -> unsupported_grant_type", j.error === "unsupported_grant_type", j.error);
r = await get("/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa("roamid-demo:wrong") }, body: new URLSearchParams({ grant_type: "authorization_code", code: "x" }) });
check("token: wrong client authentication -> 401 invalid_client", r.status === 401 && (await r.json()).error === "invalid_client", r.status);
r = await get("/userinfo");
check("userinfo: no token -> 401 with WWW-Authenticate", r.status === 401 && /Bearer/.test(r.headers.get("www-authenticate") || ""), r.status);
r = await get("/userinfo", { headers: { Authorization: "Bearer not-a-token" } });
check("userinfo: invalid token -> 401 invalid_token", r.status === 401 && /invalid_token/.test(r.headers.get("www-authenticate") || ""), r.status);
r = await get("/token", { method: "OPTIONS" });
check("CORS: token endpoint answers preflight", r.status === 204 && r.headers.get("access-control-allow-origin") === "*", r.status);

// ---- Part 2: with one authorization code (CODE, CODE_VERIFIER, NONCE) ----
if (process.env.CODE) {
  const ex = async (o = {}) => get("/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: process.env.CODE, redirect_uri: RU, client_id: CLIENT, code_verifier: process.env.CODE_VERIFIER, ...o }) });
  r = await ex({ code_verifier: "w".repeat(43) });
  check("token: wrong code_verifier -> invalid_grant", (await r.json()).error === "invalid_grant");
  r = await ex();
  j = await r.json();
  check("token: code + verifier -> tokens, Bearer, no-store", r.status === 200 && j.token_type === "Bearer" && j.id_token && /no-store/.test(r.headers.get("cache-control")), r.status);
  const [h, p, s] = j.id_token.split(".");
  const hdr = JSON.parse(Buffer.from(h, "base64url")), c = JSON.parse(Buffer.from(p, "base64url"));
  const key = jwks.keys.find((k) => k.kid === hdr.kid);
  const sigOk = !!key && cverify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  check("id_token: ES256 signature verifies with the JWKS key named by kid", hdr.alg === "ES256" && sigOk, hdr.kid);
  const t = Math.floor(Date.now() / 1000);
  check("id_token: iss, aud, azp", c.iss === BASE && c.aud === CLIENT && c.azp === CLIENT);
  check("id_token: iat and exp", c.iat <= t + 5 && c.exp > t && c.exp - c.iat <= 3600, `${c.iat} ${c.exp}`);
  check("id_token: nonce echoed", c.nonce === process.env.NONCE);
  const half = createHash("sha256").update(j.access_token).digest().subarray(0, 16).toString("base64url");
  check("id_token: at_hash matches the access token", c.at_hash === half);
  check("id_token: sub, auth_time, idp", typeof c.sub === "string" && c.sub.length > 0 && Number.isInteger(c.auth_time) && !!c.idp);
  r = await get("/userinfo", { headers: { Authorization: `Bearer ${j.access_token}` } });
  const ui = await r.json();
  check("userinfo: sub equals the ID token sub", r.status === 200 && ui.sub === c.sub);
  r = await ex();
  check("token: the code is single use (second use invalid_grant)", (await r.json()).error === "invalid_grant");
  r = await get("/userinfo", { headers: { Authorization: `Bearer ${j.access_token}` } });
  check("token: reuse of the code revokes the access token issued from it", r.status === 401, r.status);
}

const failed = rows.filter((x) => x[1] !== "pass").length;
console.log(`| Check | Result | Detail |\n|---|---|---|\n${rows.map((x) => `| ${x.join(" | ")} |`).join("\n")}\n\n${rows.length - failed}/${rows.length} passed (${BASE}, ${new Date().toISOString().slice(0, 16)}Z)`);
process.exit(failed ? 1 : 0);
