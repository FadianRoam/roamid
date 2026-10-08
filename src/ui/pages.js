// HTML pages. Visual system: Figtree, black pill navigation, one-screen hero
// with a cyan video band and a floating card (landing and the identity
// provider picker), #f2f2f2 cards on content pages. Light, dark and system
// theme: the theme cookie is applied on the server (no flash); "system"
// leaves it to prefers-color-scheme. All CSS, JavaScript, fonts and media are
// served from this origin (src/ui/manifest.js).

import { t, errorText, localName } from "./i18n.js";
import { ASSETS } from "./manifest.js";
import { pageOf, head as seoHead, href, langPath, POWERED, LAB_URL } from "./seo.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const REPO = "https://github.com/FadianRoam/roamid";
export const REGISTRY_DOCS = { en: `${REPO}/blob/main/docs/registry.md#without-an-account-at-a-listed-identity-provider`, zh: `${REPO}/blob/main/docs/zh-CN/registry.md` };
// The integration guide, rendered on this site from docs/ (src/ui/docs.js).
const RP_DOCS = { en: "/docs/rp-integration", zh: "/zh/docs/rp-integration" };

const ICON = {
  system: '<path d="M3 4.5h14v9H3z"/><path d="M7 16.5h6M10 13.5v3"/>',
  light: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  dark: '<path d="M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7z"/>',
  globe: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.2 2.8 4.5 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.5-2.8-7S8 5.2 10 3z"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2l4.3 4.3"/>',
  burger: '<path d="M4 7h12M4 13h12"/>',
  back: '<path d="M12.5 4.5L7 10l5.5 5.5"/>',
  alert: '<path d="M10 3l7.5 13.5h-15z"/><path d="M10 8v4M10 14v.5"/>',
};
export const icon = (name) => `<svg class="i" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const MARK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.2" stroke="#38c6ec" stroke-width="2.6"/><circle cx="18.6" cy="6.9" r="3" fill="#38c6ec"/></svg>';

const prefLink = (kind, value, path) => `/prefs?${kind}=${value}&next=${encodeURIComponent(path)}`;
const NEXT_THEME = { system: "light", light: "dark", dark: "system" };

// The language switch and every link in the navigation and the footer go
// to language URLs (src/ui/seo.js): /x in English, /zh/x in Chinese. Pages
// without one (picker, console) switch language with the /prefs cookie.
function nav({ lang, theme, path, active }) {
  const other = lang === "zh" ? "en" : "zh";
  const otherLabel = other === "zh" ? "中文" : "English";
  const pg = pageOf(path, lang);
  const twin = pg ? (pg.langs.includes(other) ? langPath(other, pg.path) + (pg.self.includes("?") ? pg.self.slice(pg.self.indexOf("?")) : "") : langPath(other, "/docs")) : prefLink("lang", other, path);
  const here = pg ? pg.self : path;
  const links = [
    [href(lang, "/idps"), t(lang, "nav_idps_short"), "idps"], [href(lang, "/apps"), t(lang, "nav_apps"), "apps"], [href(lang, "/docs"), t(lang, "nav_docs"), "docs"],
    [href(lang, "/status"), t(lang, "nav_status"), "status"], [REPO, t(lang, "nav_source"), "github"],
  ];
  const a = ([h, l, k]) => `<a href="${esc(h)}"${active === k ? ' aria-current="page"' : ""}>${esc(l)}</a>`;
  const next = NEXT_THEME[theme];
  const themeLabel = t(lang, "theme_next", { cur: t(lang, "theme_" + theme), next: t(lang, "theme_" + next) });
  return `<nav class="nav" aria-label="RoamID">
