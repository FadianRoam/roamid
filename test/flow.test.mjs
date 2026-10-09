// End-to-end flows through the Worker with a mock upstream IdP and mock RPs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, login, exchange, pkce, clientEntry, idpEntry, assertion, BASE, sha256b64url, sha256hex } from "./_harness.mjs";
import { verify } from "../src/lib/jwt.js";

async function jwks(h) { return (await (await h.request("/jwks.json")).json()).keys; }

test("happy path: public client with PKCE, picker, upstream login, token, userinfo", async () => {
  const h = await setup();
  const pk = await pkce();
  const r = await login(h, { pk });
  assert.equal(r.picker.status, 200);
  const page = await r.picker.text();
  assert.match(page, /IdP good/);
  assert.match(r.picker.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  const up = new URL(r.upstream);
  assert.equal(up.searchParams.get("code_challenge_method"), "S256");
  assert.equal(up.searchParams.get("response_mode"), "query");
  assert.equal(up.searchParams.get("redirect_uri"), `${BASE}/callback/good`);
  assert.ok(r.code, "code returned to the RP");
  assert.equal(r.state, "st-1");
  assert.equal(r.iss, BASE);
  const { res, body } = await exchange(h, { code: r.code, verifier: pk.verifier });
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const { payload, header } = await verify(body.id_token, await jwks(h), ["RS256"]);
  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, BASE);
  assert.equal(payload.aud, "spa");
  assert.equal(payload.nonce, "n-1");
  assert.equal(payload.idp, "good");
  assert.equal(payload.sub, await sha256b64url("good|user-1"));
  assert.equal(payload.email, "lemon@lab.example.org");
  assert.equal(payload.name, "Lemon");
  assert.ok(!JSON.stringify(payload).includes("user-1"), "the upstream sub is never passed through");
  const ui = await h.request("/userinfo", { headers: { Authorization: `Bearer ${body.access_token}` }, cookies: false });
  assert.equal(ui.status, 200);
  assert.equal((await ui.json()).sub, payload.sub);
  // remembered choice: the next picker lists it under "Last used"
  const again = await login(h, { pk: await pkce(), pick: false });
  assert.match(await again.picker.text(), /Last used/);
});

test("PKCE: a public client must send S256, and a wrong verifier fails", async () => {
  const h = await setup();
  const noPk = await h.request(`/authorize?${new URLSearchParams({ response_type: "code", client_id: "spa", redirect_uri: "https://rp.example.test/spa/cb", scope: "openid", state: "s" })}`);
  assert.equal(noPk.status, 302);
  const loc = new URL(noPk.headers.get("Location"));
  assert.equal(loc.searchParams.get("error"), "invalid_request");
  assert.equal(loc.searchParams.get("state"), "s");
  const plain = await h.request(`/authorize?${new URLSearchParams({ response_type: "code", client_id: "spa", redirect_uri: "https://rp.example.test/spa/cb", scope: "openid", code_challenge: "a".repeat(43), code_challenge_method: "plain" })}`);
  assert.equal(new URL(plain.headers.get("Location")).searchParams.get("error"), "invalid_request");
  const pk = await pkce();
  const r = await login(h, { pk });
  const bad = await exchange(h, { code: r.code, verifier: (await pkce()).verifier });
  assert.equal(bad.res.status, 400);
  assert.equal(bad.body.error, "invalid_grant");
  const none = await exchange(h, { code: r.code });
  assert.equal(none.body.error, "invalid_grant");
});

test("redirect_uri must match exactly, at /authorize and at /token", async () => {
  const h = await setup();
  for (const ru of ["https://rp.example.test/spa/cb/", "https://rp.example.test/spa/cb?x=1", "https://evil.example.test/spa/cb", "https://rp.example.test/SPA/cb"]) {
    const res = await h.request(`/authorize?${new URLSearchParams({ response_type: "code", client_id: "spa", redirect_uri: ru, scope: "openid" })}`);
    assert.equal(res.status, 400, ru);
    assert.equal(res.headers.get("Location"), null, "no redirect to an unregistered URI");
    assert.match(await res.text(), /invalid_redirect_uri/);
  }
  const h2 = await setup({ clients: [clientEntry("spa", { redirect_uris: ["https://rp.example.test/spa/cb", "https://rp.example.test/spa/cb2"] })] });
  const pk = await pkce();
  const r = await login(h2, { pk });
  const x = await exchange(h2, { code: r.code, verifier: pk.verifier, redirectUri: "https://rp.example.test/spa/cb2" });
  assert.equal(x.body.error, "invalid_grant");
});

