// Platform interface: the parts of a RoamID deployment that an instance may
// replace (styling, search engine metadata, edge integration, operator
// notifications, a human check on the report form). These are the generic
// defaults: with them this repository runs standalone and complete. A
// deployment may substitute this module at build time with its own
// implementation of the same exports.

import { esc } from "../ui/esc.js";

// Shown on /status and in the x-roamid-build response header.
export const buildMarker = "public";

// The <head> elements that describe the page, <title> included. ctx: { lang,
// path (the English path, without /zh), query, status, isError, title (the
// document title), pageTitle, description, base (BASE_URL), data, noindex }.
export function renderHead(ctx) {
  return `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(ctx.docTitle || ctx.title)}</title>${ctx.description ? `\n<meta name="description" content="${esc(ctx.description)}">` : ""}${ctx.noindex ? '\n<meta name="robots" content="noindex">' : ""}`;
}

// Extra stylesheets and font preloads, after the base stylesheet. ctx: { lang, page }.
export function stylesheets(ctx) {
  return "";
}

// The landing page's heading block. ctx: { lang, h1, sub, cta, ctaHref, note, noteHref, idps, health }.
export function hero(ctx) {
  return `<section class="hero-plain">
<h1>${esc(ctx.h1)}</h1>
<p class="sub">${esc(ctx.sub)}</p>
<p class="hero-actions"><a class="pill" href="${esc(ctx.ctaHref)}">${esc(ctx.cta)}</a></p>
<p><a class="hero-note" href="${esc(ctx.noteHref)}" id="pr-channel">${esc(ctx.note)}</a></p>
</section>`;
}

// /sitemap.xml: null answers 404.
export function sitemap(ctx) {
  return null;
}

// /robots.txt
export function robots(ctx) {
  return "User-agent: *\nDisallow: /authorize\nDisallow: /select\nDisallow: /callback/\nDisallow: /demo/callback\nDisallow: /console\nDisallow: /admin\nDisallow: /report\nDisallow: /saml/\n";
}

// The client address used for rate limits and the report hash.
export async function clientIp(request, env) {
  return request.headers.get("CF-Connecting-IP") || "";
}

// A new report or appeal for the operator. With OPERATOR_WEBHOOK_URL set,
// the message is posted there as JSON ({ subject, body, link }); a JSON
// answer with "number" or "id" is kept as the ticket reference. Otherwise
// it is logged.
export async function notifyOperator(env, { subject, body, link }) {
  if (!env.OPERATOR_WEBHOOK_URL) { console.log("[operator]", subject, link || ""); return null; }
  try {
    const r = await fetch(env.OPERATOR_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body, link }), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return String(j.number || j.id || "").slice(0, 40) || null;
  } catch (e) {
    console.warn("[operator] webhook failed:", e.message);
    return null;
  }
}

// A human check on the report form, active when `field` names the form field
// that carries its token. verify() answers true when the check passed, or an
// error code ("verify_required", "verify_failed", "verify_unavailable").
// widget(ctx) is the form markup (ctx: { env, lang, action }); script goes in
// the report page's <head>; csp lists extra sources by directive. Off by
// default: reports rely on the rate limits.
export const humanCheck = {
  field: null,
  script: "",
  csp: { script: [], connect: [], frame: [], style: [], img: [] },
  widget: () => "",
  verify: async () => true,
};

// Headers added to every response. ctx: { request, env }.
export function responseHeaders(request, env) {
  return {};
}

// Pages a deployment adds (for example documentation rendered from docs/).
// Returns a Response, or null for "not here". ctx: { request, env, lang, query, base, theme }.
export async function pages(path, ctx) {
  return null;
}

// For a path the public routes do not know: ["en", "zh"] (a page with a /zh/
// twin), ["en"] (English only: /zh/... answers 301 with it) or null (not a
// page of the deployment).
export const languagePaths = (path) => null;

// Byte sizes of extra media served with ranges from /video/ (the assets
// binding streams without Content-Length).
export const assetSizes = {};
