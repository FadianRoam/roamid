// The console, the operator queue and the report form in both languages,
// and the pages that tell a person what to do next. Through the Worker's
// real entry point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, BASE, sha256b64url } from "./_harness.mjs";

const USERS = {
  alice: { sub: "alice-1", email: "alice@example.org", email_verified: true, name: "Alice", preferred_username: "alice" },
  bob: { sub: "bob-1", email: "bob@example.org", email_verified: true, name: "Bob", preferred_username: "bob" },
  olga: { sub: "olga-1", email: "olga@example.org", email_verified: true, name: "Olga", preferred_username: "olga" },
};

async function consoleSetup() {
  const h = await setup();
  h.env.OPERATOR_SUBS = await sha256b64url(`good|${USERS.olga.sub}`);
  await h.sync();
  return h;
}

// Sign in through /console/login?next=<next>; returns the final redirect and the authorize URL.
async function signIn(h, user, next = "/console") {
  h.cookies = new Map();
  let r = await h.request(`/console/login?next=${encodeURIComponent(next)}`);
  assert.equal(r.status, 303);
  const authz = r.headers.get("Location");
  r = await h.request(authz);
  const tx = new URL(BASE + r.headers.get("Location")).searchParams.get("tx");
  r = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp: "good" }).toString() });
  r = await h.request(h.idps.good.issue(r.headers.get("Location"), user));
  r = await h.request(r.headers.get("Location"));
  assert.equal(r.status, 303);
  return { authz, landed: r.headers.get("Location") };
}

const csrfOf = async (h, path) => /name="csrf" value="([^"]+)"/.exec(await (await h.request(path)).text())[1];
async function post(h, path, fields, csrf) {
  const b = new URLSearchParams({ csrf: csrf ?? (await csrfOf(h, path.startsWith("/zh/") ? "/zh/console" : "/console")) });
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) b.append(k, x);
  return h.request(path, { method: "POST", body: b.toString(), headers: { Origin: "null", "Sec-Fetch-Site": "same-origin" } });
}
const appFields = (o = {}) => ({ name_en: "Example Portal", name_zh: "示例门户", domain: "example.org", homepage: "https://example.org/", protocol: "oidc", redirect_uris: "https://app.example.org/cb", auth_method: "client_secret_basic", subject_type: "public", ...o });

test("/zh/console is the Chinese console; without /zh/ the cookie or Accept-Language picks the default", async () => {
  const h = await consoleSetup();
  const zh = await h.request("/zh/console", { cookies: false });
  assert.equal(zh.status, 200);
  const zhHtml = await zh.text();
  assert.match(zhHtml, /<html lang="zh-CN"/);
  assert.match(zhHtml, /<meta name="robots" content="noindex">/);
  assert.match(zhHtml, /href="\/console\/login\?next=%2Fzh%2Fconsole" id="console-signin"/, "sign-in comes back to the Chinese console");
  // The language switch sets the cookie, so /console does not send the person back.
  assert.match(zhHtml, /class="tool lang-switch" href="\/prefs\?lang=en&amp;next=%2Fconsole"/);
  assert.match(zhHtml, /href="\/zh\/apps"/);

  const en = await h.request("/console", { cookies: false });
  assert.equal(en.status, 200);
  assert.match(await en.text(), /<html lang="en"/);
  for (const headers of [{ "Accept-Language": "zh-CN,zh;q=0.9" }, { Cookie: "__Host-rid_lang=zh" }]) {
    const r = await h.request("/console?signin=failed", { headers, cookies: false });
    assert.equal(r.status, 302, JSON.stringify(headers));
    assert.equal(r.headers.get("Location"), `${BASE}/zh/console?signin=failed`);
    assert.match(r.headers.get("Vary"), /Cookie/);
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  }
  // The cookie wins over Accept-Language.
  const kept = await h.request("/console", { headers: { "Accept-Language": "zh-CN", Cookie: "__Host-rid_lang=en" }, cookies: false });
  assert.equal(kept.status, 200);
  // /prefs sets the cookie and goes to the English console, which stays English.
  const p = await h.request("/prefs?lang=en&next=%2Fconsole", { cookies: false });
  assert.equal(p.headers.get("Location"), "/console");
  assert.match(p.headers.get("Set-Cookie"), /__Host-rid_lang=en/);
  // Public pages never redirect by language; the sign-in callback has one URL.
  assert.equal((await h.request("/idps", { headers: { "Accept-Language": "zh-CN" }, cookies: false })).status, 200);
  assert.equal((await h.request("/zh/console/callback", { cookies: false })).status, 301);
  assert.equal((await h.request("/zh/admin")).status, 302);
});