test("IdP mix-up: wrong iss in the ID token, iss parameter, or another IdP's callback path", async () => {
  const h = await setup({ idps: { good: "idp.example.test", evil: "evil.example.test" } });
  h.idps.good.tamper = { iss: h.idps.evil.issuer };
  const r = await login(h, { pk: await pkce() });
  assert.equal(r.callback.status, 400);
  assert.match(await r.callback.text(), /upstream_id_token_invalid/);
  h.idps.good.tamper = {};
  const r2 = await login(h, { pk: await pkce(), beforeCallback: (cb) => { const u = new URL(cb); u.searchParams.set("iss", h.idps.evil.issuer); return u.toString(); } });
  assert.match(await r2.callback.text(), /upstream_issuer_mismatch/);
  // a code for "good" delivered to /callback/evil
  const r3 = await login(h, { pk: await pkce(), beforeCallback: (cb) => cb.replace("/callback/good", "/callback/evil") });
  assert.equal(r3.callback.status, 400);
  assert.match(await r3.callback.text(), /upstream_issuer_mismatch/);
  assert.ok(!r3.code);
});

test("nonce mismatch in the upstream ID token is refused", async () => {
  const h = await setup();
  h.idps.good.tamper = { nonce: "other" };
  const r = await login(h, { pk: await pkce() });
  assert.equal(r.callback.status, 400);
  const page = await r.callback.text();
  assert.match(page, /upstream_id_token_invalid/);
  assert.match(page, /nonce mismatch/);
  // the error page offers the way back to the RP with a standard error
  assert.match(page, /error=server_error/);
});

test("code replay: the second use fails and revokes the first access token", async () => {
  const h = await setup();
  const pk = await pkce();
  const r = await login(h, { pk });
  const a = await exchange(h, { code: r.code, verifier: pk.verifier });
  assert.equal(a.res.status, 200);
  const b = await exchange(h, { code: r.code, verifier: pk.verifier });
  assert.equal(b.body.error, "invalid_grant");
  const ui = await h.request("/userinfo", { headers: { Authorization: `Bearer ${a.body.access_token}` }, cookies: false });
  assert.equal(ui.status, 401);
  const row = await h.db.prepare("SELECT claims FROM codes").first();
  assert.equal(row.claims, "{}", "no claims are kept on a used code");
});

test("expiry: transaction, code and access token", async () => {
  const h = await setup();
  const pk = await pkce();
  const r = await login(h, { pk, pick: false });
  await h.db.prepare("UPDATE tx SET expires = 1").run();
  const tx = new URL(BASE + r.authorize.headers.get("Location")).searchParams.get("tx");
  const sel = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp: "good" }).toString() });
  assert.match(await sel.text(), /tx_expired/);
  const r2 = await login(h, { pk });
  await h.db.prepare("UPDATE codes SET expires = 1").run();
  assert.equal((await exchange(h, { code: r2.code, verifier: pk.verifier })).body.error, "invalid_grant");
  const r3 = await login(h, { pk });
  const ok = await exchange(h, { code: r3.code, verifier: pk.verifier });
  await h.db.prepare("UPDATE tokens SET expires = 1").run();
  assert.equal((await h.request("/userinfo", { headers: { Authorization: `Bearer ${ok.body.access_token}` }, cookies: false })).status, 401);
  // the cron removes what expired
  await h.sync();
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM tokens").first()).n, 0);
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM tx").first()).n, 0);
});

test("pairwise sub: per sector, stable, different from the public sub", async () => {
  const pw = clientEntry("pw", { subject_type: "pairwise", redirect_uris: ["https://other.example.test/pw/cb"] });
  const h = await setup({ clients: [clientEntry("spa"), pw] });
  const subOf = async (client, ru) => {
    const pk = await pkce();
    const r = await login(h, { client, pk, redirectUri: ru });
    const x = await exchange(h, { client, code: r.code, verifier: pk.verifier, redirectUri: ru });
    return x.body.id_token && JSON.parse(Buffer.from(x.body.id_token.split(".")[1], "base64url")).sub;
  };
  const pub = await subOf("spa");
  const p1 = await subOf("pw", "https://other.example.test/pw/cb");
  const p2 = await subOf("pw", "https://other.example.test/pw/cb");
  assert.equal(pub, await sha256b64url("good|user-1"));
  assert.equal(p1, await sha256b64url("other.example.test|good|user-1"));
  assert.equal(p1, p2);
  assert.notEqual(p1, pub);
});

test("the public /idps page lists active identity providers only", async () => {
  const h = await setup({ idps: { good: "idp.example.test", off: "off.example.test" } });
  h.registry.idps[1].status = "disabled";
  const page = await (await h.request("/idps")).text();
  assert.match(page, /IdP good/);
  assert.doesNotMatch(page, /IdP off/);
});

