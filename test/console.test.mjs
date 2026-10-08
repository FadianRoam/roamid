// Developer console, automated application review, reports and the
// operator queue, through the Worker's real entry point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, login, exchange, BASE, sha256b64url } from "./_harness.mjs";
import { checkApp, checkName, checkUrl, skeleton, needsDevelopment } from "../src/apps/checks.js";
import { validateRegistry } from "../src/registry/validate.js";
import { clientEntry } from "./_harness.mjs";

const USERS = {
  alice: { sub: "alice-1", email: "alice@example.org", email_verified: true, name: "Alice", preferred_username: "alice" },
  bob: { sub: "bob-1", email: "bob@example.org", email_verified: true, name: "Bob", preferred_username: "bob" },
  olga: { sub: "olga-1", email: "olga@example.org", email_verified: true, name: "Olga", preferred_username: "olga" },
};
const publicSub = (u) => sha256b64url(`good|${u.sub}`);

async function consoleSetup() {
  const h = await setup();
  h.env.OPERATOR_SUBS = await publicSub(USERS.olga);
  h.env.VERIFY_SECRET = "verify-secret"; h.env.VERIFY_SITEKEY = "ovk_test";
  h.env.HELPDESK_URL = "https://helpdesk.example.test"; h.env.HELPDESK_API_KEY = "hd-key";
  await h.sync();
  return h;
}

// Sign in to the console as `user` with a fresh cookie jar.
async function consoleLogin(h, user) {
  h.cookies = new Map();
  let r = await h.request("/console/login");
  assert.equal(r.status, 303);
  const authz = r.headers.get("Location");
  r = await h.request(authz);
  const sel = r.headers.get("Location");
  const tx = new URL(BASE + sel).searchParams.get("tx");
  r = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp: "good" }).toString() });
  const cb = h.idps.good.issue(r.headers.get("Location"), user);
  r = await h.request(cb);
  const back = r.headers.get("Location");
  assert.ok(back.startsWith(`${BASE}/console/callback?`), back);
  r = await h.request(back);
  assert.equal(r.status, 303);
  assert.ok(h.cookies.has("__Host-rid_cs"), "session cookie");
  return h.cookies;
}

async function csrfOf(h, path = "/console") {
  const page = await (await h.request(path)).text();
  return /name="csrf" value="([^"]+)"/.exec(page)[1];
}

async function post(h, path, fields, csrf) {
  const b = new URLSearchParams({ csrf: csrf ?? (await csrfOf(h)), ...fields });
  return h.request(path, { method: "POST", body: b.toString(), headers: { Origin: "null", "Sec-Fetch-Site": "same-origin" } });
}

const appFields = (o = {}) => ({ name_en: "Example Portal", name_zh: "示例门户", domain: "example.org", homepage: "https://example.org/", protocol: "oidc", redirect_uris: "https://app.example.org/cb", auth_method: "client_secret_basic", subject_type: "public", ...o });

async function createApp(h, o) {
  const r = await post(h, "/console/new", appFields(o));
  const body = await r.text();
  const id = /\/console\/app\/(app-[a-z0-9]+)/.exec(body);
  const secret = /id="client-secret">([^<]+)</.exec(body);
  return { r, body, id: id && id[1], secret: secret && secret[1] };
}

const signIn = (h, clientId, user, ru = "https://app.example.org/cb") => login(h, { client: clientId, redirectUri: ru, user });

// ---- shared checks ----------------------------------------------------------------

test("checks: names (confusable skeletons, mixed scripts, domains, reserved, taken)", () => {
  const codes = (n, o) => checkName(n, "name.en", o).map((e) => e.code);
  assert.deepEqual(codes("Example Portal"), []);
  assert.ok(codes("Gооgle Sign-in").includes("name_mixed_script"), "Cyrillic о in Google");
  assert.ok(codes("Gооgle Sign-in").includes("name_reserved"));
  assert.ok(codes("G00GLE").includes("name_reserved"), "digits as letters");
  assert.ok(codes("Rnicrosoft").includes("name_reserved"), "rn as m");
  assert.ok(codes("PayPaI").includes("name_reserved"), "capital I as l");
  assert.ok(codes("支付宝登录").includes("name_reserved"));
  assert.ok(codes("Login at example.com").includes("name_domain"));
  assert.ok(codes("x").includes("name_length"));
  assert.ok(codes("<script>").includes("name_chars"));
  assert.deepEqual(codes("Metadata Lab"), [], "short reserved names only as whole words");
  assert.ok(codes("Lab Portal", { names: [{ id: "other", name: "LAB P0rtal" }] }).includes("name_taken"));
  assert.equal(skeleton("Gооgle"), skeleton("Google"));
});

