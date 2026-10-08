// Public pages: language URLs, the footer, noindex, and the identity
// provider lists (search, order, groups, picker collapse) at scale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, BASE } from "./_harness.mjs";
import { norm, searchText, orderIdps, pickerSplit, sortIdps, groupIdps } from "../src/ui/list.js";
import { fixtureIdps } from "../src/ui/fixtures.js";

const get = (h, path, headers = {}) => h.request(path, { headers });

test("language routes: /x English, /zh/x Chinese; variants answer 301 with the canonical URL under BASE_URL", async () => {
  const h = await setup();
  const en = await get(h, "/idps", { "Accept-Language": "zh-CN" });
  assert.equal(en.status, 200);
  assert.match(await en.text(), /<html lang="en"/, "Accept-Language never changes a public URL");
  const zh = await get(h, "/zh/idps");
  assert.match(await zh.text(), /<html lang="zh-CN"/);
  assert.match(await (await get(h, "/zh/")).text(), /<html lang="zh-CN"/);
  for (const [from, to] of [
    ["/zh", "/zh/"], ["/idps/", "/idps"], ["/idps.html", "/idps"], ["/zh/idps/", "/zh/idps"], ["/index.html", "/"], ["/zh/index.html", "/zh/"],
    ["/status.md", "/status"], ["/idps?lang=zh&sort=added", "/zh/idps?sort=added"], ["/zh/idps?lang=en", "/idps"], ["/zh/console", "/console"],
  ]) {
    const r = await h.request(from, { headers: { Host: "origin.example.test" } });
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get("location"), `${BASE}${to}`, from);
  }
  assert.equal((await get(h, "/zh/token")).status, 404, "/zh/ before a path that is not a page");
  assert.equal((await get(h, "/zh/nothing-here")).status, 404);
  // A client cannot pick the language with the internal header.
  assert.match(await (await get(h, "/idps", { "x-roamid-twin": "zh" })).text(), /<html lang="en"/);
  // Links on a Chinese page stay in Chinese.
  const zhHtml = await (await get(h, "/zh/status")).text();
  assert.match(zhHtml, /href="\/zh\/idps"/);
  assert.match(zhHtml, /class="tool lang-switch" href="\/prefs\?lang=en&amp;next=%2Fstatus"/);
});