test("a disabled IdP is not offered and cannot be chosen", async () => {
  const h = await setup({ idps: { good: "idp.example.test", off: "off.example.test" } });
  h.registry.idps[1].status = "disabled";
  const r = await login(h, { pk: await pkce(), pick: false });
  const page = await r.picker.text();
  assert.match(page, /IdP good/);
  assert.doesNotMatch(page, /IdP off/);
  const tx = new URL(BASE + r.authorize.headers.get("Location")).searchParams.get("tx");
  const sel = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp: "off" }).toString() });
  assert.match(await sel.text(), /idp_disabled/);
  const hint = await login(h, { pk: await pkce(), params: { idp_hint: "off" }, pick: false });
  assert.equal(hint.authorize.status, 303);
  assert.match(hint.authorize.headers.get("Location"), /^\/select/, "a disabled idp_hint falls back to the picker");
  const ok = await login(h, { pk: await pkce(), params: { idp_hint: "good" } });
  assert.ok(ok.code, "idp_hint skips the picker");
});

test("an invalid registry entry is dropped, the others stay", async () => {
  const h = await setup({ idps: { good: "idp.example.test", bad: "bad.example.test" } });
  h.registry.idps[1].issuer = "http://bad.example.test"; // not https
  h.registry.clients.push({ ...clientEntry("broken"), redirect_uris: ["https://rp.example.test/*"] });
  await h.sync();
  const s = await (await h.request("/status.json")).json();
  assert.equal(s.registry.idps, 1);
  assert.equal(s.registry.clients, 1);
  assert.deepEqual(s.registry.dropped.map((d) => `${d.kind}/${d.id}`).sort(), ["client/broken", "idp/bad"]);
  assert.ok((await login(h, { pk: await pkce() })).code);
  // a later fetch failure keeps the last good copy
  h.registry = "garbage";
  await h.sync();
  const s2 = await (await h.request("/status.json")).json();
  assert.equal(s2.registry.idps, 1);
  assert.match(s2.registry.last_error, /registry fetch/);
});

test("confidential clients: client_secret_basic, client_secret_post, private_key_jwt with jti replay", async () => {
  const secret = "s".repeat(43);
  const h = await setup({ clients: [
    clientEntry("basic", { token_endpoint_auth_method: "client_secret_basic", client_secret_sha256: await sha256hex(secret) }),
    clientEntry("post", { token_endpoint_auth_method: "client_secret_post", client_secret_sha256: await sha256hex(secret) }),
    clientEntry("pkjwt", { token_endpoint_auth_method: "private_key_jwt", jwks_uri: "https://rp.example.test/jwks" }),
  ] });
  let r = await login(h, { client: "basic" });
  assert.equal((await exchange(h, { client: "basic", code: r.code, auth: { basic: "wrong" } })).res.status, 401);
  assert.equal((await exchange(h, { client: "basic", code: r.code, auth: { basic: secret } })).res.status, 200);
  r = await login(h, { client: "post" });
  assert.equal((await exchange(h, { client: "post", code: r.code, auth: { basic: secret } })).body.error, "invalid_client", "wrong method");
  assert.equal((await exchange(h, { client: "post", code: r.code, auth: { form: { client_id: "post", client_secret: secret } } })).res.status, 200);
  r = await login(h, { client: "pkjwt" });
  const a = await assertion(h, "pkjwt");
  const form = { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: a };
  assert.equal((await exchange(h, { client: "pkjwt", code: r.code, auth: { form } })).res.status, 200);
  r = await login(h, { client: "pkjwt" });
  const again = await exchange(h, { client: "pkjwt", code: r.code, auth: { form } });
  assert.equal(again.body.error, "invalid_client");
  assert.match(again.body.error_description, /jti already used/);
  const wrongAud = await exchange(h, { client: "pkjwt", code: r.code, auth: { form: { ...form, client_assertion: await assertion(h, "pkjwt", { aud: "https://other.example.test/token" }) } } });
  assert.match(wrongAud.body.error_description, /aud/);
});

test("browser binding: a transaction only continues in the browser that started it", async () => {
  const h = await setup();
  const r = await login(h, { pk: await pkce(), pick: false });
  const tx = new URL(BASE + r.authorize.headers.get("Location")).searchParams.get("tx");
  h.cookies.clear();
  const sel = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp: "good" }).toString() });
  assert.match(await sel.text(), /tx_browser/);
});

