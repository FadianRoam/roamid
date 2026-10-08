// Search engine rules over the rendered public pages (every URL the sitemap
// lists, in both languages), the language URLs and their redirects, noindex
// on everything else and on the origin name, robots.txt, the sitemap, and the
// "Powered by YunZheng LAB" footer on every page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, BASE, pkce } from "./_harness.mjs";
import { buildDocs } from "../scripts/build-docs.mjs";

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
const width = (s) => [...s].reduce((n, c) => n + (CJK.test(c) ? 2 : 1), 0);
const BAD_ZH = /[㐀-鿿][,.:;?!()]|[,:;?!()][㐀-鿿]/;
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (html, re) => { const m = re.exec(html); return m ? unesc(m[1]) : null; };
const metaName = (html, n) => attr(html, new RegExp(`<meta name="${n}" content="([^"]*)">`));
const metaProp = (html, n) => attr(html, new RegExp(`<meta property="${n}" content="([^"]*)">`));

function footerOk(html, where) {
  const f = /<footer class="foot">([\s\S]*?)<\/footer>/.exec(html);
  assert.ok(f, `${where}: footer`);
  assert.match(f[1], /<a class="powered" href="https:\/\/yunzheng\.space\/">/, `${where}: powered-by link`);
  const img = /<img [^>]*>/.exec(f[1].slice(f[1].indexOf("powered")));
  assert.ok(img, `${where}: logo`);
  for (const a of [/alt="YunZheng LAB"/, /width="\d+"/, /height="\d+"/, /loading="lazy"/, /src="\/assets\/lab-logo\.[0-9a-f]{10}\.png"/]) assert.match(img[0], a, `${where}: logo ${a}`);
  assert.match(f[1], /srcset="\/assets\/lab-logo\.[0-9a-f]{10}\.webp"/, `${where}: webp`);
}

