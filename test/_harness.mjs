// A RoamID Worker with an in-memory database, mock identity providers, a
// mock registry, mock DNS and mock relying parties. All network access goes
// through a fetch router; nothing leaves the process.
import { webcrypto } from "node:crypto";
import { memoryD1 } from "./_d1.mjs";
import worker, { scheduled } from "../src/index.js";
import { resetMemo } from "../src/registry/store.js";
import { resetUpstreamCaches } from "../src/oidc/upstream.js";
import { importPrivate, sign, publicJwk } from "../src/lib/jwt.js";
import { b64url, randomToken, sha256b64url, sha256hex } from "../src/lib/b64.js";
import { SAML_KEYS } from "./_saml.mjs";

export const BASE = "https://id.example.test";
const REGISTRY_URL = "https://registry.example.test/registry.json";

async function genKey(alg, kid) {
  const params = alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const pair = await webcrypto.subtle.generateKey(params, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  delete jwk.key_ops; delete jwk.ext;
  return { ...jwk, kid, alg };
}

// A community OIDC provider. Codes are issued by `issue()`, standing in for
// the person signing in there.
export class MockIdp {
  constructor(host, { secret = "upstream-secret" } = {}) {
    this.host = host; this.issuer = `https://${host}/realms/lab`; this.secret = secret;
    this.codes = new Map(); this.user = { sub: "user-1", email: "lemon@lab.example.org", email_verified: true, name: "Lemon", preferred_username: "lemon" };
    this.tamper = {}; this.lastToken = null; this.calls = [];
  }
  async init() { this.key = await genKey("RS256", "up-1"); this.signer = await importPrivate(this.key); return this; }
  discovery() {
    const b = this.issuer;
    return { issuer: b, authorization_endpoint: `${b}/auth`, token_endpoint: `${b}/token`, userinfo_endpoint: `${b}/userinfo`, jwks_uri: `${b}/certs`,
      response_types_supported: ["code"], response_modes_supported: ["query"], code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "private_key_jwt"] };
  }
  // The provider's answer to an authorization request URL: a callback URL.
  issue(authUrl, user = this.user) {
    const u = new URL(authUrl);
    const code = randomToken(16);
    this.codes.set(code, { req: Object.fromEntries(u.searchParams), user });
    const cb = new URL(u.searchParams.get("redirect_uri"));
    cb.searchParams.set("code", code);
    cb.searchParams.set("state", u.searchParams.get("state"));
    return cb.toString();
  }
  async handle(req) {
    const u = new URL(req.url);
    this.calls.push(u.pathname);
    if (u.pathname.endsWith("/.well-known/openid-configuration")) return Response.json(this.discovery());
    if (u.pathname.endsWith("/certs")) return Response.json({ keys: [publicJwk(this.key)] });
    if (u.pathname.endsWith("/token")) {
      const f = new URLSearchParams(await req.text());
      const want = "Basic " + btoa(`roamid:${this.secret}`);
      if (req.headers.get("Authorization") !== want) return Response.json({ error: "invalid_client" }, { status: 401 });
      const c = this.codes.get(f.get("code"));
      if (!c) return Response.json({ error: "invalid_grant" }, { status: 400 });
      this.codes.delete(f.get("code"));
      if (await sha256b64url(f.get("code_verifier") || "") !== c.req.code_challenge) return Response.json({ error: "invalid_grant", error_description: "pkce" }, { status: 400 });
      if (f.get("redirect_uri") !== c.req.redirect_uri) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const t = Math.floor(Date.now() / 1000);
      const claims = { iss: this.issuer, aud: "roamid", sub: c.user.sub, iat: t, exp: t + 300, nonce: c.req.nonce, email: c.user.email, email_verified: c.user.email_verified, name: c.user.name, preferred_username: c.user.preferred_username, ...this.tamper };
      const at = randomToken(16);
      this.lastToken = { at, user: c.user };
      return Response.json({ access_token: at, token_type: "Bearer", id_token: await sign(claims, this.signer) });
    }
    if (u.pathname.endsWith("/userinfo")) {
      if (!this.lastToken || req.headers.get("Authorization") !== `Bearer ${this.lastToken.at}`) return new Response("", { status: 401 });
      const { user } = this.lastToken;
      return Response.json({ sub: user.sub, email: user.email, email_verified: user.email_verified, name: user.name, preferred_username: user.preferred_username });
    }
    return new Response("not found", { status: 404 });
  }
}

