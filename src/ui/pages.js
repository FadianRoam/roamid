// HTML pages: a plain, accessible base (assets/roamid.css), light, dark and
// system theme (the theme cookie is applied on the server, no flash). The
// <head> description, extra stylesheets and the landing heading come from
// src/platform/ (a deployment may replace that module). Every CSS,
// JavaScript and image file is served from this origin (src/ui/manifest.js).

import { t, errorText, localName, localPath, isTwinPath } from "./i18n.js";
import { renderHead, stylesheets, hero, replacesBaseStylesheet } from "../platform/index.js";
import { norm, searchText, idpHost, hostOf, orderIdps, pickerSplit, sortIdps, groupIdps, stateOf } from "./list.js";
import { ASSETS } from "./manifest.js";

import { esc } from "./esc.js";
export { esc };
export const REPO = "https://github.com/FadianRoam/roamid";
const DOCS = { en: `${REPO}#documentation`, zh: `${REPO}/blob/main/README.zh-CN.md#文档` };
export const REGISTRY_DOCS = { en: `${REPO}/blob/main/docs/registry.md#without-an-account-at-a-listed-identity-provider`, zh: `${REPO}/blob/main/docs/zh-CN/registry.md` };
const RP_DOCS = { en: `${REPO}/blob/main/docs/rp-integration.md`, zh: `${REPO}/blob/main/docs/zh-CN/rp-integration.md` };

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

function nav({ lang, theme, path, active }) {
  const other = lang === "zh" ? "en" : "zh";
  const otherLabel = other === "zh" ? "中文" : "English";
  const L = (h) => localPath(lang, h);
  const links = [
    [L("/idps"), t(lang, "nav_idps_short"), "idps"], [L("/apps"), t(lang, "nav_apps"), "apps"], [DOCS[lang], t(lang, "nav_docs"), "docs"],
    [L("/status"), t(lang, "nav_status"), "status"], [REPO, t(lang, "nav_source"), "github"],
  ];
  const a = ([h, l, k]) => `<a href="${esc(h)}"${active === k ? ' aria-current="page"' : ""}>${esc(l)}</a>`;
  const next = NEXT_THEME[theme];
  const themeLabel = t(lang, "theme_next", { cur: t(lang, "theme_" + theme), next: t(lang, "theme_" + next) });
  // The language link: the other language's URL of this page (and the cookie, for sign-in flows).
  const twin = localPath(other, String(path || "/").replace(/^\/zh(?=\/|$|\?)/, "") || "/");
  const langLink = prefLink("lang", other, twin);
  return `<nav class="nav" aria-label="RoamID">
<a class="brand" href="${esc(L("/"))}">${MARK}<span>RoamID</span></a>
<div class="links">${links.map(a).join("")}</div>
<div class="tools">
<a class="tool lang-switch" href="${esc(langLink)}" hreflang="${other === "zh" ? "zh-CN" : "en"}" lang="${other === "zh" ? "zh-CN" : "en"}">${icon("globe")}<span>${otherLabel}</span></a>
<a class="tool theme-switch" data-theme-current="${theme}" href="${esc(prefLink("theme", next, path))}" aria-label="${esc(themeLabel)}" title="${esc(themeLabel)}">${icon(theme)}</a>
</div>
<a class="nav-cta wide" href="${esc(L("/demo"))}">${esc(t(lang, "nav_demo"))}</a>
<details class="menu"><summary aria-label="${esc(t(lang, "menu"))}" aria-controls="menu-panel">${icon("burger")}</summary>
<div class="menu-panel" id="menu-panel">${links.map(a).join("")}<a href="${esc(L("/demo"))}">${esc(t(lang, "nav_demo"))}</a><hr>
<a class="lang-switch" href="${esc(langLink)}" lang="${other === "zh" ? "zh-CN" : "en"}">${icon("globe")}${otherLabel}</a>
${["system", "light", "dark"].map((v) => `<a href="${esc(prefLink("theme", v, path))}"${theme === v ? ' aria-current="true"' : ""}>${icon(v)}${esc(t(lang, "theme_" + v))}</a>`).join("")}
</div></details>
</nav>`;
}

