// RoamID Worker: routing, the cron, and the public information endpoints.

import { json, html, redirect, text, cookie, now, newNonce, corsPreflight, readForm } from "./lib/http.js";
import { safeEqual } from "./lib/b64.js";
import { signingKeys, clientKeys } from "./lib/keys.js";
import { allow } from "./lib/ratelimit.js";
import { clientIp } from "./lib/edgesig.js";
import { summary, daily } from "./lib/events.js";
import { getRegistry, syncRegistry, serveLogo } from "./registry/store.js";
import { checkDomainProofs, proofState } from "./registry/domains.js";
import { discoveryDoc, authorize, select, callback, token, userinfo, logout, healthMap, samlAcs, samlSso, samlCancel } from "./oidc/op.js";
import { spMetadataHandler } from "./saml/sp.js";
import { idpMetadataHandler } from "./saml/idp.js";
import { demoSamlStart, demoSamlAcs, demoSamlPage } from "./saml/demo.js";
import { samlKeys, certInfo } from "./saml/certs.js";
import { probeIdps } from "./health.js";
import { pickLang, pickTheme, LANG_COOKIE, THEME_COOKIE, localName } from "./ui/i18n.js";
import { homePage, idpsPage, statusPage, errorPage } from "./ui/pages.js";
import { demoPage } from "./ui/demo.js";
import { configure, base, canonicalize, sitemapXml, robotsTxt, onOrigin, INDEXNOW_KEY } from "./ui/seo.js";
import { docsIndexPage, docPage, docBySlug } from "./ui/docs.js";
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

export async function handle(request, env, ctx) {
  configure(env);
  let url = new URL(request.url);
  let p = url.pathname;
  const m = request.method;
  // Public pages: one URL per language (src/ui/seo.js). Other spellings
  // answer 301 at the public name; the page is then routed under its English
  // path with ?lang= set, which is what the renderers read.
  if (m === "GET" || m === "HEAD") {
    const c = canonicalize(url);
    if (c && c.redirect) return redirect(base() + c.redirect, { status: 301, headers: { "Cache-Control": "public, max-age=3600" } });
    if (c && c.notFound) { const v = view(request); return html(errorPage({ ...v, path: "/", code: "not_found", requestId: request.headers.get("CF-Ray") || "-" }), { status: 404 }); }
    if (c) {
      url = new URL(url);
      url.pathname = c.path;
      url.searchParams.set("lang", c.lang);
      request = new Request(url, request);
      p = c.path;
    }
  }
  if (p.startsWith("/video/") && p.endsWith(".mp4") && env.ASSETS && (m === "GET" || m === "HEAD")) return serveAssetWithRange(request, env);
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
  if (p.startsWith("/logos/") && (m === "GET" || m === "HEAD")) return serveLogo(env, p);
  const v = view(request);
  if (p === "/") {
    const reg = await getRegistry(env);
    return html(homePage({ ...v, idps: [...reg.idps.values()].filter((i) => i.status === "active"), health: await healthMap(env) }));
  }
  if (p === "/idps") {
    const reg = await getRegistry(env);
    return html(idpsPage({ ...v, idps: [...reg.idps.values()], health: await healthMap(env) }), { nonce: v.nonce });
  }
  if (p === "/status") return html(statusPage({ ...v, s: await statusData(env) }), { nonce: v.nonce });
  if (p === "/demo" || p === "/demo/callback") return html(demoPage(v));
  if (p === "/demo/saml") return demoSamlPage(v);
  if (p === "/test" || p.startsWith("/test/")) { if (!(await allow(env, "authorize", await clientIp(request, env)))) return html(errorPage({ ...v, path: "/", code: "rate_limited", requestId: "-" }), { status: 429 }); const r = await handleTest(request, env, p, v); if (r) return r; }
  if (p === "/robots.txt") return text(robotsTxt({ origin: onOrigin(request) }), { cache: PUBLIC_CACHE });
  if (p === "/sitemap.xml") {
    const reg = await getRegistry(env);
    return text(sitemapXml({ registryDate: reg.generated_at }), { cache: PUBLIC_CACHE, type: "application/xml; charset=utf-8" });
  }
  if (p === `/${INDEXNOW_KEY}.txt`) return text(INDEXNOW_KEY, { cache: PUBLIC_CACHE });
  if (p === "/docs") return html(docsIndexPage(v));
  if (p.startsWith("/docs/") && docBySlug(p.slice(6))) return html(docPage({ ...v, doc: docBySlug(p.slice(6)) }));
  if (p === "/favicon.ico") return new Response(null, { status: 204, headers: { "Cache-Control": PUBLIC_CACHE } });
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

export default {
  async fetch(request, env, ctx) {
    configure(env);
    let res;
    try {
      res = await handle(request, env, ctx);
    } catch (e) {
      console.error("[roamid] unhandled", e && e.stack || e);
      const v = view(request);
      res = html(errorPage({ ...v, path: "/", code: "server_error", requestId: request.headers.get("CF-Ray") || "-" }), { status: 500, nonce: v.nonce });
    }
    // The origin name behind Orbit Shield is never indexed.
    if (onOrigin(request)) {
      res = new Response(res.body, res);
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return res;
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduled(env));
  },
};