<a class="brand" href="${href(lang, "/")}">${MARK}<span>RoamID</span></a>
<div class="links">${links.map(a).join("")}</div>
<div class="tools">
<a class="tool lang-switch" href="${esc(twin)}" hreflang="${other === "zh" ? "zh-CN" : "en"}" aria-label="${esc(t(lang, "language"))}: ${otherLabel}">${icon("globe")}<span>${otherLabel}</span></a>
<a class="tool theme-switch" data-theme-current="${theme}" href="${esc(prefLink("theme", next, here))}" aria-label="${esc(themeLabel)}" title="${esc(themeLabel)}">${icon(theme)}</a>
</div>
<a class="nav-cta wide" href="${href(lang, "/demo")}">${esc(t(lang, "nav_demo"))}</a>
<details class="menu"><summary aria-label="${esc(t(lang, "menu"))}" aria-controls="menu-panel">${icon("burger")}</summary>
<div class="menu-panel" id="menu-panel">${links.map(a).join("")}<a href="${href(lang, "/demo")}">${esc(t(lang, "nav_demo"))}</a><hr>
<a class="lang-switch" href="${esc(twin)}" hreflang="${other === "zh" ? "zh-CN" : "en"}">${icon("globe")}${otherLabel}</a>
${["system", "light", "dark"].map((v) => `<a href="${esc(prefLink("theme", v, here))}"${theme === v ? ' aria-current="true"' : ""}>${icon(v)}${esc(t(lang, "theme_" + v))}</a>`).join("")}
</div></details>
</nav>`;
}

// `path` is the path the page was rendered for; public pages (seo.js
// pageOf) get description, canonical, hreflang, Open Graph and JSON-LD,
// every other page "noindex". `seo` is extra data for the JSON-LD.
function doc({ lang, theme, title, body, anim = false, head = "", path = "", seo }) {
  const pg = pageOf(path, lang);
  const s = pg ? seoHead(pg, seo) : null;
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}"${theme !== "system" ? ` data-theme="${theme}"` : ""}${anim ? " data-anim" : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="${theme === "system" ? "light dark" : theme}">
<title>${esc(s ? s.title : title)}</title>
${s ? s.tags : '<meta name="robots" content="noindex">'}
<link rel="icon" href="${ASSETS["mark.svg"]}" type="image/svg+xml">
<link rel="preload" href="${ASSETS["fonts/figtree-latin.woff2"]}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${ASSETS["roamid.css"]}">
<script src="${ASSETS["boot.js"]}"></script>
<script src="${ASSETS["roamid.js"]}" defer></script>${head}
</head>
<body>
${body}
</body>
</html>`;
}

// The band: the poster is a real image (the largest paint on landing and
// picker, fetched at high priority with its size known); assets/roamid.js
// starts the video after the page has loaded, unless motion is reduced.
const band = () => `<div class="band" aria-hidden="true"><img class="poster" src="${ASSETS["poster-1600.webp"]}" srcset="${ASSETS["poster-800.webp"]} 800w, ${ASSETS["poster-1600.webp"]} 1600w, ${ASSETS["poster.webp"]} 3168w" sizes="100vw" width="1600" height="679" alt="" fetchpriority="high" decoding="async"><video muted loop playsinline preload="none" data-src="${ASSETS["band.mp4"]}"></video></div>`;

// The footer of every page: links (not on the picker), then "Powered by"
// with the YunZheng LAB logo, served from this origin.
export function footer(lang, { links = true } = {}) {
  const a = (p, label) => `<a href="${esc(href(lang, p))}">${esc(label)}</a>`;
  const row = links ? `<div class="foot-links">${a("/", "RoamID")}${a("/idps", t(lang, "nav_idps"))}${a("/status", t(lang, "nav_status"))}${a("/apps", t(lang, "nav_apps"))}${a("/console", t(lang, "c_title"))}${a("/report", t(lang, "rep_title"))}${a("/demo", t(lang, "nav_demo"))}${a("/docs", t(lang, "nav_docs"))}<a href="${REPO}">GitHub</a></div>` : "";
  const [pre, post] = POWERED[lang] || POWERED.en;
  const logo = `<picture><source srcset="${ASSETS["lab-logo.webp"]}" type="image/webp"><img src="${ASSETS["lab-logo.png"]}" width="54" height="24" alt="YunZheng LAB" loading="lazy" decoding="async"></picture>`;
  return `<footer class="foot">${row}<a class="powered" href="${LAB_URL}">${pre ? `<span>${esc(pre)}</span>` : ""}${logo}${post ? `<span>${esc(post)}</span>` : ""}</a></footer>`;
}

