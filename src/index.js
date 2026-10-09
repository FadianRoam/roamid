// RoamID Worker: routing, the cron, and the public information endpoints.

import { json, html, redirect, text, cookie, now, newNonce, corsPreflight, readForm } from "./lib/http.js";
import { safeEqual } from "./lib/b64.js";
import { signingKeys, clientKeys } from "./lib/keys.js";
import { allow } from "./lib/ratelimit.js";
import { clientIp, robots, sitemap, buildMarker, responseHeaders, pages as platformPages, assetSizes } from "./platform/index.js";
import { setBase } from "./ui/pages.js";
import { SIZES } from "./ui/manifest.js";
import { summary, daily } from "./lib/events.js";
import { getRegistry, syncRegistry, serveLogo, addedMap } from "./registry/store.js";
import { fixtureCount, fixtureIdps, FIXTURE_LOGO, fixtureLogoBytes } from "./ui/fixtures.js";
import { checkDomainProofs, proofState } from "./registry/domains.js";
import { discoveryDoc, authorize, select, callback, token, userinfo, logout, healthMap, samlAcs, samlSso, samlCancel } from "./oidc/op.js";
import { spMetadataHandler } from "./saml/sp.js";
import { idpMetadataHandler } from "./saml/idp.js";
import { demoSamlStart, demoSamlAcs, demoSamlPage } from "./saml/demo.js";
import { samlKeys, certInfo } from "./saml/certs.js";
import { probeIdps } from "./health.js";
import { pickLang, pickTheme, LANG_COOKIE, THEME_COOKIE, localName, isTwinPath, isEnglishOnlyPath, localPath } from "./ui/i18n.js";
import { homePage, pickerPage, idpsPage, statusPage, errorPage } from "./ui/pages.js";
import { demoPage } from "./ui/demo.js";
import { VERSION } from "./version.js";
import { serveAssetWithRange } from "./lib/range.js";
import { handleConsole, handleApps, handleReport, handleAdmin, handleAppealApi } from "./console/routes.js";
import { handleTest } from "./console/testpage.js";
import { transparencyJson } from "./apps/transparency.js";
import { recheckApps, refreshBlocklists } from "./apps/review.js";

const PUBLIC_CACHE = "public, max-age=300";

function view(request) {
  const u = new URL(request.url);
  return { lang: pickLang(request), theme: pickTheme(request), nonce: newNonce(), path: u.pathname + u.search };
}

function publicIdp(i, health) {
  return { id: i.id, protocol: i.protocol, name: i.name, ...(i.protocol === "saml2" ? { entity_id: i.entity_id || null, metadata_url: i.metadata_url || null } : { issuer: i.issuer }), homepage: i.homepage, email_domains: i.email_domains || [], status: i.status, ...(i.note ? { note: i.note } : {}), ...(i.logo ? { logo: { url: `/logos/${i.logo.path}`, type: i.logo.type, width: i.logo.width, height: i.logo.height } } : {}), health: health[i.id] || "unknown" };
}