// The instance's BASE_URL, for the head context (set once per request by src/index.js).
let BASE = "";
export const setBase = (b) => { BASE = String(b || "").replace(/\/+$/, ""); };
const ERROR_STATUS = { not_found: 404, rate_limited: 429, server_error: 500, invalid_request: 400 };

// The <head> description and the rest come from the platform module. path:
// this page's URL; the head context gets the English path without /zh.
function doc({ lang, theme, title, pageTitle = title, body, head = "", description = "", path = "/", page = "content", noindex = false, status = 200, isError = false, data = null }) {
  const [rawPath, query = ""] = String(path || "/").split("?");
  const enPath = rawPath.replace(/^\/zh(?=\/|$)/, "") || "/";
  // Indexable: the public pages only (not the picker, console, admin, errors, reports or test sign-ins).
  const isPublic = !noindex && !isError && isTwinPath(enPath) && !/^\/(test|report)(\/|$)/.test(enPath);
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}"${theme !== "system" ? ` data-theme="${theme}"` : ""} data-page="${esc(page)}">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${theme === "system" ? "light dark" : theme}">
${renderHead({ lang, path: enPath, query, status, isError, title: pageTitle, docTitle: title, description, base: BASE, data, page, noindex: !isPublic })}
<link rel="icon" href="${ASSETS["mark.svg"]}" type="image/svg+xml">
${baseStylesheet(replacesBaseStylesheet)}${stylesheets({ lang, page })}
<script src="${ASSETS["roamid.js"]}" defer></script>${head}
</head>
<body>
${body}
</body>
</html>`;
}

// The base stylesheet link, unless the platform module ships the base CSS itself.
export const baseStylesheet = (replaced) => (replaced ? "" : `<link rel="stylesheet" href="${ASSETS["roamid.css"]}">`);

// The page footer, on every page: links and "Powered by YunZheng LAB".
export function footer(lang) {
  const L = (h) => localPath(lang, h);
  return `<footer class="foot"><nav class="foot-links" aria-label="${esc(t(lang, "footer_nav"))}"><a href="${esc(L("/"))}">RoamID</a><a href="${esc(L("/idps"))}">${esc(t(lang, "nav_idps"))}</a><a href="${esc(L("/status"))}">${esc(t(lang, "nav_status"))}</a><a href="${esc(L("/apps"))}">${esc(t(lang, "nav_apps"))}</a><a href="/console">${esc(t(lang, "c_title"))}</a><a href="${esc(L("/report"))}">${esc(t(lang, "rep_title"))}</a><a href="${esc(L("/demo"))}">${esc(t(lang, "nav_demo"))}</a><a href="${esc(DOCS[lang])}">${esc(t(lang, "nav_docs"))}</a><a href="${REPO}">GitHub</a></nav>
<p class="powered"><a href="https://yunzheng.space/"><span>${esc(t(lang, "powered_by"))}</span><picture><source srcset="${ASSETS["lab-logo.webp"]}" type="image/webp"><img src="${ASSETS["lab-logo.png"]}" width="72" height="32" alt="YunZheng LAB" loading="lazy" decoding="async"></picture></a></p></footer>`;
}

export function contentPage({ lang, theme, path, active, title, body, narrow = false, head = "", description = "", noindex = false, status = 200, isError = false, data = null }) {
  return doc({ lang, theme, head, description, path, noindex, status, isError, data, pageTitle: title, title: `${title} · RoamID`, body: `<div class="page"><div class="topbar">${nav({ lang, theme, path, active })}</div><main class="content${narrow ? " narrow" : ""}">${body}</main>${footer(lang)}</div>` });
}

const dotClass = (h) => (["up", "degraded", "down"].includes(h) ? h : "unknown");

// ---- landing ----------------------------------------------------------------

export function homePage({ lang, theme, idps = [], health = {} }) {
  const body = `<div class="page"><div class="topbar">${nav({ lang, theme, path: localPath(lang, "/"), active: "" })}</div><main class="content landing">