export function contentPage({ lang, theme, path, active, title, body, narrow = false, head = "", seo }) {
  return doc({ lang, theme, head, path, seo, title: `${title} · RoamID`, body: `<div class="page"><div class="topbar">${nav({ lang, theme, path, active })}</div><main class="content${narrow ? " narrow" : ""}">${body}</main>${footer(lang)}</div>` });
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };
const idpHost = (i) => hostOf(i.issuer || i.sso_url || i.metadata_url || i.entity_id);
const dotClass = (h) => (["up", "degraded", "down"].includes(h) ? h : "unknown");

// ---- landing ----------------------------------------------------------------

export function homePage({ lang, theme, path = "/", idps = [], health = {} }) {
  const rows = idps.slice(0, 2).map((i) => `<li class="row" aria-hidden="true"><span class="dot ${dotClass(health[i.id])}"></span><span class="t"><span class="n">${esc(localName(i, lang))}</span><span class="h">${esc(idpHost(i))}</span></span><span class="tick"></span></li>`).join("");
  const body = `<div class="hero" data-page="landing"><div class="stage">
${nav({ lang, theme, path, active: "" })}
<h1 class="display"><span>${esc(t(lang, "hero_l1"))}</span><span>${esc(t(lang, "hero_l2"))}</span></h1>
<p class="sub">${esc(t(lang, "hero_sub"))}</p>
<a class="pill hero-cta" href="${esc(RP_DOCS[lang])}">${esc(t(lang, "hero_cta"))}</a>
<a class="hero-note" href="${esc(REGISTRY_DOCS[lang])}" id="pr-channel">${esc(t(lang, "pr_channel"))}</a>
<div class="scene">${band()}
<div class="card" role="img" aria-label="${esc(t(lang, "sample_label"))}">
<div class="ctx"><span>${esc(t(lang, "pick_to"))}</span><b>${esc(t(lang, "sample_rp"))}</b><span class="host">portal.example.com</span></div>
<div class="search">${icon("search")}<span class="ph">${esc(t(lang, "pick_search"))}</span></div>
<ul class="rows">${rows}<li class="row join"><span class="dot unknown"></span><span class="t"><span class="n">${esc(t(lang, "sample_join"))}</span><span class="h">${esc(t(lang, "sample_join_h"))}</span></span></li></ul>
<div class="actions"><span class="cancel">${esc(t(lang, "pick_cancel_short"))}</span><span class="pill demo">${esc(t(lang, "pick_continue"))}</span></div>
</div></div></div></div>
${footer(lang)}`;
  return doc({ lang, theme, path, title: "RoamID", body, anim: true });
}

// ---- the identity provider picker ---------------------------------------------