async function statusData(env) {
  const reg = await getRegistry(env);
  const t = now();
  const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
  const { results: proofs } = await env.DB.prepare("SELECT * FROM domain_proofs ORDER BY idp, domain").all();
  const { results: health } = await env.DB.prepare("SELECT * FROM idp_health ORDER BY idp").all();
  const keyInfo = (list, raw) => {
    let created = {};
    try { for (const k of JSON.parse(raw || "[]")) created[k.kid] = k.created || null; } catch { /* ignore */ }
    return list.keys.map((k) => ({ kid: k.kid, alg: k.alg, created: created[k.kid] || null }));
  };
  let keys = { signing: [], client: [], saml: [] };
  try { keys = { signing: keyInfo((await signingKeys(env)).jwks, env.SIGNING_KEYS), client: keyInfo((await clientKeys(env)).jwks, env.CLIENT_KEYS), saml: [] }; } catch (e) { keys.error = e.message; }
  // SAML certificates: warn 30 days before expiry. Signing and client keys
  // older than a year: a reminder to rotate (docs/operations.md).
  const warnings = [];
  for (const [kind, list] of [["signing", keys.signing], ["client", keys.client]]) {
    for (const k of list || []) if (k.created && Date.parse(k.created) / 1000 < t - 365 * 86400) warnings.push(`${kind} key ${k.kid} is older than one year (created ${k.created})`);
  }
  try {
    for (const k of samlKeys(env)) {
      const i = certInfo(k.cert);
      keys.saml.push({ kid: k.kid, alg: "RS256 X.509", created: k.created, not_after: iso(i.notAfter) });
      if (i.notAfter - t < 30 * 86400) warnings.push(`SAML certificate ${k.kid} expires ${iso(i.notAfter)}`);
    }
  } catch (e) { keys.saml_error = e.message; }
  for (const idp of reg.idps.values()) {
    if (idp.protocol !== "saml2" || !idp.certs) continue;
    for (const c of idp.certs) { try { const i = certInfo(c); if (i.notAfter - t < 30 * 86400) warnings.push(`${idp.id}: signing certificate expires ${iso(i.notAfter)}`); } catch { warnings.push(`${idp.id}: a certificate cannot be read`); } }
  }
  let samlMeta = [];
  try { samlMeta = (await env.DB.prepare("SELECT idp, fetched_at, checked_at, valid_until, last_error FROM saml_metadata ORDER BY idp").all()).results || []; } catch { /* table missing in old databases */ }
  return {
    version: VERSION,
    build: buildMarker,
    deployment: env.CF_VERSION_METADATA ? env.CF_VERSION_METADATA.id : null,
    issuer: env.BASE_URL,
    registry: {
      commit: reg.commit, generated_at: reg.generated_at || null, synced_at: iso(reg.synced_at), checked_at: iso(reg.checked_at),
      age_seconds: reg.synced_at ? t - reg.synced_at : null, last_error: reg.last_error || null,
      idps: reg.idps.size, clients: reg.clients.size, dropped: reg.dropped,
    },
    idp_health: (health || []).map((h) => ({ idp: h.idp, state: h.state, checked_at: iso(h.checked_at), last_ok: iso(h.last_ok), last_error: h.last_error })),
    domains: (proofs || []).map((p) => ({ domain: p.domain, idp: p.idp, state: proofState(p, t), verified_at: iso(p.verified_at), checked_at: iso(p.checked_at), failing_since: iso(p.failing_since), last_error: p.last_error })),
    keys,
    warnings,
    saml_metadata: samlMeta.map((m) => ({ idp: m.idp, fetched_at: iso(m.fetched_at), checked_at: iso(m.checked_at), valid_until: iso(m.valid_until), last_error: m.last_error })),
    counts: await summary(env, 7),
    daily: await daily(env, 14),
  };
}

async function adminSync(request, env) {
  if (request.method !== "POST") return json({ error: "use POST" }, { status: 405 });
  if (!(await allow(env, "admin", await clientIp(request, env)))) return json({ error: "rate_limited" }, { status: 429 });
  const authz = request.headers.get("Authorization") || "";
  const tok = /^Bearer /i.test(authz) ? authz.slice(7).trim() : "";
  if (!env.ADMIN_TOKEN || !tok || !safeEqual(tok, env.ADMIN_TOKEN)) return json({ error: "unauthorized" }, { status: 401 });
  const r = await syncRegistry(env);
  const reg = await getRegistry(env);
  const checked = await checkDomainProofs(env, reg, { force: true });
  const health = await probeIdps(env, reg);
  return json({ ...r, domains_checked: checked, health });
}

// /prefs?lang=zh|en&theme=system|light|dark&next=/path — sets the cookie and goes back.
function prefs(request) {
  const q = new URL(request.url).searchParams;
  const cookies = [];
  const lang = q.get("lang"), theme = q.get("theme");
  if (lang === "zh" || lang === "en") cookies.push(cookie(LANG_COOKIE, lang, { maxAge: 365 * 86400 }));
  if (["system", "light", "dark"].includes(theme)) cookies.push(cookie(THEME_COOKIE, theme, { maxAge: theme === "system" ? 0 : 365 * 86400 }));
  let next = q.get("next") || "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) next = "/";
  return redirect(next, { status: 303, cookies });
}

