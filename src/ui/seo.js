// Search engines: which pages are public, their URLs in each language, the
// <head> they carry (title, description, canonical, hreflang, Open Graph,
// JSON-LD), the sitemap and robots.txt. Every page not listed here is
// "noindex", and so is everything on the origin host behind Orbit Shield.
//
// Language URLs: English at /..., Chinese at /zh/... (the home page at /zh/).
// ".html", ".md", a trailing slash and ?lang= on a public page answer 301 to
// that form; Accept-Language and the language cookie never change the
// language of a public URL.

import { ASSETS } from "./manifest.js";
import { DOCS } from "./docs-content.js";

export const REPO = "https://github.com/FadianRoam/roamid";
export const LAB_URL = "https://yunzheng.space/";
const LAB_ORG = "https://yunzheng.space/#org";
export const INDEXNOW_KEY = "5bf9dafab1edce7982b4fcd02c240d27";

// The public name, from BASE_URL (set once per request by the Worker).
let BASE = "https://id.fadianro.am";
export function configure(env) { if (env && env.BASE_URL) BASE = String(env.BASE_URL).replace(/\/+$/, ""); }
export const base = () => BASE;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- public pages ---------------------------------------------------------------------
// lastmod: a date for hand-written pages (update it when their text changes),
// "registry" for pages built from the registry, null for live data.

const PAGES = {
  "/": {
    title: { en: "RoamID: Community Identity Broker for OpenID Connect and SAML", zh: "RoamID：OpenID Connect 与 SAML 社区身份中转" },
    desc: {
      en: "RoamID connects applications to community identity providers. An application integrates once with OpenID Connect or SAML; users sign in with any listed provider.",
      zh: "RoamID 连接应用与社区身份提供方。应用通过 OpenID Connect 或 SAML 接入一次，用户即可使用公开登记表中的任一身份提供方登录。",
    },
    lastmod: "2026-10-08", priority: "1.0",
  },
  "/idps": {
    title: { en: "Identity Providers in the RoamID Registry", zh: "RoamID 登记的社区身份提供方" },
    desc: {
      en: "Community identity providers listed in the public RoamID registry, with issuer, email domains and current health. Providers join the registry by pull request.",
      zh: "RoamID 公开登记表中的社区身份提供方，含签发者、邮箱域名与当前健康状态。身份提供方通过拉取请求加入登记表。",
    },
    lastmod: "registry", priority: "0.8",
  },
  "/apps": {
    title: { en: "Applications Using RoamID", zh: "接入 RoamID 的应用" },
    desc: {
      en: "Applications registered with RoamID, with their domain and protocol. Each application has a public page and a link to report it.",
      zh: "已在 RoamID 注册并通过域名证明的应用，含域名与协议。每个应用都有公开页面，页面上可以举报该应用。",
    },
    lastmod: "registry", priority: "0.6",
  },
  "/docs": {
    title: { en: "RoamID Documentation", zh: "RoamID 文档" },
    desc: {
      en: "RoamID specifications and guides: integrating an application, identity provider requirements, the registry, the acceptable use policy, error codes and operations.",
      zh: "RoamID 规范与指南：应用接入、身份提供方要求、登记表、可接受使用政策、错误码与运维。",
    },
    lastmod: "docs", priority: "0.8",
  },
  "/status": {
    title: { en: "RoamID Status: Registry, Provider Health and Keys", zh: "RoamID 状态：登记表、身份提供方与密钥" },
    desc: {
      en: "Current state of RoamID: registry synchronisation, identity provider health, domain proofs, signing keys and sign-in counts.",
      zh: "RoamID 当前状态：登记表同步、身份提供方健康状态、域名证明、签名密钥与登录次数。",
    },
    lastmod: null, priority: "0.4",
  },
  "/demo": {
    title: { en: "RoamID Demo: Sign In with a Community Identity Provider", zh: "RoamID 演示：用社区身份提供方登录" },
    desc: {
      en: "Sign in through RoamID with a listed identity provider and see the ID token claims and the userinfo response that an application receives.",
      zh: "通过 RoamID 用登记表中的身份提供方登录，查看应用收到的 ID 令牌声明与 userinfo 响应。",
    },
    lastmod: "2026-10-08", priority: "0.6",
  },
  "/report": {
    title: { en: "Report an Application or Identity Provider · RoamID", zh: "举报应用或身份提供方 · RoamID" },
    desc: {
      en: "Report an application or identity provider that uses RoamID for phishing, impersonation, fraud, malware or illegal content. The operator reviews each report.",
      zh: "举报利用 RoamID 进行钓鱼、冒充、诈骗、传播恶意软件或违法内容的应用或身份提供方。运营方会审核每一条举报。",
    },
    lastmod: "2026-10-08", priority: "0.3",
  },
};