test("checks: callback URLs (https, exact, IP literal, off-domain, localhost only in development)", () => {
  const c = (u, o = {}) => checkUrl(u, "redirect_uris[0]", { domain: "example.org", ...o }).map((e) => e.code);
  assert.deepEqual(c("https://app.example.org/cb"), []);
  assert.ok(c("http://app.example.org/cb").includes("url_https"));
  assert.ok(c("https://203.0.113.5/cb").includes("url_ip"));
  assert.ok(c("https://[2001:db8::1]/cb").includes("url_ip"));
  assert.ok(c("https://evil.example.net/cb").includes("url_off_domain"));
  assert.ok(c("https://example.org.evil.net/cb").includes("url_off_domain"));
  assert.ok(c("https://user:pw@app.example.org/cb").includes("url_userinfo"));
  assert.ok(c("https://app.example.org/cb#x").includes("url_fragment"));
  assert.ok(c("https://*.example.org/cb").length);
  assert.ok(c("http://localhost:3000/cb").includes("url_localhost_active"), "localhost while active");
  assert.deepEqual(c("http://localhost:3000/cb", { development: true }), []);
  assert.equal(needsDevelopment({ redirect_uris: ["http://127.0.0.1:8080/cb"] }), true);
});

test("checks: banned domain, block list, public DNS", async () => {
  const entry = { client_id: "app-x", protocol: "oidc", name: { en: "Example Portal" }, domain: "example.org", homepage: "https://example.org/", redirect_uris: ["https://app.example.org/cb"] };
  assert.deepEqual((await checkApp(entry, { banned: async () => false, blocked: async () => null, resolves: async () => true })).errors, []);
  assert.equal((await checkApp(entry, { banned: async () => true })).errors[0].code, "domain_banned");
  assert.equal((await checkApp(entry, { blocked: async (h) => (h === "app.example.org" ? "urlhaus" : null) })).errors[0].code, "reputation");
  assert.equal((await checkApp(entry, { resolves: async (h) => h !== "app.example.org" })).errors[0].code, "host_unresolved");
});

test("registry: app- identifiers and roamid-console are reserved for the console", () => {
  const { dropped } = validateRegistry({ idps: [], clients: [clientEntry("app-abcdef1234"), clientEntry("roamid-console"), clientEntry("fine-one")] });
  assert.deepEqual(dropped.map((d) => d.id).sort(), ["app-abcdef1234", "roamid-console"]);
});

// ---- console ---------------------------------------------------------------------------