// Public pages: /path is English, /zh/path Chinese (the home pages are / and
// /zh/). .html, .md, a trailing slash, /index.html, ?lang= (other parameters
// kept) and /zh answer 301 with the canonical URL under BASE_URL (never the
// request host). /zh/ before an English-only page goes to that page; before
// anything else it is 404. Accept-Language and the cookie never change a
// public URL. Returns a Response, or the request rewritten to the inner path
// with the language in x-roamid-twin (for pickLang).
function languageRoute(request, env) {
  const url = new URL(request.url);
  const base = String(env.BASE_URL || url.origin).replace(/\/+$/, "");
  const headers = new Headers(request.headers);
  headers.delete("x-roamid-twin");
  const cleaned = () => (request.headers.has("x-roamid-twin") ? new Request(request.url, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual" }) : request);
  if (request.method !== "GET" && request.method !== "HEAD") return cleaned();
  const p = url.pathname;
  const zh = p === "/zh" || p.startsWith("/zh/");
  let inner = zh ? p.slice(3) || "/" : p;
  let moved = p === "/zh";
  const strip = (x) => {
    let y = x;
    if (/\/index\.html?$/.test(y)) y = y.replace(/\/index\.html?$/, "/");
    else if (/\.(html?|md)$/.test(y) && y.length > 1) y = y.replace(/\.(html?|md)$/, "");
    if (y.length > 1 && y.endsWith("/")) y = y.replace(/\/+$/, "") || "/";
    return y || "/";
  };
  const s = strip(inner);
  if (s !== inner) { inner = s; moved = true; }
  const q = url.searchParams.get("lang");
  if (q !== null) url.searchParams.delete("lang");
  const qs = url.searchParams.toString() ? `?${url.searchParams}` : "";
  if (!isTwinPath(inner)) {
    if (zh && isEnglishOnlyPath(inner)) return Response.redirect(`${base}${inner}${qs}`, 301);
    if (zh) return null;
    return moved ? Response.redirect(`${base}${inner}${qs}`, 301) : cleaned();
  }
  const lang = q === "zh" || q === "en" ? q : zh ? "zh" : "en";
  if (moved || q !== null) return Response.redirect(`${base}${localPath(lang, inner)}${qs}`, 301);
  headers.set("x-roamid-twin", lang);
  url.pathname = inner;
  return new Request(url.href, { method: request.method, headers, redirect: "manual" });
}

export async function handle(request, env, ctx) {
  const routed = languageRoute(request, env);
  if (routed instanceof Response) return routed;
  if (routed === null) { const v = view(request); return html(errorPage({ ...v, path: "/", code: "not_found", requestId: request.headers.get("CF-Ray") || "-" }), { status: 404, nonce: v.nonce }); }
  request = routed;
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;
  if (p.startsWith("/video/") && p.endsWith(".mp4") && env.ASSETS && (m === "GET" || m === "HEAD")) return serveAssetWithRange(request, env, { ...SIZES, ...(assetSizes || {}) });
  if (p === "/.well-known/openid-configuration") return m === "OPTIONS" ? corsPreflight() : json(discoveryDoc(env), { cache: PUBLIC_CACHE, cors: true });
  if (p === "/jwks.json") return json((await signingKeys(env)).jwks, { cache: PUBLIC_CACHE, cors: true });
  if (p === "/client-jwks.json") return json((await clientKeys(env)).jwks, { cache: PUBLIC_CACHE, cors: true });
  if (p === "/authorize" && (m === "GET" || m === "POST")) return authorize(request, env);
  if (p === "/select" && (m === "GET" || m === "POST")) return select(request, env);
  if (p.startsWith("/callback/") && m === "GET") return callback(request, env, decodeURIComponent(p.slice(10)));
  if (p === "/token") return token(request, env);
  if (p === "/userinfo") return userinfo(request, env);
  if (p === "/logout" && (m === "GET" || m === "POST")) return logout(request, env);
  if (p === "/admin/sync") return adminSync(request, env);
  if (p === "/admin/appeal") return handleAppealApi(request, env);
  if (p === "/saml/sp/metadata.xml" && m === "GET") return spMetadataHandler(request, env);
  if (p === "/saml/idp/metadata.xml" && m === "GET") return idpMetadataHandler(env);
  if (p === "/saml/idp/sso" && (m === "GET" || m === "POST")) return samlSso(request, env);
  if (p === "/saml/idp/cancel" && m === "GET") return samlCancel(request, env);
  if (p.startsWith("/saml/acs/")) return samlAcs(request, env, decodeURIComponent(p.slice(10)));
  if (p === "/demo/saml/start" && m === "GET") return demoSamlStart(env);
  if (p === "/demo/saml/acs" && m === "POST") return demoSamlAcs(request, env, view(request));
  if (p === "/prefs" && m === "GET") return prefs(request);
  if (p === "/console" || p.startsWith("/console/")) { const r = await handleConsole(request, env, p); if (r) return r; }
  if (p === "/report") { const r = await handleReport(request, env); if (r) return r; }
  if (p === "/admin") return new Response(null, { status: 302, headers: { Location: "/admin/reports" } });
  if (p === "/admin/reports" || p.startsWith("/admin/target")) { const r = await handleAdmin(request, env, p); if (r) return r; }
  if ((p === "/apps" || p === "/apps.json" || p.startsWith("/apps/")) && (m === "GET" || m === "HEAD")) { const r = await handleApps(request, env, p); if (r) return r; }
  if (m !== "GET" && m !== "HEAD") return json({ error: "method_not_allowed" }, { status: 405 });
  if (p === "/idps.json") {
    const reg = await getRegistry(env);
    const health = await healthMap(env);
    return json({ commit: reg.commit, idps: [...reg.idps.values()].map((i) => publicIdp(i, health)) }, { cache: "public, max-age=60", cors: true });
  }
  if (p === "/status.json") return json(await statusData(env), { cors: true });
  if (p === "/transparency.json") return transparencyJson(env, url);
  if (p === `/logos/${FIXTURE_LOGO}` && env.FIXTURES === "1") return new Response(fixtureLogoBytes(), { headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff" } });
  if (p.startsWith("/logos/") && (m === "GET" || m === "HEAD")) return serveLogo(env, p);
  const v = view(request);
  if (p === "/") {
    const reg = await getRegistry(env);
    return html(homePage({ ...v, idps: [...reg.idps.values()].filter((i) => i.status === "active"), health: await healthMap(env) }));
  }
  if (p === "/idps") {
    // ?fixture=<n> (synthetic providers) only where FIXTURES=1 (local and preview builds).
    const fx = fixtureCount(env, url);
    if (fx != null) { const f = fixtureIdps(fx); return html(idpsPage({ ...v, idps: f.idps, health: f.health, added: f.added, sort: url.searchParams.get("sort"), fixture: fx }), { nonce: v.nonce }); }
    const reg = await getRegistry(env);
    return html(idpsPage({ ...v, idps: [...reg.idps.values()].filter((i) => i.status !== "disabled" || i.override), health: await healthMap(env), added: await addedMap(env), sort: url.searchParams.get("sort") }), { nonce: v.nonce });
  }
  if (p === "/fixture/picker" && fixtureCount(env, url) != null) {
    const n = fixtureCount(env, url), f = fixtureIdps(n);
    return html(pickerPage({ ...v, tx: "fixture", client: { client_id: "fixture", name: { en: "Fixture Portal", zh: "测试门户" }, domain: "portal.example.com", builtin: true }, redirectUri: "https://portal.example.com/cb", idps: f.idps, health: f.health, last: url.searchParams.get("last"), hint: url.searchParams.get("hint"), cancelUrl: "/", showAll: url.searchParams.get("all") === "1" }));
  }
  if (p === "/status") return html(statusPage({ ...v, s: await statusData(env) }), { nonce: v.nonce });
  if (p === "/demo" || p === "/demo/callback") return html(demoPage(v));
  if (p === "/demo/saml") return demoSamlPage(v);
  if (p === "/test" || p.startsWith("/test/")) { if (!(await allow(env, "authorize", await clientIp(request, env)))) return html(errorPage({ ...v, path: "/", code: "rate_limited", requestId: "-" }), { status: 429 }); const r = await handleTest(request, env, p, v); if (r) return r; }
  if (p === "/robots.txt") return text(robots({ base: env.BASE_URL }), { cache: PUBLIC_CACHE });
  if (p === "/sitemap.xml") { const x = await sitemap({ env, base: env.BASE_URL }); if (x) return new Response(x, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": PUBLIC_CACHE } }); }
  if (p === "/favicon.ico") return new Response(null, { status: 204, headers: { "Cache-Control": PUBLIC_CACHE } });
  { const r = await platformPages(p, { request, env, lang: v.lang, theme: v.theme, query: url.search, base: env.BASE_URL }); if (r) return r; }
  return html(errorPage({ ...v, path: "/", code: "not_found", requestId: request.headers.get("CF-Ray") || "-" }), { status: 404, nonce: v.nonce });
}

export async function scheduled(env) {
  const t = now();
  await syncRegistry(env).catch((e) => console.error("[cron] sync", e && e.message));
  const reg = await getRegistry(env);
  await checkDomainProofs(env, reg).catch((e) => console.error("[cron] domains", e && e.message));
  await probeIdps(env, reg).catch((e) => console.error("[cron] health", e && e.message));
  await recheckApps(env).catch((e) => console.error("[cron] apps", e && e.message));
  await refreshBlocklists(env).catch((e) => console.error("[cron] blocklists", e && e.message));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tx WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM codes WHERE expires <= ?").bind(t - 3600),
    env.DB.prepare("DELETE FROM tokens WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM ratelimit WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM jti WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM console_sessions WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM app_invites WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM events WHERE day < ?").bind(new Date((t - 400 * 86400) * 1000).toISOString().slice(0, 10)),
  ]);
}

const withHeaders = (r, extra) => { const h = new Headers(r.headers); for (const [k, v] of Object.entries(extra)) h.set(k, v); return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }); };

export default {
  async fetch(request, env, ctx) {
    try {
      setBase(env.BASE_URL);
      const r = await handle(request, env, ctx);
      // The build marker, then the platform module's headers, on every response.
      const extra = { "x-roamid-build": buildMarker, ...(responseHeaders(request, env) || {}) };
      try { for (const [k, v] of Object.entries(extra)) r.headers.set(k, v); return r; } catch { return withHeaders(r, extra); }
    } catch (e) {
      console.error("[roamid] unhandled", e && e.stack || e);
      const v = view(request);
      return html(errorPage({ ...v, path: "/", code: "server_error", requestId: request.headers.get("CF-Ray") || "-" }), { status: 500, nonce: v.nonce });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduled(env));
  },
};