// Hand-written descriptions of the documents; others use their first paragraph.
const DOC_DESC = {
  "rp-integration": {
    en: "How an application integrates RoamID with OpenID Connect or SAML: registration, endpoints, token requests, claims, account linking, errors and code examples.",
    zh: "应用如何通过 OpenID Connect 或 SAML 接入 RoamID：注册、端点、授权与令牌请求、声明、账户关联、错误与示例。",
  },
  "idp-requirements": {
    en: "What an identity provider must support to be listed in the RoamID registry: OpenID Connect or SAML, client authentication, claims, email domains and health checks.",
    zh: "身份提供方进入 RoamID 登记表需要支持的内容：OpenID Connect 或 SAML、客户端认证、声明、邮箱域名与健康检查。",
  },
  registry: {
    en: "The RoamID registry: the public JSON files for identity providers and applications, permanent identifiers, review by pull request and automated checks.",
    zh: "RoamID 登记表：身份提供方与应用的公开 JSON 文件、永久标识符、拉取请求审核与自动检查。",
  },
  policy: {
    en: "RoamID acceptable use policy for applications and identity providers, how reports are handled, the actions the operator takes and how to appeal.",
    zh: "RoamID 对应用与身份提供方的可接受使用政策、举报处理方式、运营方采取的措施与申诉流程。",
  },
  errors: { en: "Every RoamID error code, the message shown on the error page and the error_description sent to the application, with the cause of each." },
  conformance: { en: "How RoamID is tested against the OpenID Connect specifications: the conformance script, the checks it runs and the current results." },
  operations: { en: "How to run a RoamID instance on Cloudflare Workers: deployment, secrets, key rotation, SAML certificates, reports, emergency actions and scheduled tasks." },
};

const docBySlug = new Map(DOCS.map((d) => [d.slug, d]));
// A document's description: hand-written, or its first paragraph.
export const docDesc = (doc, lang) => (DOC_DESC[doc.slug] || {})[lang] || clip(doc[lang].summary || doc[lang].title, lang === "zh" ? 120 : 160);

// The page (by its English path, without query) and the languages it has.
// `index: false` pages take part in the language URLs but are not indexed.
export function langPage(p) {
  if (PAGES[p]) return { kind: p === "/docs" ? "docs-index" : "page", langs: ["en", "zh"], index: true };
  const d = /^\/docs\/([a-z0-9-]+)$/.exec(p);
  if (d && docBySlug.has(d[1])) return { kind: "doc", doc: docBySlug.get(d[1]), langs: docBySlug.get(d[1]).zh ? ["en", "zh"] : ["en"], index: true };
  if (/^\/apps\/[a-z0-9-]{2,64}$/.test(p)) return { kind: "app", langs: ["en", "zh"], index: false };
  return null;
}

// /x in a language: /x, /zh/x; the home page is / and /zh/.
export const langPath = (lang, p) => (lang === "zh" ? (p === "/" ? "/zh/" : `/zh${p}`) : p);
// A link to a page in a language: language URL when the page has one.
export function href(lang, p) {
  const [path, q] = p.split("?");
  const pg = langPage(path);
  return pg && pg.langs.includes(lang) ? langPath(lang, path) + (q ? `?${q}` : "") : p;
}

// GET/HEAD: the canonical form of a request URL. Returns { redirect } (a
// path, to answer 301 at the public name), { lang, path } for a public page
// (route it as `path` in `lang`), { notFound } for /zh/ + a page that has no
// language URL, or null when the path is not a language page.
export function canonicalize(url) {
  let p = url.pathname, lang = "en", prefixed = false;
  if (p === "/zh" || p.startsWith("/zh/")) { lang = "zh"; prefixed = true; p = p.slice(3) || "/"; }
  let rest = p.replace(/\/index\.html?$/, "/");
  if (rest !== "/") rest = rest.replace(/\.(html?|md)$/, "").replace(/\/+$/, "") || "/";
  const page = langPage(rest);
  if (!page) return prefixed ? { notFound: true } : null;
  const q = new URLSearchParams(url.search);
  if (q.has("lang")) { const ql = q.get("lang"); q.delete("lang"); if (ql === "zh" || ql === "en") lang = ql; }
  if (!page.langs.includes(lang)) lang = page.langs[0];
  const qs = q.toString();
  const target = langPath(lang, rest) + (qs ? `?${qs}` : "");
  if (target !== url.pathname + url.search) return { redirect: target };
  return { lang, path: rest };
}