test("console: sign in with RoamID, create an app, prove the domain, active; secret rotation", async () => {
  const h = await consoleSetup();
  const landing = await (await h.request("/console")).text();
  assert.match(landing, /console-signin/);
  assert.match(landing, /href="https:\/\/github\.com\/FadianRoam\/roamid\/blob\/main\/docs\/registry\.md[^"]*" id="pr-channel">No account at a listed identity provider\? Register by GitHub pull request</);
  assert.match(await (await h.request("/", { headers: { "Accept-Language": "zh-CN" } })).text(), /没有列表中任何身份提供方的账户？可以通过 GitHub 拉取请求登记/);
  await consoleLogin(h, USERS.alice);
  assert.match(await (await h.request("/console")).text(), /Alice/);
  // A post without the CSRF token is refused.
  const bad = await h.request("/console/new", { method: "POST", body: new URLSearchParams(appFields()).toString(), headers: { Origin: BASE } });
  assert.equal(bad.status, 400);
  const csrf0 = await csrfOf(h);
  const cross = await h.request("/console/new", { method: "POST", body: new URLSearchParams({ ...appFields(), csrf: csrf0 }).toString(), headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" } });
  assert.equal(cross.status, 400, "a cross-site post is refused even with the token");
  const noHdr = await h.request("/console/new", { method: "POST", body: new URLSearchParams({ ...appFields(), csrf: csrf0 }).toString(), headers: { Origin: "https://evil.example" } });
  assert.equal(noHdr.status, 400, "a foreign Origin is refused");
  const c = await createApp(h);
  assert.equal(c.r.status, 200, c.body.slice(0, 500));
  assert.ok(c.id && c.secret, "client_id and a secret shown once");
  let row = await h.db.prepare("SELECT * FROM apps WHERE client_id = ?").bind(c.id).first();
  assert.equal(row.status, "development", "no domain proof yet");
  assert.notEqual(row.secret_sha256, c.secret, "only the hash is stored");
  assert.doesNotMatch(await (await h.request(`/console/app/${c.id}`)).text(), new RegExp(c.secret), "the secret is not shown again");
  // Not usable by others before activation.
  const pre = await signIn(h, c.id, USERS.bob);
  assert.equal(pre.callback.status, 403);
  assert.match(await pre.callback.text(), /app_development/);
  await consoleLogin(h, USERS.alice);
  h.txt[`_roamid-app.example.org`] = [`roamid-app=${c.id}`];
  const chk = await post(h, `/console/app/${c.id}/check`, {});
  assert.equal(chk.status, 303);
  row = await h.db.prepare("SELECT * FROM apps WHERE client_id = ?").bind(c.id).first();
  assert.equal(row.status, "active");
  assert.ok(row.active_since);
  // Anyone signs in now; the picker shows the verified domain and a report link.
  h.cookies = new Map();
  const q = new URLSearchParams({ response_type: "code", client_id: c.id, redirect_uri: "https://app.example.org/cb", scope: "openid", state: "s" });
  const pick = await h.request(`/select?tx=${new URL(BASE + (await h.request(`/authorize?${q}`)).headers.get("Location")).searchParams.get("tx")}`);
  const pickHtml = await pick.text();
  assert.match(pickHtml, /<span class="host">example\.org<\/span>/);
  assert.match(pickHtml, new RegExp(`/report\\?app=${c.id}`));
  const ok = await signIn(h, c.id, USERS.bob);
  assert.ok(ok.code, "bob signs in");
  const x = await exchange(h, { code: ok.code, client: c.id, redirectUri: "https://app.example.org/cb", auth: { basic: c.secret } });
  assert.equal(x.res.status, 200, JSON.stringify(x.body));
  // Rotation: both secrets work until the old one is revoked.
  await consoleLogin(h, USERS.alice);
  const rot = await post(h, `/console/app/${c.id}/secret`, {});
  const newSecret = /id="client-secret">([^<]+)</.exec(await rot.text())[1];
  for (const s of [c.secret, newSecret]) {
    const l = await signIn(h, c.id, USERS.bob);
    assert.equal((await exchange(h, { code: l.code, client: c.id, redirectUri: "https://app.example.org/cb", auth: { basic: s } })).res.status, 200);
  }
  await consoleLogin(h, USERS.alice);
  await post(h, `/console/app/${c.id}/secret/revoke`, {});
  const l2 = await signIn(h, c.id, USERS.bob);
  assert.equal((await exchange(h, { code: l2.code, client: c.id, redirectUri: "https://app.example.org/cb", auth: { basic: c.secret } })).res.status, 401);
  // Listed publicly.
  const apps = await (await h.request("/apps.json")).json();
  assert.ok(apps.apps.some((a) => a.client_id === c.id && a.domain === "example.org"));
});

test("console: the automated checks refuse bad applications with reasons", async () => {
  const h = await consoleSetup();
  await consoleLogin(h, USERS.alice);
  const cases = [
    [{ name_en: "Gооgle Login" }, /name_mixed_script/],
    [{ redirect_uris: "https://evil.example.net/cb" }, /url_off_domain/],
    [{ redirect_uris: "https://203.0.113.7/cb" }, /url_ip/],
    [{ name_en: "IdP good" }, /name_taken/],
  ];
  for (const [o, re] of cases) {
    const c = await createApp(h, o);
    assert.equal(c.r.status, 422, JSON.stringify(o));
    assert.match(c.body, re);
  }
  h.unresolved.add("app.example.org");
  assert.match((await createApp(h)).body, /host_unresolved/);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM apps").first()).n, 0);
});

test("console: localhost callbacks keep development mode; only owners and co-owners sign in", async () => {
  const h = await consoleSetup();
  await consoleLogin(h, USERS.alice);
  h.txt["_roamid-app.example.org"] = [];
  const c = await createApp(h, { redirect_uris: "http://localhost:3000/cb", auth_method: "none" });
  assert.ok(c.id, c.body.slice(0, 400));
  h.txt["_roamid-app.example.org"] = [`roamid-app=${c.id}`];
  await post(h, `/console/app/${c.id}/check`, {});
  assert.equal((await h.db.prepare("SELECT status FROM apps WHERE client_id = ?").bind(c.id).first()).status, "development");
  const { pkce } = await import("./_harness.mjs");
  const pk = await pkce();
  const own = await login(h, { client: c.id, redirectUri: "http://localhost:3000/cb", user: USERS.alice, pk });
  assert.ok(own.code, "the owner signs in");
  const other = await login(h, { client: c.id, redirectUri: "http://localhost:3000/cb", user: USERS.bob, pk });
  assert.equal(other.callback.status, 403);
  // Invite bob as co-owner by email; he accepts and can sign in.
  await consoleLogin(h, USERS.alice);
  const inv = await post(h, `/console/app/${c.id}/owners/invite`, { email: "bob@example.org" });
  const link = /id="invite-link">([^<]+)</.exec(await inv.text())[1];
  await consoleLogin(h, USERS.olga);
  assert.equal((await h.request(link.replace(BASE, ""))).status, 403, "another email cannot accept");
  await consoleLogin(h, USERS.bob);
  const csrf = await csrfOf(h);
  const acc = await h.request(link.replace(BASE, ""), { method: "POST", body: `csrf=${csrf}`, headers: { Origin: BASE } });
  assert.equal(acc.status, 303);
  assert.ok((await login(h, { client: c.id, redirectUri: "http://localhost:3000/cb", user: USERS.bob, pk })).code);
});

test("reports, operator queue, suspend / ban / restore, appeal, refusal before the picker", async () => {
  const h = await consoleSetup();
  await consoleLogin(h, USERS.alice);
  const c = await createApp(h);
  h.txt["_roamid-app.example.org"] = [`roamid-app=${c.id}`];
  await post(h, `/console/app/${c.id}/check`, {});
  // A report from the picker: Orbit Verify is required.
  h.cookies = new Map();
  const q = new URLSearchParams({ response_type: "code", client_id: c.id, redirect_uri: "https://app.example.org/cb", scope: "openid", state: "s" });
  const tx = new URL(BASE + (await h.request(`/authorize?${q}`)).headers.get("Location")).searchParams.get("tx");
  const form = await h.request(`/report?app=${c.id}&tx=${tx}`);
  assert.match(form.headers.get("Content-Security-Policy"), /script-src 'self' https:\/\/verify\.yunzheng\.space/);
  const formHtml = await form.text();
  assert.match(formHtml, /data-sitekey="ovk_test"/);
  assert.match(formHtml, /<script src="https:\/\/verify\.yunzheng\.space\/v1\.js[^"]*" async defer><\/script>/, "the widget script is on the page");
  const rep = (token, extra = {}) => h.request("/report", { method: "POST", body: new URLSearchParams({ target: `app:${c.id}`, tx, category: "phishing", description: "It asks for my bank password.", "orbit-verify-response": token, ...extra }).toString(), headers: { "CF-Connecting-IP": "198.51.100.7" } });
  const denied = await rep("bad-token");
  assert.equal(denied.status, 403);
  const sent = await rep("good-token");
  assert.equal(sent.status, 200);
  assert.match(await sent.text(), /id="report-id">r-/);
  const row = await h.db.prepare("SELECT * FROM reports").first();
  assert.equal(row.target_id, c.id);
  assert.equal(JSON.parse(row.context).sign_in.client_id, c.id);
  assert.notEqual(row.reporter_hash, "198.51.100.7");
  assert.equal(h.tickets.length, 1, "a help desk ticket for the operator");
  assert.equal(h.tickets[0].key, "hd-key");
  assert.equal(row.ticket, "T-1");
  assert.ok(h.tickets[0].body.body.includes(`${BASE}/admin/reports#${row.id}`), "the ticket links to the report in the queue");
  // A report alone changes nothing.
  assert.equal((await h.db.prepare("SELECT status FROM apps WHERE client_id = ?").bind(c.id).first()).status, "active");
  // Only operators see the queue.
  await consoleLogin(h, USERS.bob);
  assert.equal((await h.request("/admin/reports")).status, 403);
  await consoleLogin(h, USERS.olga);
  const queue = await (await h.request("/admin/reports")).text();
  assert.match(queue, new RegExp(c.id));
  assert.match(queue, new RegExp(`id="${row.id}"`), "the ticket's anchor exists in the queue");
  // Bob holds a code issued before the suspension.
  const before = await signIn(h, c.id, USERS.bob);
  await consoleLogin(h, USERS.olga);
  const csrf = await csrfOf(h, "/admin/reports");
  assert.equal((await post(h, `/admin/target/app/${c.id}/suspend`, { reason: "Phishing page confirmed" }, csrf)).status, 303);
  const refused = await h.request(`/authorize?${q}`);
  assert.equal(refused.status, 403);
  const rt = await refused.text();
  assert.match(rt, /app_suspended/);
  assert.match(rt, /error=access_denied/, "a suspended app gets the standard error back");
  assert.equal((await exchange(h, { code: before.code, client: c.id, redirectUri: "https://app.example.org/cb", auth: { basic: c.secret } })).res.status, 401, "no tokens for a suspended app");
  // The owner sees the reason and appeals.
  await consoleLogin(h, USERS.alice);
  assert.match(await (await h.request(`/console/app/${c.id}`)).text(), /Phishing page confirmed/);
  await post(h, `/console/app/${c.id}/appeal`, { text: "The page was a test and is removed." });
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE kind = 'appeal' AND state = 'open'").first()).n, 1);
  // Ban: no link back to the app; the domain cannot be reused.
  await consoleLogin(h, USERS.olga);
  await post(h, `/admin/target/app/${c.id}/ban`, { reason: "Illegal site" }, await csrfOf(h, "/admin/reports"));
  const banned = await (await h.request(`/authorize?${q}`)).text();
  assert.match(banned, /app_banned/);
  assert.doesNotMatch(banned, /app\.example\.org\/cb\?error/);
  await consoleLogin(h, USERS.bob);
  assert.match((await createApp(h, { name_en: "Other Name" })).body, /domain_banned/);
  assert.match((await createApp(h, { name_en: "Third Name", domain: "shop.example.org", homepage: "https://shop.example.org/", redirect_uris: "https://shop.example.org/cb" })).body, /domain_banned/, "a subdomain of a banned domain");
  // Restore: active again (the proof is still there).
  await consoleLogin(h, USERS.olga);
  await post(h, `/admin/target/app/${c.id}/restore`, { reason: "Appeal accepted" }, await csrfOf(h, "/admin/reports"));
  assert.equal((await h.db.prepare("SELECT status FROM apps WHERE client_id = ?").bind(c.id).first()).status, "active");
  assert.ok((await signIn(h, c.id, USERS.bob)).code);
  const actions = (await h.db.prepare("SELECT action FROM audit WHERE target_id = ? ORDER BY id").bind(c.id).all()).results.map((r) => r.action);
  for (const a of ["created", "activated", "suspend", "appeal", "ban", "restore"]) assert.ok(actions.includes(a), a);
});

test("operator emergency override disables an identity provider everywhere", async () => {
  const h = await consoleSetup();
  const jar = new Map(await consoleLogin(h, USERS.olga));
  await post(h, "/admin/target/idp/good/idp_disable", { reason: "Compromised" }, await csrfOf(h, "/admin/reports"));
  h.cookies = new Map();
  const { pkce: pk0 } = await import("./_harness.mjs");
  const r = await login(h, { client: "spa", pk: await pk0() });
  assert.ok(r.picker, "the picker is shown (no provider to go to)");
  assert.doesNotMatch(await r.picker.text(), /value="good"/, "not offered");
  assert.ok(!r.code);
  // The operator's existing session (a new sign-in through the disabled provider is not possible).
  h.cookies = jar;
  await post(h, "/admin/target/idp/good/idp_enable", { reason: "Resolved" }, await csrfOf(h, "/admin/reports"));
  h.cookies = new Map();
  const { pkce } = await import("./_harness.mjs");
  assert.ok((await login(h, { client: "spa", pk: await pkce() })).code);
});

test("limits: domain proof lost past 72 hours, new-app daily cap, applications per person", async () => {
  const h = await consoleSetup();
  await consoleLogin(h, USERS.alice);
  const c = await createApp(h);
  h.txt["_roamid-app.example.org"] = [`roamid-app=${c.id}`];
  await post(h, `/console/app/${c.id}/check`, {});
  const t = Math.floor(Date.now() / 1000);
  const q = new URLSearchParams({ response_type: "code", client_id: c.id, redirect_uri: "https://app.example.org/cb", scope: "openid", state: "s" });
  await h.db.prepare("UPDATE apps SET domain_failing_since = ? WHERE client_id = ?").bind(t - 71 * 3600, c.id).run();
  assert.equal((await h.request(`/authorize?${q}`)).status, 303, "within the grace period");
  await h.db.prepare("UPDATE apps SET domain_failing_since = ? WHERE client_id = ?").bind(t - 73 * 3600, c.id).run();
  const r = await h.request(`/authorize?${q}`);
  assert.equal(r.status, 403);
  assert.match(await r.text(), /app_unverified/);
  await h.db.prepare("UPDATE apps SET domain_failing_since = NULL WHERE client_id = ?").bind(c.id).run();
  await h.db.prepare("INSERT INTO events (day, kind, idp, client_id, code, n) VALUES (?, 'completed', 'good', ?, '', 500)").bind(new Date().toISOString().slice(0, 10), c.id).run();
  const capped = await signIn(h, c.id, USERS.bob);
  assert.match(await capped.callback.text(), /app_new_limit/);
  await h.db.prepare("UPDATE apps SET limit_lifted = 1 WHERE client_id = ?").bind(c.id).run();
  assert.ok((await signIn(h, c.id, USERS.bob)).code, "lifted");
  await consoleLogin(h, USERS.alice);
  for (let i = 0; i < 9; i++) await h.db.prepare("INSERT INTO apps (client_id, protocol, name_en, domain, homepage, config, status, created_by, created_at, updated_at) VALUES (?, 'oidc', ?, 'x.org', 'https://x.org/', '{}', 'development', ?, ?, ?)").bind(`app-fill${i}000`, `Fill ${i}`, await publicSub(USERS.alice), t, t).run();
  assert.match((await createApp(h, { name_en: "Eleventh App", domain: "eleven.org", homepage: "https://eleven.org/", redirect_uris: "https://eleven.org/cb" })).body, /cap_creator/);
});

test("fail closed: no application becomes active before the block lists have loaded", async () => {
  const h = await consoleSetup();
  await h.db.prepare("DELETE FROM blocklists").run();
  await consoleLogin(h, USERS.alice);
  const c = await createApp(h);
  h.txt["_roamid-app.example.org"] = [`roamid-app=${c.id}`];
  await post(h, `/console/app/${c.id}/check`, {});
  assert.equal((await h.db.prepare("SELECT status FROM apps WHERE client_id = ?").bind(c.id).first()).status, "development");
  const { refreshBlocklists } = await import("../src/apps/review.js");
  await refreshBlocklists(h.env, { force: true });
  await post(h, `/console/app/${c.id}/check`, {});
  assert.equal((await h.db.prepare("SELECT status FROM apps WHERE client_id = ?").bind(c.id).first()).status, "active");
});

test("block list: a listed host refuses the application", async () => {
  const h = await consoleSetup();
  h.blocklist["urlhaus.abuse.ch"] = "127.0.0.1\tapp.example.org\n";
  const { refreshBlocklists, resetListMemo } = await import("../src/apps/review.js");
  await refreshBlocklists(h.env, { force: true }); resetListMemo();
  await consoleLogin(h, USERS.alice);
  assert.match((await createApp(h)).body, /data-code="reputation"/);
});

test("/test/<idp>: one sign-in, the normalized claims shown, pairwise subject, nothing kept", async () => {
  const h = await consoleSetup();
  h.cookies = new Map();
  let r = await h.request("/test");
  assert.match(await r.text(), /href="\/test\/good"/);
  r = await h.request("/test/good");
  assert.equal(r.status, 303);
  const authz = new URL(BASE + r.headers.get("Location"));
  assert.equal(authz.searchParams.get("idp_hint"), "good");
  r = await h.request(authz.pathname + authz.search);
  const up = r.headers.get("Location");
  assert.ok(up.startsWith(h.idps.good.issuer), up);
  r = await h.request(h.idps.good.issue(up, USERS.bob));
  const back = r.headers.get("Location");
  assert.ok(back.startsWith(`${BASE}/test/callback?`));
  const page = await (await h.request(back)).text();
  assert.match(page, /id="test-claims"/);
  assert.match(page, /bob@example\.org/);
  assert.doesNotMatch(page, new RegExp(await publicSub(USERS.bob)), "pairwise, not the public sub");
  assert.equal((await h.request("/test/no-such-idp")).status, 404);
});

// ---- transparency ------------------------------------------------------------------------

test("redaction: emails and phone numbers removed; URLs, domains and IPs defanged", async () => {
  const { redactReportText } = await import("../src/apps/transparency.js");
  const r = redactReportText("Mail me at victim@example.org or +1 (555) 123-4567. The page https://login.evil.example/x?a=1 on 203.0.113.9 copies bank.example.com");
  assert.doesNotMatch(r, /victim@example\.org|555/);
  assert.match(r, /\[email removed\]/);
  assert.match(r, /\[phone removed\]/);
  assert.match(r, /hxxps:\/\/login\[\.\]evil\[\.\]example/);
  assert.match(r, /203\[\.\]0\[\.\]113\[\.\]9/);
  assert.match(r, /bank\[\.\]example\[\.\]com/);
});

async function reportAndAct(h, c, { description, noPublish = false, action = "suspend" }) {
  h.cookies = new Map();
  const body = { target: `app:${c.id}`, category: "phishing", description, "orbit-verify-response": "good-token", ...(noPublish ? { no_publish: "yes" } : {}) };
  await h.request("/report", { method: "POST", body: new URLSearchParams(body).toString(), headers: { "CF-Connecting-IP": "198.51.100.8" } });
  const rep = await h.db.prepare("SELECT * FROM reports WHERE description = ?").bind(description).first();
  await consoleLogin(h, USERS.olga);
  await post(h, `/admin/target/app/${c.id}/${action}`, { reason: "Phishing page confirmed" }, await csrfOf(h, "/admin/reports"));
  return rep;
}

test("transparency: decisions are public at once; reports only after the operator publishes them, redacted, honouring the opt-out", async () => {
  const h = await consoleSetup();
  await consoleLogin(h, USERS.alice);
  const c = await createApp(h);
  h.txt["_roamid-app.example.org"] = [`roamid-app=${c.id}`];
  await post(h, `/console/app/${c.id}/check`, {});
  const rep = await reportAndAct(h, c, { description: "Fake login at https://app.example.org/x, write to me: me@reporter.example" });
  let tj = await (await h.request("/transparency.json")).json();
  assert.equal(tj.items.length, 1);
  const d = tj.items[0];
  assert.deepEqual({ target_id: d.target_id, domain: d.domain, category: d.category, decision: d.decision, reason: d.reason }, { target_id: c.id, domain: "example.org", category: "phishing", decision: "suspend", reason: "Phishing page confirmed" });
  const raw = JSON.stringify(tj);
  assert.doesNotMatch(raw, /198\.51|reporter|olga|context|sub/, "no reporter data and no operator id");
  assert.equal((await (await h.request("/transparency.json?kind=publications")).json()).items.length, 0, "nothing published without confirmation");
  assert.equal((await h.db.prepare("SELECT outcome FROM reports WHERE id = ?").bind(rep.id).first()).outcome, "upheld");
  // The operator publishes; the text is redacted again on the server.
  const page = await (await h.request(`/admin/target/app/${c.id}`)).text();
  assert.match(page, /\[email removed\]/, "the form is prefilled redacted");
  await post(h, `/admin/target/app/${c.id}/publish`, { report_id: rep.id, text: "Fake login, contact me@reporter.example via https://app.example.org/x" }, await csrfOf(h, "/admin/reports"));
  const pubs = (await (await h.request("/transparency.json?kind=publications")).json()).items;
  assert.equal(pubs.length, 1);
  assert.doesNotMatch(pubs[0].text, /me@reporter|https:\/\/app\.example/);
  assert.match(pubs[0].text, /hxxps/);
  // Opt-out: category and decision only, whatever text is submitted.
  await post(h, `/admin/target/app/${c.id}/restore`, { reason: "Fixed" }, await csrfOf(h, "/admin/reports"));
  const rep2 = await reportAndAct(h, c, { description: "Second report with private details here", noPublish: true });
  await post(h, `/admin/target/app/${c.id}/publish`, { report_id: rep2.id, text: "Second report with private details here" }, await csrfOf(h, "/admin/reports"));
  const p2 = (await (await h.request("/transparency.json?kind=publications")).json()).items.find((x) => x.text.includes("asked not to publish"));
  assert.ok(p2 && !/private details/.test(p2.text));
  // A dismissed report is published only with an explicit choice.
  await post(h, `/admin/target/app/${c.id}/restore`, { reason: "Fixed again" }, await csrfOf(h, "/admin/reports"));
  const rep3 = await reportAndAct(h, c, { description: "Third report that was not right", action: "dismiss" });
  await post(h, `/admin/target/app/${c.id}/publish`, { report_id: rep3.id, text: "x" }, await csrfOf(h, "/admin/reports"));
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM publications WHERE report_id = ?").bind(rep3.id).first()).n, 0);
  await post(h, `/admin/target/app/${c.id}/publish`, { report_id: rep3.id, text: "Not a phishing page.", publish_dismissed: "yes" }, await csrfOf(h, "/admin/reports"));
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM publications WHERE report_id = ?").bind(rep3.id).first()).n, 1);
});

test("appeals from GitHub: bearer token, one queue item per issue", async () => {
  const h = await consoleSetup();
  h.env.APPEAL_TOKEN = "appeal-token-123";
  const call = (tok, body) => h.request("/admin/appeal", { method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } });
  assert.equal((await call("wrong", { issue: 3, login: "x", target_kind: "app", target_id: "spa", text: "please review" })).status, 401);
  const ok = await call("appeal-token-123", { issue: 3, login: "someone", target_kind: "app", target_id: "spa", text: "please review this decision" });
  assert.equal(ok.status, 200);
  assert.equal((await call("appeal-token-123", { issue: 3, login: "someone", target_kind: "app", target_id: "spa", text: "please review this decision" })).status, 200);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE kind = 'appeal'").first()).n, 1);
  assert.equal((await call("appeal-token-123", { issue: 4, login: "someone", target_kind: "app", target_id: "nope", text: "please review" })).status, 404);
});

test("no workflow or script approves pull requests", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const files = [...readdirSync(new URL("../.github/workflows/", import.meta.url)).map((f) => `../.github/workflows/${f}`), ...readdirSync(new URL("../scripts/", import.meta.url)).map((f) => `../scripts/${f}`)];
  for (const f of files) {
    const s = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(s, /\/reviews\b|event:\s*["']?APPROVE|gh pr review|--approve/i, f);
  }
});