function headings(html) {
  const body = html.slice(html.indexOf("<body"));
  return [...body.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
}

test("every page in the sitemap: title, description, headings, canonical, hreflang, Open Graph, JSON-LD, footer", async () => {
  const h = await setup();
  const sm = await h.request("/sitemap.xml");
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get("Content-Type"), /xml/);
  const xml = await sm.text();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<\?xml-stylesheet type="text\/xsl" href="\/sitemap\.xsl"\?>\n<urlset /);
  for (const ns of ['xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"', 'xmlns:xhtml="http://www.w3.org/1999/xhtml"', 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"', 'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"']) assert.ok(xml.includes(ns), ns);
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: /<loc>([^<]+)<\/loc>/.exec(m[1])[1],
    lastmod: (/<lastmod>([^<]+)<\/lastmod>/.exec(m[1]) || [])[1],
    alts: Object.fromEntries([...m[1].matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map((x) => [x[1], x[2]])),
  }));
  const locs = entries.map((e) => e.loc);
  for (const p of ["/", "/zh/", "/idps", "/zh/idps", "/apps", "/zh/apps", "/status", "/zh/status", "/demo", "/zh/demo", "/report", "/zh/report", "/docs", "/zh/docs", "/docs/rp-integration", "/zh/docs/rp-integration", "/docs/errors"]) assert.ok(locs.includes(BASE + p), `sitemap lists ${p}`);
  assert.ok(!locs.includes(`${BASE}/zh/docs/errors`), "no Chinese URL for an English-only document");
  assert.equal(new Set(locs).size, locs.length);
  const titles = new Set(), descs = new Set();
  for (const e of entries) {
    const path = e.loc.slice(BASE.length);
    if (e.lastmod) assert.match(e.lastmod, /^\d{4}-\d{2}-\d{2}$/, path);
    const res = await h.request(path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    const zh = /<html lang="zh-CN"/.test(html);
    assert.equal(zh, path.startsWith("/zh/"), `${path}: language of the URL`);
    const title = attr(html, /<title>([^<]*)<\/title>/);
    assert.ok(title, `${path}: title`);
    assert.ok(width(title) <= 75, `${path}: title width ${width(title)}`);
    assert.ok([...title].length <= (zh ? 40 : 65), `${path}: title ${[...title].length} chars`);
    assert.ok(!titles.has(title), `${path}: title unique`); titles.add(title);
    const desc = metaName(html, "description");
    assert.ok(desc && [...desc].length >= (zh ? 30 : 70), `${path}: description`);
    assert.ok([...desc].length <= (zh ? 120 : 165), `${path}: description ${[...desc].length} chars`);
    assert.ok(!descs.has(desc), `${path}: description unique`); descs.add(desc);
    if (zh) { assert.ok(!BAD_ZH.test(title), `${path}: title punctuation`); assert.ok(!BAD_ZH.test(desc), `${path}: description punctuation`); }
    assert.match(metaName(html, "robots"), /^index/, `${path}: robots`);
    const hs = headings(html);
    assert.equal(hs.filter((x) => x === 1).length, 1, `${path}: one h1`);
    assert.equal(hs[0], 1, `${path}: h1 first`);
    hs.forEach((x, i) => { if (i) assert.ok(x <= hs[i - 1] + 1, `${path}: heading h${hs[i - 1]} -> h${x}`); });
    for (const img of html.match(/<img\b[^>]*>/g) || []) assert.match(img, /\balt="/, `${path}: ${img}`);
    assert.equal(attr(html, /<link rel="canonical" href="([^"]+)">/), e.loc, `${path}: canonical`);
    const alts = Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((x) => [x[1], x[2]]));
    assert.deepEqual(alts, e.alts, `${path}: hreflang matches the sitemap`);
    if (Object.keys(alts).length) {
      assert.deepEqual(Object.keys(alts).sort(), ["en", "x-default", "zh-CN"], `${path}: hreflang triple`);
      assert.ok(Object.values(alts).includes(e.loc), `${path}: hreflang names itself`);
      const twin = zh ? alts.en : alts["zh-CN"];
      assert.ok(html.includes(`class="tool lang-switch" href="${twin.slice(BASE.length)}"`), `${path}: language switch goes to ${twin}`);
    }
    assert.equal(metaProp(html, "og:url"), e.loc, `${path}: og:url`);
    for (const k of ["og:type", "og:site_name", "og:title", "og:description", "og:image:alt", "og:locale"]) assert.ok(metaProp(html, k), `${path}: ${k}`);
    assert.match(metaProp(html, "og:image"), new RegExp(`^${BASE}/assets/og-(en|zh)\\.[0-9a-f]{10}\\.png$`), `${path}: og:image on this origin`);
    assert.equal(metaProp(html, "og:image:width"), "1200");
    assert.equal(metaProp(html, "og:image:height"), "630");
    assert.equal(metaName(html, "twitter:card"), "summary_large_image");
    for (const k of ["twitter:title", "twitter:description", "twitter:image"]) assert.ok(metaName(html, k), `${path}: ${k}`);
    const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.ok(lds.length, `${path}: JSON-LD`);
    const types = lds.flatMap((x) => (x["@graph"] || [x]).map((n) => n["@type"]));
    const bare = path.replace(/^\/zh(\/|$)/, "/");
    if (bare === "/") {
      assert.deepEqual(types.sort(), ["Organization", "WebSite"], path);
      const org = lds[0]["@graph"].find((n) => n["@type"] === "Organization");
      assert.deepEqual(org.parentOrganization, { "@id": "https://yunzheng.space/#org" });
      assert.equal(org.name, "RoamID");
    } else if (bare === "/idps") {
      assert.ok(types.includes("ItemList"), path);
      const list = lds[0]["@graph"].find((n) => n["@type"] === "ItemList");
      assert.ok(list.itemListElement.length >= 1, `${path}: ItemList items`);
    } else if (bare.startsWith("/docs/")) {
      assert.ok(types.includes("TechArticle") && types.includes("BreadcrumbList"), `${path}: ${types}`);
    } else assert.ok(types.includes("BreadcrumbList"), `${path}: ${types}`);
    assert.ok(!/origin-/.test(html), `${path}: no origin name`);
    footerOk(html, path);
  }
  assert.ok(entries.length >= 20, `${entries.length} entries`);
});

test("language URLs: other spellings answer 301 at the public name; Accept-Language changes nothing", async () => {
  const h = await setup();
  const cases = {
    "/idps.html": "/idps", "/idps/": "/idps", "/idps?lang=zh": "/zh/idps", "/zh/idps?lang=en": "/idps", "/zh/idps/": "/zh/idps", "/zh/idps.html": "/zh/idps",
    "/zh": "/zh/", "/index.html": "/", "/zh/index.html": "/zh/", "/?lang=zh": "/zh/", "/zh/?lang=en": "/",
    "/docs/": "/docs", "/docs/rp-integration.md": "/docs/rp-integration", "/zh/docs/errors": "/docs/errors", "/zh/docs/operations.html": "/docs/operations",
    "/report?app=spa&lang=zh": "/zh/report?app=spa", "/status.html?lang=en": "/status",
  };
  for (const [from, to] of Object.entries(cases)) {
    const r = await h.request(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get("Location"), BASE + to, from);
  }
  // On the origin name: redirects still name the public host, and nothing is indexed.
  const o = await h.request("https://origin-id.example.test/idps.html");
  assert.equal(o.status, 301);
  assert.equal(o.headers.get("Location"), `${BASE}/idps`);
  assert.match(o.headers.get("X-Robots-Tag"), /noindex/);
  const op = await h.request("https://origin-id.example.test/idps");
  assert.equal(op.status, 200);
  assert.match(op.headers.get("X-Robots-Tag"), /noindex/);
  assert.match(await op.text(), new RegExp(`<link rel="canonical" href="${BASE}/idps">`));
  const viaShield = await h.request("https://origin-id.example.test/idps", { headers: { "X-Forwarded-Host": new URL(BASE).host } });
  assert.equal(viaShield.headers.get("X-Robots-Tag"), null);
  assert.equal((await h.request("/idps")).headers.get("X-Robots-Tag"), null);
  // Accept-Language and the language cookie do not change a public URL.
  for (const headers of [{ "Accept-Language": "zh-CN,zh;q=0.9" }, { Cookie: "__Host-rid_lang=zh" }]) {
    const r = await h.request("/idps", { headers, cookies: false });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<html lang="en"/);
  }
  assert.equal((await h.request("/zh/console")).status, 404);
  assert.equal((await h.request("/zh/docs/no-such-document")).status, 404);
  // Theme switch returns to the language URL; links on a Chinese page stay Chinese.
  const zh = await (await h.request("/zh/idps")).text();
  assert.ok(zh.includes('href="/prefs?theme=light&amp;next=%2Fzh%2Fidps"'));
  for (const p of ["/zh/apps", "/zh/docs", "/zh/status", "/zh/demo", "/zh/report"]) assert.ok(zh.includes(`href="${p}"`), p);
});