test("prompt=none: interaction_required without a choice, passed upstream with one", async () => {
  const h = await setup();
  const pk = await pkce();
  const r = await h.request(`/authorize?${new URLSearchParams({ response_type: "code", client_id: "spa", redirect_uri: "https://rp.example.test/spa/cb", scope: "openid", state: "s", prompt: "none", code_challenge: pk.challenge, code_challenge_method: "S256" })}`);
  assert.equal(new URL(r.headers.get("Location")).searchParams.get("error"), "interaction_required");
  const r2 = await login(h, { pk, params: { prompt: "none", idp_hint: "good", max_age: "0" } });
  const up = new URL(r2.upstream);
  assert.equal(up.searchParams.get("prompt"), "none");
  assert.equal(up.searchParams.get("max_age"), "0");
  // an upstream login_required comes back to the RP as login_required
  const r3 = await login(h, { pk, params: { prompt: "none", idp_hint: "good" }, beforeCallback: (cb) => { const u = new URL(cb); u.searchParams.delete("code"); u.searchParams.set("error", "login_required"); return u.toString(); } });
  assert.equal(new URL(r3.callback.headers.get("Location")).searchParams.get("error"), "login_required");
});

test("logout returns only to a registered post_logout_redirect_uri", async () => {
  const h = await setup();
  const ok = await h.request("/logout?client_id=spa&post_logout_redirect_uri=" + encodeURIComponent("https://rp.example.test/spa/bye") + "&state=x");
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("Location"), "https://rp.example.test/spa/bye?state=x");
  const bad = await h.request("/logout?client_id=spa&post_logout_redirect_uri=" + encodeURIComponent("https://evil.example.test/"));
  assert.equal(bad.status, 200);
  assert.equal(bad.headers.get("Location"), null);
});

test("discovery document and public pages", async () => {
  const h = await setup();
  const d = await (await h.request("/.well-known/openid-configuration")).json();
  assert.equal(d.issuer, BASE);
  assert.deepEqual(d.code_challenge_methods_supported, ["S256"]);
  assert.equal(d.request_uri_parameter_supported, false);
  for (const p of ["/", "/idps", "/status", "/demo"]) {
    const res = await h.request(p, { headers: { "Accept-Language": "zh-CN,zh;q=0.9" } });
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get("Cache-Control"), /^no-store/, p);
    assert.match(await res.text(), /lang="zh-CN"/, p);
  }
  const dark = await h.request("/prefs?theme=dark&next=/idps");
  assert.equal(dark.headers.get("Location"), "/idps");
  assert.match(await (await h.request("/idps")).text(), /data-theme="dark"/);
  assert.equal((await h.request("/prefs?lang=en&next=//evil.example.test")).headers.get("Location"), "/");
  const idps = await (await h.request("/idps.json")).json();
  assert.equal(idps.idps[0].id, "good");
});

test("admin sync needs the token", async () => {
  const h = await setup();
  assert.equal((await h.request("/admin/sync", { method: "POST" })).status, 401);
  const ok = await h.request("/admin/sync", { method: "POST", headers: { Authorization: "Bearer admin-token-0123456789" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).commit, "a".repeat(40));
});

test("logos: the sync downloads, re-checks and serves them with fixed headers; a tampered file is dropped", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const png = readFileSync(new URL("./fixtures/logos/valid.png", import.meta.url));
  const sha = createHash("sha256").update(png).digest("hex");
  const h = await setup({ idps: { good: "idp.example.test", other: "idp2.example.test" } });
  const path = `good.${sha.slice(0, 8)}.png`;
  h.registry.idps[0].logo = { path, sha256: sha, type: "image/png", width: 128, height: 128 };
  h.files[`/${path}`] = png;
  // "other" names a logo whose bytes do not match (a different file at that path).
  const webp = readFileSync(new URL("./fixtures/logos/valid.webp", import.meta.url));
  const opath = `other.${sha.slice(0, 8)}.png`;
  h.registry.idps[1].logo = { path: opath, sha256: sha, type: "image/png", width: 128, height: 128 };
  h.files[`/${opath}`] = webp;
  await h.request("/admin/sync", { method: "POST", headers: { Authorization: "Bearer admin-token-0123456789" } });
  const r = await h.request(`/logos/${path}`);
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(r.headers.get("content-security-policy"), "default-src 'none'");
  assert.equal(r.headers.get("content-disposition"), "inline");
  const bad = await h.request(`/logos/${opath}`);
  assert.equal(bad.status, 404, "a logo whose bytes do not match registry.json is not stored");
  assert.equal(bad.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await h.request("/logos/../registry.json")).status, 404);
  const idps = await (await h.request("/idps.json")).json().catch(() => null);
  if (idps) {
    const list = idps.idps || idps;
    assert.ok(list.find((i) => i.id === "good").logo, "the verified logo stays in the entry");
    assert.ok(!list.find((i) => i.id === "other").logo, "the refused logo is dropped from the entry");
  }
});