export function pickerPage({ lang, theme, path, tx, client, redirectUri, idps, last, cancelUrl, health = {} }) {
  const rp = localName(client, lang);
  const ordered = last && idps.some((i) => i.id === last) ? [idps.find((i) => i.id === last), ...idps.filter((i) => i.id !== last)] : idps;
  const checked = ordered[0] && ordered[0].id;
  const row = (idp) => {
    const h = health[idp.id];
    const host = idpHost(idp);
    const q = `${idp.name.en} ${idp.name.zh || ""} ${idp.id} ${host}`.toLowerCase();
    const tags = [idp.id === last ? t(lang, "pick_last") : "", h === "down" ? t(lang, "status_down") : h === "degraded" ? t(lang, "status_degraded") : ""].filter(Boolean).join(" · ");
    return `<li data-q="${esc(q)}"><label class="row"><input type="radio" name="idp" value="${esc(idp.id)}"${idp.id === checked ? " checked" : ""}><span class="dot ${dotClass(h)}" title="${esc(t(lang, "status_" + (["up", "degraded", "down"].includes(h) ? h : "unknown")))}"></span><span class="t"><span class="n">${esc(localName(idp, lang))}</span><span class="h">${esc(host)}</span></span>${tags ? `<span class="tag">${esc(tags)}</span>` : ""}<span class="tick"></span></label></li>`;
  };
  const card = idps.length ? `<form class="card picker" method="post" action="/select">
<input type="hidden" name="tx" value="${esc(tx)}">
<div class="ctx"><span>${esc(t(lang, "pick_to"))}</span><b>${esc(rp)}</b><span class="host">${esc(client.domain || hostOf(redirectUri))}</span></div>
<label class="search">${icon("search")}<input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t(lang, "pick_search"))}" aria-label="${esc(t(lang, "pick_search"))}"></label>
<ul class="rows" role="radiogroup" aria-label="${esc(t(lang, "pick_list"))}">${ordered.map(row).join("")}</ul>
<div class="empty none" hidden>${esc(t(lang, "pick_none"))}</div>
<div class="actions"><a class="cancel" href="${esc(cancelUrl)}">${esc(t(lang, "pick_cancel_short"))}</a><button class="pill" type="submit" id="continue">${esc(t(lang, "pick_continue"))}</button></div>
<p class="fine">${esc(t(lang, "pick_note", { rp }))}</p>
${client.builtin ? "" : `<a class="report-link" href="/report?app=${encodeURIComponent(client.client_id)}&amp;tx=${encodeURIComponent(tx)}" id="report-link">${esc(t(lang, "pick_report"))}</a>`}
</form>` : `<div class="card"><div class="ctx"><span>${esc(t(lang, "pick_to"))}</span><b>${esc(rp)}</b></div><div class="empty">${esc(t(lang, "pick_empty"))}</div><div class="actions"><a class="cancel" href="${esc(cancelUrl)}">${esc(t(lang, "pick_cancel_short"))}</a></div></div>`;
  const body = `<div class="hero" data-page="picker"><div class="stage">
${nav({ lang, theme, path, active: "" })}
<h1 class="display"><span>${esc(t(lang, "pick_h1"))}</span><span>${esc(t(lang, "pick_h2"))}</span></h1>
<p class="sub">${esc(t(lang, "pick_sub"))}</p>
<div class="scene">${band()}${card}</div>
</div></div>
${footer(lang, { links: false })}`;
  return doc({ lang, theme, path, title: `${t(lang, "pick_title", { rp })} · RoamID`, body, anim: true });
}

// ---- content pages -------------------------------------------------------------

export const hiddenFields = (fields) => Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");

// The page that carries a SAML message to a service provider by HTTP-POST.
// assets/roamid.js submits it on load; without JavaScript the button does.
export function postPage({ lang, theme, path, form, rpName }) {
  const body = `<h1 class="title">${esc(t(lang, "post_title", { rp: rpName || "" }))}</h1><p class="lead">${esc(t(lang, "post_lead"))}</p>
<form method="post" action="${esc(form.action)}" data-autopost>${hiddenFields(form.fields)}<div class="btnrow"><button class="pill" type="submit">${esc(t(lang, "post_continue"))}</button></div></form>`;
  return contentPage({ lang, theme, path, active: "", title: t(lang, "post_title", { rp: rpName || "" }), body, narrow: true });
}

export function errorPage({ lang, theme, path, code, requestId, detail, backUrl, backForm, rpName }) {
  const body = `<h1 class="title">${esc(t(lang, "err_title"))}</h1>
<div class="alert">${icon("alert")}<div><p>${esc(errorText(lang, code))}</p>${detail ? `<p class="mono">${esc(detail)}</p>` : ""}
<div class="kv"><div>${esc(t(lang, "err_code"))}</div><div class="mono" data-code>${esc(code)}</div><div>${esc(t(lang, "err_request"))}</div><div class="mono">${esc(requestId)}</div></div></div></div>
<div class="btnrow">${backUrl ? `<a class="pill" href="${esc(backUrl)}">${icon("back")}${esc(t(lang, "err_back", { rp: rpName || "" }))}</a>` : ""}${backForm ? `<form method="post" action="${esc(backForm.action)}">${hiddenFields(backForm.fields)}<button class="pill" type="submit">${icon("back")}${esc(t(lang, "err_back", { rp: rpName || "" }))}</button></form>` : ""}<a class="pill ghost" href="/">${esc(t(lang, "err_home"))}</a></div>`;
  return contentPage({ lang, theme, path, active: "", title: t(lang, "err_title"), body, narrow: true });
}