test("noindex: picker, console, admin, errors, test pages, app pages; footer on all of them", async () => {
  const h = await setup();
  const pk = await pkce();
  const pages = {
    picker: `/authorize?client_id=spa&redirect_uri=${encodeURIComponent("https://rp.example.test/spa/cb")}&response_type=code&scope=openid&state=s1&nonce=n1&code_challenge=${pk.challenge}&code_challenge_method=S256`,
    console: "/console", notFound: "/no-such-page", authorizeError: "/authorize", test: "/test", demoCallback: "/demo/callback",
  };
  for (const [k, p] of Object.entries(pages)) {
    let r = await h.request(p);
    if (r.status === 303) r = await h.request(r.headers.get("Location"));
    const html = await r.text();
    assert.ok(/<html/.test(html), `${k}: html (${r.status})`);
    assert.match(metaName(html, "robots") || "", /noindex/, `${k}: noindex`);
    assert.ok(!/<link rel="canonical"/.test(html), `${k}: no canonical`);
    footerOk(html, k);
    if (k === "picker") { assert.match(html, /data-page="picker"/); assert.ok(!/class="foot-links"/.test(html), "picker: no footer links"); }
  }
});

test("robots.txt, the IndexNow key and the origin name", async () => {
  const h = await setup();
  const robots = await (await h.request("/robots.txt")).text();
  assert.ok(robots.includes(`Sitemap: ${BASE}/sitemap.xml\n`));
  assert.ok(robots.includes("Sitemap: https://yunzheng.space/sitemap-all.xml\n"));
  for (const p of ["/authorize", "/callback/", "/saml/", "/test", "/console", "/admin"]) assert.ok(robots.includes(`Disallow: ${p}\n`), p);
  for (const p of ["/report", "/idps", "/docs", "/demo\n"]) assert.ok(!robots.includes(`Disallow: ${p}`), p);
  const origin = await h.request("https://origin-id.example.test/robots.txt");
  assert.ok(!/Sitemap:/.test(await origin.text()));
  assert.match(origin.headers.get("X-Robots-Tag"), /noindex/);
  const key = await h.request("/5bf9dafab1edce7982b4fcd02c240d27.txt");
  assert.equal(await key.text(), "5bf9dafab1edce7982b4fcd02c240d27");
});

test("documents: rendered from docs/ with one h1, no skipped heading level, escaped text and site links", () => {
  const docs = buildDocs();
  assert.ok(docs.length >= 5);
  for (const d of docs) {
    for (const lang of ["en", "zh"]) {
      const x = d[lang];
      if (!x) continue;
      const hs = [...x.html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      assert.equal(hs[0], 1, `${d.slug} ${lang}`);
      assert.equal(hs.filter((n) => n === 1).length, 1, `${d.slug} ${lang}`);
      hs.forEach((n, i) => { if (i) assert.ok(n <= hs[i - 1] + 1, `${d.slug} ${lang}: h${hs[i - 1]} -> h${n}`); });
      const tags = new Set([...x.html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]));
      for (const tg of tags) assert.ok(["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "code", "pre", "ul", "ol", "li", "strong", "em", "table", "thead", "tbody", "tr", "th", "td", "div", "blockquote", "hr"].includes(tg), `${d.slug} ${lang}: <${tg}>`);
      assert.ok(!/href="(?!https:\/\/|\/|#)/.test(x.html), `${d.slug} ${lang}: relative link`);
      assert.ok(!/href="[^"]*\.md[#"]/.test(x.html.replace(/https:\/\/github\.com[^"]*/g, "")), `${d.slug} ${lang}: .md link`);
    }
  }
  const reg = docs.find((d) => d.slug === "registry");
  assert.ok(reg.en.html.includes('id="without-an-account-at-a-listed-identity-provider"'), "GitHub-compatible anchors");
});