test("every page has the footer with Powered by YunZheng LAB; non-public pages are noindex; every response has x-roamid-build", async () => {
  const h = await setup();
  for (const path of ["/", "/zh/", "/idps", "/zh/idps", "/apps", "/status", "/demo", "/report", "/test", "/console", "/nothing"]) {
    const r = await get(h, path);
    const html = await r.text();
    assert.match(html, /<p class="powered"><a href="https:\/\/yunzheng\.space\/"><span>(Powered by|技术支持)<\/span><picture><source srcset="\/assets\/lab-logo\.[0-9a-f]+\.webp" type="image\/webp"><img src="\/assets\/lab-logo\.[0-9a-f]+\.png" width="72" height="32" alt="YunZheng LAB" loading="lazy"/, path);
    assert.equal(r.headers.get("x-roamid-build"), "public", path);
    const noindex = /<meta name="robots" content="noindex">/.test(html);
    assert.equal(noindex, ["/report", "/test", "/console", "/nothing"].includes(path), `${path} noindex`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${path}: one h1`);
    assert.doesNotMatch(html, /<(script|link|img|source)[^>]+(src|href|srcset)="https?:\/\//, `${path}: no third-party resources`);
  }
  assert.equal((await get(h, "/sitemap.xml")).status, 404, "no sitemap by default");
  assert.match(await (await get(h, "/robots.txt")).text(), /Disallow: \/console/);
});

test("search text: case, accents, width; Chinese names, ids, hosts and email domains", () => {
  const i = { id: "elan-u", name: { en: "Élan University", zh: "北辰大学" }, issuer: "https://login.elan.example.org", email_domains: ["elan.example.org"] };
  const q = searchText(i);
  for (const s of ["elan", "ÉLAN", "Ｅｌａｎ", "北辰", "elan-u", "login.elan", "elan.example.org"]) assert.ok(q.includes(norm(s)), s);
  assert.equal(norm("  Ａ  b́ "), "a b");
});

test("picker order: last used, then login_hint domain matches, then by name; down providers last; collapse after the top", () => {
  const { idps, health } = fixtureIdps(60);
  const down = idps.filter((i) => health[i.id] === "down").map((i) => i.id);
  const last = idps[40].id;
  const hinted = idps.find((i) => (i.email_domains || []).length && health[i.id] !== "down" && i.id !== last);
  const o = orderIdps(idps, { lang: "en", last, hint: `someone@${hinted.email_domains[0]}`, health });
  assert.equal(o[0].id, last);
  assert.equal(o[1].id, hinted.id);
  assert.deepEqual(o.slice(-down.length).map((i) => i.id).sort(), down.sort(), "down providers at the end");
  const mid = o.slice(2, -down.length).map((i) => i.name.en);
  assert.deepEqual(mid, [...mid].sort((a, b) => new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare(a, b)));
  const { top, rest } = pickerSplit(o, { last, hint: null });
  assert.equal(top.length, 6);
  assert.equal(rest.length, 54);
  assert.deepEqual(pickerSplit(o.slice(0, 7)).rest, [], "no collapse for a single extra row");
  // Chinese pages sort by the Chinese name where there is one.
  const zh = orderIdps(idps.slice(0, 12), { lang: "zh", health: {} });
  assert.ok(zh.length === 12);
});

test("/idps groups and sorts: by protocol; name, recently added, status", () => {
  const { idps, health, added } = fixtureIdps(60);
  const g = groupIdps(idps);
  assert.deepEqual(g.map((x) => x.key), ["oidc", "saml2"]);
  assert.equal(g[0].items.length + g[1].items.length, 60);
  const byAdded = sortIdps(idps, { by: "added", added });
  assert.equal(byAdded[0].id, idps[59].id);
  const byStatus = sortIdps(idps, { by: "status", health });
  assert.equal(health[byStatus[0].id], "up");
  assert.equal(byStatus[59].status, "disabled");
});

test("fixtures: only where FIXTURES=1; the picker and /idps render 500 providers", async () => {
  const h = await setup();
  assert.doesNotMatch(await (await get(h, "/idps?fixture=500")).text(), /fx-499/, "production ignores ?fixture");
  assert.equal((await get(h, "/fixture/picker?n=500")).status, 404);
  h.env.FIXTURES = "1";
  const t0 = performance.now();
  const page = await (await get(h, "/fixture/picker?n=500")).text();
  const ms = performance.now() - t0;
  assert.equal((page.match(/role="option"/g) || []).length, 500);
  assert.equal((page.match(/data-more hidden/g) || []).length, 494);
  assert.match(page, /id="show-all" role="button" aria-controls="idp-list" aria-expanded="false"/);
  assert.match(page, /role="combobox" aria-controls="idp-list"/);
  assert.match(page, /<span class="logo tile" aria-hidden="true">/, "monogram when there is no logo");
  assert.match(page, /<img src="\/logos\/fx\.00000000\.png" width="28" height="28" alt="[^"]+" loading="lazy"/);
  assert.ok(ms < 500, `server render ${ms.toFixed(0)} ms`);
  const idps = await (await get(h, "/idps?fixture=500")).text();
  assert.equal((idps.match(/class="idrow"/g) || []).length, 500);
  assert.equal((await get(h, "/logos/fx.00000000.png")).status, 200);
  assert.match(await (await get(h, "/fixture/picker?n=0")).text(), /class="empty"/);
});

test("base stylesheet: linked by default; omitted when the platform ships it", async () => {
  const { baseStylesheet } = await import("../src/ui/pages.js");
  const { replacesBaseStylesheet } = await import("../src/platform/index.js");
  assert.equal(replacesBaseStylesheet, false);
  assert.match(baseStylesheet(false), /^<link rel="stylesheet" href="\/assets\/roamid\.[0-9a-f]+\.css">$/);
  assert.equal(baseStylesheet(true), "");
  const h = await setup();
  assert.match(await (await h.request("/idps")).text(), /<link rel="stylesheet" href="\/assets\/roamid\.[0-9a-f]+\.css">/);
});