export function idpEntry(idp, id, extra = {}) {
  return { id, protocol: "oidc", name: { en: `IdP ${id}`, zh: `身份提供方 ${id}` }, issuer: idp.issuer, homepage: `https://${idp.host}/`,
    contact: { github: "example", email: "ops@example.org" }, client_id: "roamid", client_auth: "client_secret_basic",
    scopes: ["openid", "email", "profile"], status: "active", ...extra };
}

export function clientEntry(client_id, extra = {}) {
  return { client_id, protocol: "oidc", name: { en: `App ${client_id}` }, homepage: "https://rp.example.test/",
    contact: { github: "example", email: "ops@example.org" }, redirect_uris: [`https://rp.example.test/${client_id}/cb`],
    post_logout_redirect_uris: [`https://rp.example.test/${client_id}/bye`], token_endpoint_auth_method: "none", status: "active", ...extra };
}

export async function setup({ idps: idpSpecs, clients, txt = {}, registryExtra = {}, extraIdps = [] } = {}) {
  resetMemo(); resetUpstreamCaches();
  const db = memoryD1();
  const signing = await genKey("ES256", "sig-test");
  const client = await genKey("RS256", "cli-test");
  const rpKey = await genKey("ES256", "rp-1");
  const h = {
    db, rpKey, rpSigner: await importPrivate(rpKey), txt, idps: {}, net: [], files: {},
    env: { DB: db, BASE_URL: BASE, REGISTRY_URL, SIGNING_KEYS: JSON.stringify([signing]), CLIENT_KEYS: JSON.stringify([client]),
      SAML_KEYS, ADMIN_TOKEN: "admin-token-0123456789", IDP_SECRET_GOOD: "upstream-secret", IDP_SECRET_EVIL: "upstream-secret", IDP_SECRET_OFF: "upstream-secret" },
  };
  for (const [id, host] of Object.entries(idpSpecs || { good: "idp.example.test" })) h.idps[id] = await new MockIdp(host).init();
  h.registry = {
    version: 1, commit: "a".repeat(40), generated_at: new Date().toISOString(),
    idps: [...Object.entries(h.idps).map(([id, idp]) => idpEntry(idp, id)), ...extraIdps],
    clients: clients || [clientEntry("spa")],
    ...registryExtra,
  };
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    h.net.push(u.host + u.pathname);
    if (u.href.startsWith(REGISTRY_URL)) return Response.json(h.registry);
    if (u.host === "registry.example.test" && h.files[u.pathname]) return new Response(h.files[u.pathname]);
    if (u.host === "cloudflare-dns.com" || u.host === "dns.google") {
      const name = u.searchParams.get("name");
      const type = u.searchParams.get("type");
      if (type === "A" || type === "AAAA") {
        const ok = !h.unresolved.has(name);
        return Response.json({ Status: ok ? 0 : 3, Answer: ok && type === "A" ? [{ name, type: 1, data: "192.0.2.10" }] : [] });
      }
      const vals = h.txt[name] || [];
      return Response.json({ Status: vals.length ? 0 : 3, Answer: vals.map((v) => ({ name, type: 16, data: `"${v}"` })) });
    }
    if (u.host === "rp.example.test" && u.pathname === "/jwks") return Response.json({ keys: [publicJwk(rpKey)] });
    if (u.host === "hooks.example.test" && u.pathname === "/roamid") {
      h.tickets.push({ body: await req.json() });
      return Response.json({ ok: true, number: `T-${h.tickets.length}` }, { status: 201 });
    }
    if (u.pathname === "/.well-known/roamid-app.txt") {
      const body = h.wellKnown[u.host];
      return body ? new Response(body) : new Response("not found", { status: 404 });
    }
    if (u.host === "urlhaus.abuse.ch" || u.host === "raw.githubusercontent.com") return new Response(h.blocklist[u.host] || "");
    for (const idp of Object.values(h.idps)) if (u.host === idp.host) return idp.handle(req);
    return new Response("no route", { status: 599 });
  };
  h.unresolved = new Set(); h.verifyCalls = []; h.tickets = []; h.wellKnown = {}; h.blocklist = {};
  h.cookies = new Map();
  h.request = async (path, { method = "GET", body, headers = {}, cookies = true } = {}) => {
    const hdrs = new Headers(headers);
    if (cookies && h.cookies.size) hdrs.set("Cookie", [...h.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (body && !hdrs.has("Content-Type")) hdrs.set("Content-Type", "application/x-www-form-urlencoded");
    const url = path.startsWith("http") ? path : BASE + path;
    const res = await worker.fetch(new Request(url, { method, body, headers: hdrs }), h.env, { waitUntil() {} });
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const name = kv.slice(0, i).trim(), val = kv.slice(i + 1);
      if (attrs.some((a) => /max-age=0/i.test(a.trim()))) h.cookies.delete(name); else h.cookies.set(name, val);
    }
    return res;
  };
  h.sync = () => scheduled(h.env);
  return h;
}

