// Responses, cookies and security headers.

import { randomToken } from "./b64.js";

export const now = () => Math.floor(Date.now() / 1000);

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};

function withBase(h) {
  const out = new Headers(h);
  for (const [k, v] of Object.entries(BASE_HEADERS)) if (!out.has(k)) out.set(k, v);
  return out;
}

// JSON. `cache` is a Cache-Control value; everything personal is no-store.
export function json(body, { status = 200, cache = "no-store", cors = false, headers = {} } = {}) {
  const h = withBase({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, ...headers });
  if (cors) for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(JSON.stringify(body, null, status >= 400 ? 0 : 2), { status, headers: h });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: withBase(CORS) });
}

// Kept for callers that still pass one; pages no longer use inline code.
export function newNonce() {
  return randomToken(16);
}

// Same-origin only: every script, style, font, image and video is a file on
// this origin. form-action allows https because the picker's POST answers
// with a redirect to the identity provider.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "form-action 'self' https:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

// The CSP of a page that posts a SAML message to a service provider: the
// form may also go to that one origin (a development service on
// http://localhost is not covered by "https:").
export function cspPostingTo(action) {
  let origin;
  try { origin = new URL(action).origin; } catch { return CSP; }
  return CSP.replace("form-action 'self' https:", `form-action 'self' https: ${origin}`);
}

// HTML pages are personal (language, theme, remembered choice): never cached
// by a shared cache.
export function html(body, { status = 200, headers = {}, cookies = [] } = {}) {
  // no-transform: the CDN must not inject scripts (analytics beacons) into pages.
  const h = withBase({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-transform", "Content-Security-Policy": CSP, ...headers });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(body, { status, headers: h });
}

export function redirect(location, { status = 302, cookies = [], headers = {} } = {}) {
  const h = withBase({ Location: location, "Cache-Control": "no-store", ...headers });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status, headers: h });
}

export function text(body, { status = 200, cache = "no-store", type = "text/plain; charset=utf-8" } = {}) {
  return new Response(body, { status, headers: withBase({ "Content-Type": type, "Cache-Control": cache }) });
}

export function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function cookie(name, value, { maxAge, httpOnly = true, sameSite = "Lax" } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; Secure; SameSite=${sameSite}`;
  if (httpOnly) c += "; HttpOnly";
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

export async function readForm(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const body = await request.text();
  if (body.length > 64 * 1024) return null;
  return new URLSearchParams(body);
}

export function requestId(request) {
  return request.headers.get("CF-Ray") || randomToken(8);
}