export function messagePage({ lang, theme, path, title, lead }) {
  return contentPage({ lang, theme, path, active: "", title, narrow: true, body: `<h1 class="title">${esc(title)}</h1><p class="lead">${esc(lead)}</p><div class="btnrow"><a class="pill ghost" href="/">RoamID</a></div>` });
}

export function healthBadge(lang, idp, h) {
  if (idp.status === "disabled") return `<span class="badge">${esc(t(lang, "disabled"))}</span>`;
  const cls = h === "up" ? "ok" : h === "degraded" ? "warn" : h === "down" ? "bad" : "";
  return `<span class="badge ${cls}"><span class="dot ${dotClass(h)}"></span>${esc(t(lang, "status_" + (["up", "degraded", "down"].includes(h) ? h : "unknown")))}</span>`;
}

export function idpsPage({ lang, theme, path = "/idps", idps, health = {} }) {
  const L = (k) => ` data-label="${esc(t(lang, k))}"`;
  const rows = idps.map((i) => `<tr><td${L("col_name")}><b>${esc(localName(i, lang))}</b><br><span class="mono">${esc(i.id)}</span>${i.note ? `<br><span class="note">${esc(i.note)}</span>` : ""}</td><td${L("col_issuer")}><code>${esc(i.issuer || i.entity_id || i.metadata_url)}</code>${i.protocol === "saml2" ? ' <span class="badge">SAML</span>' : ""}</td><td${L("col_domains")}>${(i.email_domains || []).map((d) => `<code>${esc(d)}</code>`).join("<br>") || "-"}</td><td${L("col_status")}>${healthBadge(lang, i, health[i.id])}</td></tr>`).join("");
  const body = `<h1 class="title">${esc(t(lang, "idps_title"))}</h1><p class="lead">${esc(t(lang, "idps_lead"))}</p>
<div class="section box"><div class="scroll"><table class="tbl stack"><thead><tr><th>${esc(t(lang, "col_name"))}</th><th>${esc(t(lang, "col_issuer"))}</th><th>${esc(t(lang, "col_domains"))}</th><th>${esc(t(lang, "col_status"))}</th></tr></thead><tbody>${rows}</tbody></table></div></div>
<p class="lead"><a href="/idps.json">/idps.json</a></p>`;
  return contentPage({ lang, theme, path, active: "idps", title: t(lang, "idps_title"), body, seo: { idps: idps.filter((i) => i.status !== "disabled").map((i) => ({ name: localName(i, lang), url: i.homepage })) } });
}

function age(lang, secs) {
  if (secs === null || secs === undefined) return "-";
  const n = secs < 120 ? `${secs} s` : secs < 7200 ? `${Math.round(secs / 60)} min` : secs < 172800 ? `${Math.round(secs / 3600)} h` : `${Math.round(secs / 86400)} d`;
  return t(lang, "ago", { n: lang === "zh" ? n.replace(" s", " 秒").replace(" min", " 分钟").replace(" h", " 小时").replace(" d", " 天") : n });
}

