// RoamID Worker: routing, the cron, and the public information endpoints.

import { json, html, redirect, text, cookie, now, newNonce, corsPreflight, readForm } from "./lib/http.js";
import { safeEqual } from "./lib/b64.js";
import { signingKeys, clientKeys } from "./lib/keys.js";
import { allow } from "./lib/ratelimit.js";
import { clientIp } from "./lib/edgesig.js";
import { summary } from "./lib/events.js";
import { getRegistry, syncRegistry } from "./registry/store.js";
import { checkDomainProofs, proofState } from "./registry/domains.js";
import { discoveryDoc, authorize, select, callback, token, userinfo, logout, healthMap } from "./oidc/op.js";
import { probeIdps } from "./health.js";
import { pickLang, pickTheme, LANG_COOKIE, THEME_COOKIE, localName } from "./ui/i18n.js";
import { homePage, idpsPage, statusPage, errorPage } from "./ui/pages.js";
import { demoPage } from "./ui/demo.js";
import { VERSION } from "./version.js";
import { serveAssetWithRange } from "./lib/range.js";

const PUBLIC_CACHE = "public, max-age=300";

function view(request) {
  const u = new URL(request.url);
  return { lang: pickLang(request), theme: pickTheme(request), nonce: newNonce(), path: u.pathname + u.search };
}

function publicIdp(i, health) {
  return { id: i.id, protocol: i.protocol, name: i.name, issuer: i.issuer, homepage: i.homepage, email_domains: i.email_domains || [], status: i.status, health: health[i.id] || "unknown" };
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
  let keys = { signing: [], client: [] };
  try { keys = { signing: keyInfo((await signingKeys(env)).jwks, env.SIGNING_KEYS), client: keyInfo((await clientKeys(env)).jwks, env.CLIENT_KEYS) }; } catch (e) { keys.error = e.message; }
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
    counts: await summary(env, 7),
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
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;
  if (p.startsWith("/assets/") && p.endsWith(".mp4") && env.ASSETS && (m === "GET" || m === "HEAD")) return serveAssetWithRange(request, env);
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
  if (p === "/prefs" && m === "GET") return prefs(request);
  if (m !== "GET" && m !== "HEAD") return json({ error: "method_not_allowed" }, { status: 405 });
  if (p === "/idps.json") {
    const reg = await getRegistry(env);
    const health = await healthMap(env);
    return json({ commit: reg.commit, idps: [...reg.idps.values()].map((i) => publicIdp(i, health)) }, { cache: "public, max-age=60", cors: true });
  }
  if (p === "/status.json") return json(await statusData(env), { cors: true });
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
  if (p === "/demo" || p === "/demo/callback") return html(demoPage(v), { nonce: v.nonce });
  if (p === "/robots.txt") return text("User-agent: *\nDisallow: /authorize\nDisallow: /select\nDisallow: /callback/\nDisallow: /demo/callback\n", { cache: PUBLIC_CACHE });
  if (p === "/favicon.ico") return new Response(null, { status: 204, headers: { "Cache-Control": PUBLIC_CACHE } });
  return html(errorPage({ ...v, path: "/", code: "not_found", requestId: request.headers.get("CF-Ray") || "-" }), { status: 404, nonce: v.nonce });
}

export async function scheduled(env) {
  const t = now();
  await syncRegistry(env).catch((e) => console.error("[cron] sync", e && e.message));
  const reg = await getRegistry(env);
  await checkDomainProofs(env, reg).catch((e) => console.error("[cron] domains", e && e.message));
  await probeIdps(env, reg).catch((e) => console.error("[cron] health", e && e.message));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tx WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM codes WHERE expires <= ?").bind(t - 3600),
    env.DB.prepare("DELETE FROM tokens WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM ratelimit WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM jti WHERE expires <= ?").bind(t),
    env.DB.prepare("DELETE FROM events WHERE day < ?").bind(new Date((t - 400 * 86400) * 1000).toISOString().slice(0, 10)),
  ]);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
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