// The page a rendered path stands for. Pages reached through canonicalize()
// are rendered with "?lang=" in their path; error pages and everything else
// are not, and stay noindex.
export function pageOf(path, lang) {
  if (!path) return null;
  let u;
  try { u = new URL(path, "https://x.invalid"); } catch { return null; }
  if (u.searchParams.get("lang") !== lang) return null;
  const pg = langPage(u.pathname);
  if (!pg || !pg.langs.includes(lang)) return null;
  const q = new URLSearchParams(u.search);
  q.delete("lang");
  const qs = q.toString();
  return { ...pg, path: u.pathname, lang, self: langPath(lang, u.pathname) + (qs ? `?${qs}` : "") };
}

// ---- titles and descriptions ----------------------------------------------------------

const BRAND = " · RoamID";
const width = (s) => [...s].reduce((n, c) => n + (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(c) ? 2 : 1), 0);
const fits = (s, lang) => width(s) <= 75 && [...s].length <= (lang === "zh" ? 40 : 65);
const withBrand = (t, lang) => (fits(t + BRAND, lang) ? t + BRAND : t);
const clip = (s, n) => {
  const chars = [...s];
  if (chars.length <= n) return s;
  const cut = chars.slice(0, n - 1).join("");
  const sp = cut.lastIndexOf(" ");
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:，。；：、]+$/, "")}…`;
};

export function meta(pg) {
  const { lang } = pg;
  if (pg.kind === "doc") {
    const d = pg.doc[lang];
    const desc = docDesc(pg.doc, lang);
    return { title: withBrand(d.title, lang), desc, updated: d.updated };
  }
  const m = PAGES[pg.path];
  return { title: m.title[lang], desc: m.desc[lang] };
}

// ---- <head> ---------------------------------------------------------------------------

const ogImage = (lang) => ({ url: BASE + ASSETS[`og-${lang}.png`], alt: lang === "zh" ? "RoamID 登录选择页示意：社区身份提供方列表" : "RoamID sign-in screen with a list of community identity providers" });
const abs = (p) => BASE + p;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const ORG = () => ({ "@type": "Organization", "@id": `${BASE}/#org`, name: "RoamID", url: `${BASE}/`, logo: abs(ASSETS["og-en.png"]), sameAs: [REPO], parentOrganization: { "@id": LAB_ORG } });

function crumbs(pg, title) {
  const zh = pg.lang === "zh";
  const items = [{ name: "RoamID", url: abs(langPath(pg.lang, "/")) }];
  if (pg.kind === "doc") items.push({ name: zh ? "文档" : "Documentation", url: abs(langPath(pg.lang, "/docs")) });
  items.push({ name: title, url: abs(langPath(pg.lang, pg.path)) });
  return { "@type": "BreadcrumbList", itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: x.url })) };
}

function jsonLd(pg, m, extra) {
  const zh = pg.lang === "zh";
  const url = abs(langPath(pg.lang, pg.path));
  const inLanguage = zh ? "zh-CN" : "en";
  const site = { "@id": `${BASE}/#website` };
  if (pg.path === "/") {
    return ld({ "@context": "https://schema.org", "@graph": [
      { "@type": "WebSite", "@id": `${BASE}/#website`, url: `${BASE}/`, name: "RoamID", description: m.desc, inLanguage: ["en", "zh-CN"], publisher: { "@id": `${BASE}/#org` } },
      ORG(),
    ] });
  }
  const graph = [];
  if (pg.kind === "doc") {
    const d = pg.doc[pg.lang];
    graph.push({ "@type": "TechArticle", headline: d.title, description: m.desc, url, inLanguage, ...(d.updated ? { dateModified: d.updated } : {}), isPartOf: site, author: { "@id": `${BASE}/#org` }, publisher: { "@id": `${BASE}/#org` }, image: ogImage(pg.lang).url, mainEntityOfPage: url });
    graph.push(crumbs(pg, d.title));
  } else if (pg.path === "/idps" && extra && extra.idps) {
    graph.push({ "@type": "ItemList", name: m.title, url, numberOfItems: extra.idps.length, itemListElement: extra.idps.map((i, k) => ({ "@type": "ListItem", position: k + 1, name: i.name, ...(i.url ? { url: i.url } : {}) })) });
    graph.push(crumbs(pg, PAGES[pg.path].title[pg.lang].replace(BRAND, "")));
  } else {
    graph.push({ "@type": "WebPage", name: m.title, description: m.desc, url, inLanguage, isPartOf: site });
    graph.push(crumbs(pg, m.title.replace(BRAND, "")));
  }
  return ld({ "@context": "https://schema.org", "@graph": graph });
}