export function statusPage({ lang, theme, path = "/status", s }) {
  const r = s.registry;
  const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<div>${esc(k)}</div><div>${v}</div>`).join("")}</div>`;
  const proof = (p) => `<span class="badge ${p.state === "verified" ? "ok" : p.state === "grace" ? "warn" : p.state === "lost" ? "bad" : ""}">${esc(t(lang, "proof_" + p.state))}</span>`;
  const sec = (title, inner) => `<div class="section"><h2>${esc(title)}</h2><div class="box">${inner}</div></div>`;
  const keys = (list) => list.map((k) => `<code>${esc(k.kid)}</code> ${esc(k.alg)}${k.created ? ` · ${esc(k.created)}` : ""}`).join("<br>") || "-";
  const body = `<h1 class="title">${esc(t(lang, "status_title"))}</h1>
${sec(t(lang, "status_registry"), kv([
    [t(lang, "status_commit"), r.commit ? `<a class="mono" href="${REPO}/commit/${esc(r.commit)}">${esc(r.commit.slice(0, 12))}</a>` : "-"],
    [t(lang, "status_synced"), `${esc(r.synced_at || "-")} · ${esc(age(lang, r.age_seconds))}`],
    [t(lang, "status_checked"), esc(r.checked_at || "-")],
    [t(lang, "nav_idps"), `${r.idps}`], ["Clients", `${r.clients}`],
    [t(lang, "status_error"), r.last_error ? `<span class="mono">${esc(r.last_error)}</span>` : esc(t(lang, "status_none"))],
  ]))}
${sec(t(lang, "nav_idps"), s.idp_health.length ? `<div class="scroll"><table class="tbl"><tbody>${s.idp_health.map((h) => `<tr><td class="mono">${esc(h.idp)}</td><td>${healthBadge(lang, { status: "active" }, h.state)}</td><td>${esc(h.checked_at || "")}</td><td class="mono">${esc(h.last_error || "")}</td></tr>`).join("")}</tbody></table></div>` : esc(t(lang, "status_none")))}
${sec(t(lang, "status_dropped"), r.dropped.length ? `<div class="scroll"><table class="tbl"><tbody>${r.dropped.map((d) => `<tr><td class="mono">${esc(d.kind)}/${esc(d.id)}</td><td>${d.errors.map(esc).join("<br>")}</td></tr>`).join("")}</tbody></table></div>` : esc(t(lang, "status_none")))}
${sec(t(lang, "status_domains"), s.domains.length ? `<div class="scroll"><table class="tbl"><tbody>${s.domains.map((p) => `<tr><td><code>${esc(p.domain)}</code></td><td class="mono">${esc(p.idp)}</td><td>${proof(p)}</td><td class="mono">${esc(p.last_error || "")}</td></tr>`).join("")}</tbody></table></div>` : esc(t(lang, "status_none")))}
${s.warnings.length ? sec(t(lang, "status_warnings"), s.warnings.map((w) => `<p class="mono">${esc(w)}</p>`).join("")) : ""}
${sec(t(lang, "status_keys"), kv([[t(lang, "status_signing"), keys(s.keys.signing)], [t(lang, "status_client"), keys(s.keys.client)],
    [t(lang, "status_saml"), (s.keys.saml || []).map((k) => `<code>${esc(k.kid)}</code> ${esc(k.alg)}${k.created ? ` · ${esc(k.created)}` : ""} · ${esc(t(lang, "status_valid_until"))} ${esc((k.not_after || "").slice(0, 10))}`).join("<br>") || "-"]]))}
${(s.saml_metadata || []).length ? sec(t(lang, "status_saml_meta"), `<div class="scroll"><table class="tbl"><tbody>${s.saml_metadata.map((m) => `<tr><td class="mono">${esc(m.idp)}</td><td>${esc(m.fetched_at || "-")}</td><td>${m.valid_until ? `${esc(t(lang, "status_valid_until"))} ${esc(m.valid_until)}` : ""}</td><td class="mono">${esc(m.last_error || "")}</td></tr>`).join("")}</tbody></table></div>`) : ""}
${sec(t(lang, "status_counts"), kv([[t(lang, "status_started"), `${s.counts.started}`], [t(lang, "status_completed"), `${s.counts.completed}`],
    [t(lang, "status_failed"), `${s.counts.failed}${Object.keys(s.counts.failures).length ? " · " + Object.entries(s.counts.failures).map(([k, v]) => `<code>${esc(k)}</code> ${v}`).join(", ") : ""}`]]))}
${s.daily && s.daily.per_day.length ? sec(t(lang, "status_daily"), `<div class="scroll"><table class="tbl"><thead><tr><th>${esc(t(lang, "c_day"))}</th><th>${esc(t(lang, "status_started"))}</th><th>${esc(t(lang, "status_completed"))}</th><th>${esc(t(lang, "status_failed"))}</th></tr></thead><tbody>${s.daily.per_day.map((d) => `<tr><td class="mono">${esc(d.day)}</td><td>${d.started}</td><td>${d.completed}</td><td>${d.failed}</td></tr>`).join("")}</tbody></table></div>${s.daily.per_idp.length ? `<div class="scroll gap"><table class="tbl"><thead><tr><th>${esc(t(lang, "nav_idps"))}</th><th>${esc(t(lang, "status_completed"))}</th><th>${esc(t(lang, "status_failed"))}</th></tr></thead><tbody>${s.daily.per_idp.map((d) => `<tr><td class="mono">${esc(d.idp)}</td><td>${d.completed}</td><td>${d.failed}</td></tr>`).join("")}</tbody></table></div>` : ""}`) : ""}
${sec(t(lang, "status_version"), kv([["RoamID", esc(s.version)], ["Deployment", `<code>${esc(s.deployment || "-")}</code>`]]))}
<p class="lead"><a href="/status.json">/status.json</a></p>`;
  return contentPage({ lang, theme, path, active: "status", title: t(lang, "status_title"), body });
}