test("signing in from /zh/console: the picker in Chinese, back to /zh/console; the console stays Chinese after posts", async () => {
  const h = await consoleSetup();
  const { authz, landed } = await signIn(h, USERS.alice, "/zh/console");
  assert.equal(new URL(BASE + authz).searchParams.get("ui_locales"), "zh-CN");
  assert.equal(landed, "/zh/console");
  const home = await (await h.request("/zh/console")).text();
  assert.match(home, /<html lang="zh-CN"/);
  assert.match(home, /<span class="idp-name">身份提供方 good<\/span>/, "the identity provider by name");
  assert.match(home, /id="no-apps"/, "empty list: next steps");
  assert.match(home, /href="\/zh\/console\/new" id="new-app-empty"/);
  assert.match(home, /action="\/zh\/console\/logout"/);

  // A form with errors comes back in Chinese, naming the field.
  let r = await post(h, "/zh/console/new", appFields({ redirect_uris: "http://app.example.org/cb" }));
  assert.equal(r.status, 422);
  let body = await r.text();
  assert.match(body, /<html lang="zh-CN"/);
  assert.match(body, /<a href="#f-redirect_uris" data-field="redirect_uris">回调地址<\/a>/);
  assert.match(body, /<label class="field invalid"><span class="lbl">回调地址<\/span><textarea id="f-redirect_uris" name="redirect_uris" aria-invalid="true"/);
  assert.match(body, /action="\/zh\/console\/new"/);

  r = await post(h, "/zh/console/new", appFields());
  assert.equal(r.status, 200);
  body = await r.text();
  const id = /\/zh\/console\/app\/(app-[a-z0-9]+)/.exec(body)[1];
  assert.match(body, /<html lang="zh-CN"/);
  assert.match(body, /data-copy="client-secret"/, "copy button for the secret");
  assert.match(body, /data-copy="client-id"/);
  assert.match(body, /<div class="notice ok"><div><p>/, "the notice's text is one column");
  assert.doesNotMatch(body, />proof_pending</, "every state has a text");

  // Check now: says whether the proof was found and why not, in Chinese.
  r = await post(h, `/zh/console/app/${id}/check`, {});
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), `/zh/console/app/${id}?msg=checked_fail`);
  body = await (await h.request(r.headers.get("Location"))).text();
  assert.match(body, /data-msg="checked_fail">仍未找到证明。 没有值为 roamid-app=app-[a-z0-9]+ 的 TXT 记录 _roamid-app\.example\.org。 https:\/\/example\.org\/\.well-known\/roamid-app\.txt 返回 HTTP 404。/);
  h.wellKnown["example.org"] = `${id}\n`;
  r = await post(h, `/zh/console/app/${id}/check`, {});
  assert.equal(r.headers.get("Location"), `/zh/console/app/${id}?msg=checked_ok`);

  // An expired form: a styled page in the page's language, back to the page.
  r = await post(h, `/zh/console/app/${id}/secret`, {}, "wrong-token");
  assert.equal(r.status, 400);
  body = await r.text();
  assert.match(body, /<html lang="zh-CN"/);
  assert.match(body, /表单已过期/);
  assert.match(body, new RegExp(`href="/zh/console/app/${id}" id="expired-back"`));

  // Somebody else's (or a missing) application: not the operator page.
  r = await h.request("/zh/console/app/app-doesnotexist");
  assert.equal(r.status, 404);
  body = await r.text();
  assert.match(body, /找不到这个应用/);
  assert.match(body, /id="switch-account"/);
  assert.doesNotMatch(body, /运营/);

  // A co-owner trying an owner-only action.
  const inv = await post(h, `/zh/console/app/${id}/owners/invite`, { email: USERS.bob.email });
  assert.match(await inv.text(), /data-copy="invite-link"/);
  await h.db.prepare("INSERT INTO app_owners (client_id, sub, role, email, added_at) VALUES (?, ?, 'co-owner', ?, 0)").bind(id, await sha256b64url(`good|${USERS.bob.sub}`), USERS.bob.email).run();
  await signIn(h, USERS.bob);
  r = await post(h, `/zh/console/app/${id}/delete`, { confirm: "yes" });
  assert.equal(r.status, 403);
  assert.match(await r.text(), /只有所有者可以/);

  // Sign out keeps the language; "another account" signs in again at once.
  r = await post(h, "/zh/console/logout", { then: "login" });
  assert.equal(r.headers.get("Location"), "/console/login?next=%2Fzh%2Fconsole");
});

test("rate limit on an application form: the form again, saying how long to wait", async () => {
  const h = await consoleSetup();
  await signIn(h, USERS.alice);
  const created = await (await post(h, "/console/new", appFields())).text();
  const id = /\/console\/app\/(app-[a-z0-9]+)/.exec(created)[1];
  const csrf = await csrfOf(h, "/console");
  let r;
  for (let i = 0; i < 40; i++) { r = await post(h, `/console/app/${id}/edit`, appFields({ name_en: "Example Portal" }), csrf); if (r.status === 429) break; }
  assert.equal(r.status, 429);
  const body = await r.text();
  assert.match(body, /Wait a minute and try again/);
  assert.match(body, /name="name_en"/, "the form, with what was typed");
});