${hero({ lang, h1: `${t(lang, "hero_l1")} ${t(lang, "hero_l2")}`, sub: t(lang, "hero_sub"), cta: t(lang, "hero_cta"), ctaHref: RP_DOCS[lang], note: t(lang, "pr_channel"), noteHref: REGISTRY_DOCS[lang], idps, health })}
<section class="section"><h2>${esc(t(lang, "home_how"))}</h2><ol class="steps">${t(lang, "home_steps").map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>
</main>${footer(lang)}</div>`;
  return doc({ lang, theme, title: "RoamID", description: t(lang, "hero_sub"), path: localPath(lang, "/"), page: "landing", body });
}

// ---- the identity provider picker ---------------------------------------------

// A provider's logo (served from /logos/) or a monogram tile.
function logoTile(i, lang, { lazy = true, size = 28 } = {}) {
  const name = localName(i, lang);
  if (i.logo && i.logo.path) {
    const w = i.logo.width >= i.logo.height ? size * Math.min(2, i.logo.width / i.logo.height) : size;
    return `<span class="logo"><img src="/logos/${esc(i.logo.path)}" width="${Math.round(w)}" height="${size}" alt="${esc(t(lang, "logo_of", { name }))}"${lazy ? ' loading="lazy"' : ""} decoding="async"></span>`;
  }
  return `<span class="logo tile" aria-hidden="true">${esc([...name.trim()][0] || "?")}</span>`;
}

export function pickerPage({ lang, theme, path, tx, client, redirectUri, idps, last, hint = null, cancelUrl, health = {}, showAll = false }) {
  const rp = localName(client, lang);
  const ordered = orderIdps(idps, { lang, last, hint, health });
  const { top, rest } = showAll ? { top: ordered, rest: [] } : pickerSplit(ordered, { last, hint });
  const checked = ordered[0] && ordered[0].id;
  const row = (idp, more) => {
    const h = health[idp.id];
    const host = idpHost(idp);
    const name = localName(idp, lang);
    const tags = [idp.id === last ? t(lang, "pick_last") : "", h === "down" ? t(lang, "pick_down") : h === "degraded" ? t(lang, "status_degraded") : ""].filter(Boolean).join(" · ");
    const sel = idp.id === checked;
    return `<li role="option" id="opt-${esc(idp.id)}" aria-selected="${sel}" data-q="${esc(searchText(idp))}" data-state="${esc(dotClass(h))}"${more ? " data-more hidden" : ""}><label class="row"><input type="radio" name="idp" value="${esc(idp.id)}" tabindex="-1"${sel ? " checked" : ""}><span class="dot ${dotClass(h)}" title="${esc(t(lang, "status_" + dotClass(h)))}"></span><span class="t"><span class="n" title="${esc(name)}">${esc(name)}</span><span class="h" title="${esc(host)}">${esc(host)}</span></span>${tags ? `<span class="tag">${esc(tags)}</span>` : ""}${logoTile(idp, lang)}</label></li>`;
  };
  const count = (n) => (n === 1 ? t(lang, "pick_count_one") : t(lang, "pick_count", { n }));
  const card = idps.length ? `<form class="card picker" method="post" action="/select">
<input type="hidden" name="tx" value="${esc(tx)}">
<div class="ctx"><span>${esc(t(lang, "pick_to"))}</span><b>${esc(rp)}</b><span class="host">${esc(client.domain || hostOf(redirectUri))}</span></div>
<label class="search">${icon("search")}<input id="q" type="search" autocomplete="off" spellcheck="false" role="combobox" aria-controls="idp-list" aria-expanded="true" aria-autocomplete="list" aria-describedby="idp-count" placeholder="${esc(t(lang, "list_search"))}" aria-label="${esc(t(lang, "pick_search"))}"></label>
<p class="count" id="idp-count" aria-live="polite" data-one="${esc(t(lang, "pick_count_one"))}" data-many="${esc(t(lang, "pick_count", { n: "{n}" }))}">${esc(count(ordered.length))}</p>
<ul class="rows" id="idp-list" role="listbox" aria-label="${esc(t(lang, "pick_list"))}">${top.map((i) => row(i, false)).join("")}${rest.map((i) => row(i, true)).join("")}</ul>
${rest.length ? `<a class="more" id="show-all" role="button" aria-controls="idp-list" aria-expanded="false" href="/select?tx=${encodeURIComponent(tx)}&amp;all=1" data-less="${esc(t(lang, "pick_show_less"))}">${esc(t(lang, "pick_show_all", { n: ordered.length }))}</a>` : ""}
<p class="empty none" hidden>${esc(t(lang, "pick_none"))} <a href="${esc(REGISTRY_DOCS[lang])}">${esc(t(lang, "pick_register"))}</a></p>
<div class="actions"><a class="cancel" href="${esc(cancelUrl)}">${esc(t(lang, "pick_cancel_short"))}</a><button class="pill" type="submit" id="continue">${esc(t(lang, "pick_continue"))}</button></div>
<p class="fine">${esc(t(lang, "pick_note", { rp }))}</p>
${client.builtin ? "" : `<a class="report-link" href="${esc(localPath(lang, "/report"))}?app=${encodeURIComponent(client.client_id)}&amp;tx=${encodeURIComponent(tx)}" id="report-link">${esc(t(lang, "pick_report"))}</a>`}
</form>` : `<div class="card"><div class="ctx"><span>${esc(t(lang, "pick_to"))}</span><b>${esc(rp)}</b></div><div class="empty">${esc(t(lang, "pick_empty"))} <a href="${esc(REGISTRY_DOCS[lang])}">${esc(t(lang, "pick_register"))}</a></div><div class="actions"><a class="cancel" href="${esc(cancelUrl)}">${esc(t(lang, "pick_cancel_short"))}</a></div></div>`;
  const body = `<div class="page"><div class="topbar">${nav({ lang, theme, path, active: "" })}</div><main class="content picker-page">
<h1 class="title">${esc(t(lang, "pick_h1"))} ${esc(t(lang, "pick_h2"))}</h1>
${card}
</main>${footer(lang)}</div>`;
  return doc({ lang, theme, title: `${t(lang, "pick_title", { rp })} · RoamID`, path, page: "picker", noindex: true, body });
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
  return contentPage({ lang, theme, path, active: "", title: t(lang, "err_title"), body, narrow: true, isError: true, status: ERROR_STATUS[code] || 400 });
}

export function messagePage({ lang, theme, path, title, lead }) {
  return contentPage({ lang, theme, path, active: "", title, narrow: true, body: `<h1 class="title">${esc(title)}</h1><p class="lead">${esc(lead)}</p><div class="btnrow"><a class="pill ghost" href="/">RoamID</a></div>` });
}

export function healthBadge(lang, idp, h) {
  if (idp.status === "disabled") return `<span class="badge">${esc(t(lang, "disabled"))}</span>`;
  const cls = h === "up" ? "ok" : h === "degraded" ? "warn" : h === "down" ? "bad" : "";
  return `<span class="badge ${cls}"><span class="dot ${dotClass(h)}"></span>${esc(t(lang, "status_" + (["up", "degraded", "down"].includes(h) ? h : "unknown")))}</span>`;
}

export function idpsPage({ lang, theme, idps, health = {}, added = {}, sort = "name", fixture = null }) {
  const by = ["name", "added", "status"].includes(sort) ? sort : "name";
  const sorted = sortIdps(idps, { by, lang, health, added });
  const rank = { up: 0, degraded: 1, unknown: 2, down: 3, disabled: 4 };
  const row = (i) => {
    const st = stateOf(i, health);
    const name = localName(i, lang);
    const host = idpHost(i) || i.issuer || i.entity_id || "";
    const sub = [...(i.email_domains || []).map((d) => `<code>${esc(d)}</code>`), i.note ? `<span class="note">${esc(i.note)}</span>` : ""].filter(Boolean).join(" ");
    return `<li class="idrow" id="idp-${esc(i.id)}" data-q="${esc(searchText(i))}" data-name="${esc(norm(name))}" data-added="${added[i.id] || 0}" data-rank="${rank[st]}">
<span class="main"><span class="nm" title="${esc(name)}">${esc(name)}</span><span class="idt">${esc(i.id)}</span></span>
<span class="host" title="${esc(host)}">${esc(host)}</span>
<span class="st"><span class="dot ${st === "disabled" ? "unknown" : st}"></span>${esc(st === "disabled" ? t(lang, "disabled") : t(lang, "status_" + st))}</span>
<span class="badge proto">${i.protocol === "saml2" ? "SAML" : "OIDC"}</span>
${logoTile(i, lang)}${sub ? `\n<span class="sub">${sub}</span>` : ""}
</li>`;
  };
  const groups = groupIdps(sorted);
  const q = (k) => `${localPath(lang, "/idps")}?sort=${k}${fixture != null ? `&amp;fixture=${fixture}` : ""}`;
  const body = `<h1 class="title">${esc(t(lang, "idps_title"))}</h1><p class="lead">${esc(t(lang, "idps_lead"))}</p>
<div class="listbar" id="idps-bar"><label class="search">${icon("search")}<input id="iq" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t(lang, "list_search"))}" aria-label="${esc(t(lang, "list_search"))}" aria-controls="idps-groups"></label>
<form class="sort" method="get" action="${esc(localPath(lang, "/idps"))}"><label for="isort">${esc(t(lang, "list_sort"))}</label><select id="isort" name="sort">${["name", "added", "status"].map((k) => `<option value="${k}"${k === by ? " selected" : ""}>${esc(t(lang, "sort_" + k))}</option>`).join("")}</select>${fixture != null ? `<input type="hidden" name="fixture" value="${esc(fixture)}">` : ""}<noscript><button class="pill ghost" type="submit">${esc(t(lang, "list_sort"))}</button></noscript></form>
<p class="count" id="icount" aria-live="polite" data-one="${esc(t(lang, "pick_count_one"))}" data-many="${esc(t(lang, "pick_count", { n: "{n}" }))}">${esc(sorted.length === 1 ? t(lang, "pick_count_one") : t(lang, "pick_count", { n: sorted.length }))}</p></div>
<div id="idps-groups">${groups.map((g) => `<details class="group" id="g-${g.key}" open><summary><h2>${esc(t(lang, "proto_" + g.key))} <span class="gn">${g.items.length}</span></h2></summary><ul class="idlist">${g.items.map(row).join("")}</ul></details>`).join("")}</div>
<p class="empty none" hidden>${esc(t(lang, "pick_none"))} <a href="${esc(REGISTRY_DOCS[lang])}">${esc(t(lang, "pick_register"))}</a></p>
${sorted.length ? "" : `<p class="empty">${esc(t(lang, "pick_none"))} <a href="${esc(REGISTRY_DOCS[lang])}">${esc(t(lang, "pick_register"))}</a></p>`}
<p class="lead"><a href="/idps.json">/idps.json</a></p>`;
  return contentPage({ lang, theme, path: localPath(lang, "/idps"), active: "idps", title: t(lang, "idps_title"), description: t(lang, "idps_lead"), data: { idps: sorted }, body });
}

function age(lang, secs) {
  if (secs === null || secs === undefined) return "-";
  const n = secs < 120 ? `${secs} s` : secs < 7200 ? `${Math.round(secs / 60)} min` : secs < 172800 ? `${Math.round(secs / 3600)} h` : `${Math.round(secs / 86400)} d`;
  return t(lang, "ago", { n: lang === "zh" ? n.replace(" s", " 秒").replace(" min", " 分钟").replace(" h", " 小时").replace(" d", " 天") : n });
}

export function statusPage({ lang, theme, s }) {
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
  return contentPage({ lang, theme, path: "/status", active: "status", title: t(lang, "status_title"), body });
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