export function demoPage({ lang, theme, path, clientId }) {
  const L = {};
  for (const [k, key] of [["claims", "demo_claims"], ["userinfo", "demo_userinfo"], ["working", "demo_working"], ["failed", "demo_failed"], ["again", "demo_again"], ["signout", "demo_signout"], ["verified", "demo_verified"], ["asserted", "demo_asserted"]]) L[k] = t(lang, key);
  const body = `<h1 class="title">${esc(t(lang, "demo_title"))}</h1>
<p class="lead">${esc(t(lang, "demo_lead"))}</p>
<div id="demo" data-client="${esc(clientId)}"><div class="btnrow" id="start"><button class="pill" id="signin" type="button">${esc(t(lang, "demo_signin"))}</button></div><div id="out" aria-live="polite"></div></div>
<script type="application/json" id="demo-text">${JSON.stringify(L).replace(/</g, "\\u003c")}</script>`;
  return contentPage({ lang, theme, path, active: "demo", title: t(lang, "demo_title"), body });
}

// /demo/saml: the built-in SAML service provider.
export function samlDemoPage({ lang, theme, path, result }) {
  let out = "";
  if (result && result.ok) {
    const rows = [["NameID", result.nameId], ["NameID Format", result.nameIdFormat], ...result.attributes.map((a) => [a.friendly || a.name, a.values.join(", ")])];
    out = `<div class="section"><h2>${esc(t(lang, "demo_saml_result"))}</h2><div class="scroll"><table class="tbl"><tbody>${rows.map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td><code>${esc(v)}</code></td></tr>`).join("")}</tbody></table></div></div>`;
  } else if (result) {
    out = `<div class="alert">${icon("alert")}<div><p>${esc(t(lang, "demo_failed"))}</p><p class="mono" data-code>${esc(result.error)}</p></div></div>`;
  }
  const body = `<h1 class="title">${esc(t(lang, "demo_saml_title"))}</h1><p class="lead">${esc(t(lang, "demo_saml_lead"))}</p>
<div class="btnrow"><a class="pill" id="saml-signin" href="/demo/saml/start">${esc(result && result.ok ? t(lang, "demo_again") : t(lang, "demo_signin"))}</a><a class="pill ghost" href="/saml/idp/metadata.xml">IdP metadata</a></div>${out}`;
  return contentPage({ lang, theme, path, active: "demo", title: t(lang, "demo_saml_title"), body });
}