// The SEO part of <head> for a page from pageOf(); `extra.idps` feeds the
// ItemList on /idps. Returns { title, tags }.
export function head(pg, extra = {}) {
  const m = meta(pg);
  const self = abs(langPath(pg.lang, pg.path));
  const img = ogImage(pg.lang);
  const tags = [
    `<meta name="description" content="${esc(m.desc)}">`,
    pg.index ? `<meta name="robots" content="index, follow, max-image-preview:large">` : `<meta name="robots" content="noindex">`,
    `<link rel="canonical" href="${esc(self)}">`,
  ];
  if (pg.langs.length === 2) {
    for (const [hl, l] of [["en", "en"], ["zh-CN", "zh"], ["x-default", "en"]]) tags.push(`<link rel="alternate" hreflang="${hl}" href="${esc(abs(langPath(l, pg.path)))}">`);
  }
  tags.push(
    `<meta property="og:type" content="${pg.kind === "doc" ? "article" : "website"}">`,
    `<meta property="og:site_name" content="RoamID">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.desc)}">`,
    `<meta property="og:url" content="${esc(self)}">`,
    `<meta property="og:locale" content="${pg.lang === "zh" ? "zh_CN" : "en_US"}">`,
    ...(pg.langs.length === 2 ? [`<meta property="og:locale:alternate" content="${pg.lang === "zh" ? "en_US" : "zh_CN"}">`] : []),
    `<meta property="og:image" content="${esc(img.url)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(img.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.desc)}">`,
    `<meta name="twitter:image" content="${esc(img.url)}">`,
    `<meta name="twitter:image:alt" content="${esc(img.alt)}">`,
  );
  if (pg.index) tags.push(jsonLd(pg, m, extra));
  return { title: m.title, tags: tags.join("\n") };
}

// ---- sitemap and robots.txt ------------------------------------------------------------

const day = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)) ? String(s).slice(0, 10) : null);

// `registryDate`: the date the registry was generated (a commit on main).
export function sitemapXml({ registryDate } = {}) {
  const docsDate = DOCS.map((d) => [d.en.updated, d.zh && d.zh.updated]).flat().filter(Boolean).sort().pop() || null;
  const entries = [];
  for (const [p, m] of Object.entries(PAGES)) {
    const lastmod = m.lastmod === "registry" ? day(registryDate) : m.lastmod === "docs" ? docsDate : m.lastmod;
    entries.push({ p, langs: ["en", "zh"], lastmod: () => lastmod, priority: m.priority, image: p === "/" });
  }
  for (const d of DOCS) entries.push({ p: `/docs/${d.slug}`, langs: d.zh ? ["en", "zh"] : ["en"], lastmod: (l) => d[l].updated, priority: "0.7" });
  const urls = [];
  for (const e of entries) {
    for (const l of e.langs) {
      const alts = e.langs.length === 2 ? [["en", "en"], ["zh-CN", "zh"], ["x-default", "en"]].map(([hl, x]) => `<xhtml:link rel="alternate" hreflang="${hl}" href="${esc(abs(langPath(x, e.p)))}"/>`).join("") : "";
      const lm = e.lastmod(l);
      const img = e.image ? `<image:image><image:loc>${esc(abs(ASSETS[`og-${l}.png`]))}</image:loc></image:image>` : "";
      urls.push(`  <url><loc>${esc(abs(langPath(l, e.p)))}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ""}<priority>${e.priority}</priority>${alts}${img}</url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urls.join("\n")}
</urlset>
`;
}

// Paths that are never indexed. Robots only stops crawling: the pages carry
// noindex themselves as well.
const DISALLOW = ["/authorize", "/select", "/callback/", "/token", "/userinfo", "/logout", "/saml/", "/test", "/demo/callback", "/demo/saml", "/console", "/admin", "/prefs"];
export function robotsTxt({ origin = false } = {}) {
  // The origin name: crawlable, so that its noindex header is seen.
  if (origin) return "User-agent: *\nDisallow:\n";
  return `User-agent: *\n${DISALLOW.map((p) => `Disallow: ${p}`).join("\n")}\n\nSitemap: ${BASE}/sitemap.xml\nSitemap: https://yunzheng.space/sitemap-all.xml\n`;
}

// A request that reached the Worker on its origin name rather than through
// Orbit Shield (which sends X-Forwarded-Host with the public name).
export function onOrigin(request) {
  const pub = new URL(BASE).host;
  const u = new URL(request.url);
  return u.host !== pub && String(request.headers.get("X-Forwarded-Host") || "").trim().toLowerCase() !== pub;
}

// ---- footer ---------------------------------------------------------------------------

export const POWERED = { en: ["Powered by", ""], zh: ["由", "提供支持"] };