export async function pkce() {
  const verifier = randomToken(48);
  return { verifier, challenge: await sha256b64url(verifier) };
}

// Start at /authorize, pick `idp` (or follow idp_hint), sign in upstream,
// and return the redirect back to the application.
export async function login(h, { client = "spa", idp = "good", redirectUri, pk, params = {}, user, pick = true, beforeCallback } = {}) {
  const ru = redirectUri || `https://rp.example.test/${client}/cb`;
  const q = new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: ru, scope: "openid email profile", state: "st-1", nonce: "n-1", ...params });
  if (pk) { q.set("code_challenge", pk.challenge); q.set("code_challenge_method", "S256"); }
  let res = await h.request(`/authorize?${q}`);
  const out = { authorize: res };
  if (res.status === 303 && res.headers.get("Location").startsWith("/select")) {
    const sel = res.headers.get("Location");
    out.picker = await h.request(sel);
    if (!pick) return out;
    const tx = new URL(BASE + sel).searchParams.get("tx");
    res = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp }).toString() });
    out.select = res;
  }
  if (res.status !== 303 && res.status !== 302) return { ...out, final: res };
  const upstream = res.headers.get("Location");
  out.upstream = upstream;
  if (!upstream.startsWith("https://") || upstream.startsWith(BASE)) return { ...out, final: res };
  const mock = Object.values(h.idps).find((i) => upstream.startsWith(i.issuer));
  let cb = mock.issue(upstream, user);
  if (beforeCallback) cb = await beforeCallback(cb, mock);
  res = await h.request(cb);
  out.callback = res;
  const loc = res.headers.get("Location");
  if (loc && loc.startsWith(ru)) {
    const r = new URL(loc);
    out.code = r.searchParams.get("code"); out.state = r.searchParams.get("state"); out.iss = r.searchParams.get("iss"); out.error = r.searchParams.get("error");
  }
  return out;
}

export async function exchange(h, { code, client = "spa", redirectUri, verifier, auth = {} } = {}) {
  const f = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri || `https://rp.example.test/${client}/cb`, ...(verifier ? { code_verifier: verifier } : {}), ...auth.form });
  if (!auth.form && !auth.basic) f.set("client_id", client);
  const headers = auth.basic ? { Authorization: "Basic " + btoa(`${client}:${auth.basic}`) } : {};
  const res = await h.request("/token", { method: "POST", body: f.toString(), headers, cookies: false });
  return { res, body: await res.json() };
}

export async function assertion(h, client_id, extra = {}) {
  const t = Math.floor(Date.now() / 1000);
  return sign({ iss: client_id, sub: client_id, aud: `${BASE}/token`, jti: randomToken(8), iat: t, exp: t + 60, ...extra }, h.rpSigner);
}

export { sha256b64url, sha256hex, b64url, randomToken };