test("report form: choose from a list, or type a name; posts from /zh/report stay Chinese", async () => {
  const h = await consoleSetup();
  let page = await (await h.request("/zh/report")).text();
  assert.match(page, /<select name="target" id="f-target">/);
  assert.match(page, /<option value="app:spa" data-q="app spa spa rp\.example\.test">App spa \(rp\.example\.test\)<\/option>/);
  assert.match(page, /<option value="idp:good"[^>]*>身份提供方 good/);
  assert.match(page, /action="\/zh\/report"/);
  // Nothing chosen: the Chinese page again, with the list.
  let r = await h.request("/zh/report", { method: "POST", body: new URLSearchParams({ category: "phishing", description: "a phishing page here" }).toString() });
  assert.equal(r.status, 400);
  page = await r.text();
  assert.match(page, /<html lang="zh-CN"/);
  assert.match(page, /没有找到这个应用或身份提供方，请从列表中选择。/);
  assert.match(page, /<select name="target" id="f-target" aria-invalid="true">/);
  assert.match(page, /a phishing page here/, "what was typed is kept");
  // A name typed in the advanced field.
  r = await h.request("/zh/report", { method: "POST", body: new URLSearchParams({ target_id: "App spa", target_kind: "app", category: "phishing", description: "a phishing page here" }).toString() });
  assert.equal(r.status, 200);
  page = await r.text();
  assert.match(page, /<html lang="zh-CN"/);
  const rid = /id="report-id">([^<]+)</.exec(page)[1];
  const row = await h.db.prepare("SELECT target_kind, target_id FROM reports WHERE id = ?").bind(rid).first();
  assert.deepEqual({ ...row }, { target_kind: "app", target_id: "spa" });
  // From the list.
  r = await h.request("/report", { method: "POST", body: new URLSearchParams({ target: "idp:good", category: "fraud", description: "fraud on this provider" }).toString() });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<html lang="en"/);
  // From an application's page: fixed target, a link to choose another.
  page = await (await h.request("/zh/report?app=spa")).text();
  assert.match(page, /name="fixed" value="1"/);
  assert.match(page, /href="\/zh\/report" id="report-other"/);
  assert.doesNotMatch(page, /id="f-target"/);
});

test("operator queue: others see a notice and the policy link; lookup by name; history names the operator", async () => {
  const h = await consoleSetup();
  await signIn(h, USERS.alice);
  let r = await h.request("/zh/admin/reports");
  assert.equal(r.status, 403);
  let body = await r.text();
  assert.match(body, /运营后台仅对运营方开放。/);
  assert.match(body, /href="https:\/\/github\.com\/FadianRoam\/roamid\/blob\/main\/docs\/zh-CN\/policy\.md#运营后台" id="operators-doc"/);
  assert.doesNotMatch(body, /sub /);
  // A report to act on.
  await h.request("/report", { method: "POST", body: new URLSearchParams({ target: "app:spa", category: "phishing", description: "first line of it\nmore text" }).toString() });
  await signIn(h, USERS.olga, "/zh/admin/reports");
  body = await (await h.request("/zh/admin/reports")).text();
  assert.match(body, /<a href="\/zh\/admin\/target\/app\/spa"><b>App spa<\/b><\/a>/);
  r = await h.request("/zh/admin/target?q=app%20spa");
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), "/zh/admin/target/app/spa");
  r = await h.request("/zh/admin/target?q=rp.example");
  assert.equal(r.status, 303, "a single partial match opens it");
  r = await h.request("/zh/admin/target?q=nothing-like-this");
  assert.equal(r.status, 404);
  assert.match(await r.text(), /没有与“nothing-like-this”匹配的对象。/);
  assert.match(await (await h.request("/zh/admin/target/app/nope-x")).text(), /没有这个标识对应的应用或身份提供方。/);
  body = await (await h.request("/zh/admin/target/app/spa")).text();
  assert.match(body, /<span class="hint">first line of it<\/span>/, "the basis shows the first line");
  const rid = /name="report_ids" value="([^"]+)"/.exec(body)[1];
  const csrf = /name="csrf" value="([^"]+)"/.exec(body)[1];
  r = await post(h, "/zh/admin/target/app/spa/dismiss", { report_ids: rid, reason: "not phishing" }, csrf);
  assert.equal(r.headers.get("Location"), "/zh/admin/target/app/spa");
  body = await (await h.request("/zh/admin/target/app/spa")).text();
  assert.match(body, /<td data-label="操作者">olga@example\.org<\/td>/);
  body = await (await h.request("/zh/admin/reports")).text();
  assert.match(body, /<table class="tbl stack" id="recent">.*<a href="\/zh\/admin\/target\/app\/spa">App spa<\/a>/s);
});
