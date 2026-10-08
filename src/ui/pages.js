// HTML pages. LAB design language: square corners, line icons, text only,
// light / dark / system theme without a flash (the theme cookie is applied
// on the server; "system" leaves it to prefers-color-scheme).

import { t, errorText, localName } from "./i18n.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ICON = {
  system: '<path d="M3 4.5h14v9H3z"/><path d="M7 16.5h6M10 13.5v3"/>',
  light: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  dark: '<path d="M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7z"/>',
  globe: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.2 2.8 4.5 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.5-2.8-7S8 5.2 10 3z"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2l4.3 4.3"/>',
  chevron: '<path d="M7.5 4.5l5.5 5.5-5.5 5.5"/>',
  back: '<path d="M12.5 4.5L7 10l5.5 5.5"/>',
  alert: '<path d="M10 3l7.5 13.5h-15z"/><path d="M10 8v4M10 14v.5"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  external: '<path d="M8 4.5H4.5v11h11V12"/><path d="M11 3.5h5.5V9M16.5 3.5L9 11"/>',
};
export const icon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true">${ICON[name]}</svg>`;

const CSS = `
:root{--bg:#fff;--card:#fff;--surface:#f4f6f8;--surface2:#e8edf1;--text:#0a0a0a;--muted:#1a1a1a;--dim:#5b6368;
--line:rgba(10,10,10,.12);--line2:rgba(10,10,10,.28);--blue:#006cd2;--blue-soft:#e8f2fb;--on-blue:#fff;
--good:#137333;--bad:#b42318;--warn:#8a5a00;
--font:"Inter","Helvetica Neue",Helvetica,Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color-scheme:light}
html[lang^=zh]{--font:"Inter","PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0d1117;--card:#141a21;--surface:#1a212a;--surface2:#232c36;
--text:#e7ecf2;--muted:#cfd6dd;--dim:#9aa5b0;--line:rgba(231,236,242,.12);--line2:rgba(231,236,242,.28);
--blue:#4c9dff;--blue-soft:rgba(76,157,255,.14);--on-blue:#0b1623;--good:#6fcf8e;--bad:#ff8a80;--warn:#f0c060}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0d1117;--card:#141a21;--surface:#1a212a;--surface2:#232c36;
--text:#e7ecf2;--muted:#cfd6dd;--dim:#9aa5b0;--line:rgba(231,236,242,.12);--line2:rgba(231,236,242,.28);
--blue:#4c9dff;--blue-soft:rgba(76,157,255,.14);--on-blue:#0b1623;--good:#6fcf8e;--bad:#ff8a80;--warn:#f0c060}
*{box-sizing:border-box;border-radius:0}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 var(--font);-webkit-text-size-adjust:100%}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
h1,h2,h3{letter-spacing:-.015em;margin:0;font-weight:600}
h1{font-size:26px;line-height:1.25}h2{font-size:17px;margin:28px 0 10px}
p{margin:0 0 12px}
code,.mono{font-family:var(--mono);font-size:13px;word-break:break-all}
.i{width:18px;height:18px;flex:none;display:block}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line)}
.brand{font-weight:700;font-size:16px;letter-spacing:-.01em;color:var(--text)}
.brand span{color:var(--dim);font-weight:400;margin-left:10px;font-size:13px}
.prefs{display:flex;align-items:center;gap:8px}
.seg{display:flex;border:1px solid var(--line2)}
.seg a{display:flex;align-items:center;justify-content:center;width:34px;height:32px;color:var(--dim)}
.seg a+a{border-left:1px solid var(--line2)}
.seg a[aria-current="true"]{background:var(--surface2);color:var(--text)}
.seg a:hover{text-decoration:none;color:var(--text)}
.lang{display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--line2);color:var(--text);font-size:13px}
.lang:hover{text-decoration:none;background:var(--surface)}
main{max-width:880px;margin:0 auto;padding:36px 20px 56px}
main.narrow{max-width:520px}
.lead{color:var(--dim);margin-top:8px}
.search{display:flex;align-items:center;gap:8px;border:1px solid var(--line2);padding:0 12px;margin:22px 0 6px;background:var(--card)}
.search input{flex:1;border:0;background:transparent;color:var(--text);font:inherit;height:44px;outline:none;min-width:0}
.search:focus-within{outline:2px solid var(--blue);outline-offset:-1px}
.label{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:20px 0 6px}
html[lang^=zh] .label{letter-spacing:.02em}
.list{border:1px solid var(--line);margin:0;padding:0;list-style:none}
.list li+li{border-top:1px solid var(--line)}
.idp{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;background:var(--card);color:var(--text);border:0;font:inherit;text-align:left;cursor:pointer}
.idp:hover{background:var(--surface)}
.idp .t{flex:1;min-width:0}
.idp .n{display:block;font-weight:600}
.idp .h{display:block;color:var(--dim);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.idp .s{font-size:12px;color:var(--warn)}
.note{color:var(--dim);font-size:13px;margin-top:18px}
.empty{padding:16px;color:var(--dim);border:1px solid var(--line)}
.btn{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 18px;border:1px solid var(--blue);background:var(--blue);color:var(--on-blue);font:inherit;font-weight:600;cursor:pointer}
.btn:hover{text-decoration:none;filter:brightness(1.06)}
.btn.ghost{background:transparent;color:var(--text);border-color:var(--line2)}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
table{width:100%;border-collapse:collapse;border:1px solid var(--line);font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--dim);font-size:12px;letter-spacing:.04em;text-transform:uppercase;background:var(--surface)}
.kv{display:grid;grid-template-columns:minmax(120px,200px) 1fr;border:1px solid var(--line)}
.kv>div{padding:10px 12px;border-bottom:1px solid var(--line);min-width:0;overflow-wrap:anywhere}
.kv>div:nth-child(odd){color:var(--dim)}
.kv>div:nth-last-child(-n+2){border-bottom:0}
.tag{display:inline-block;font-size:12px;padding:1px 7px;border:1px solid var(--line2);color:var(--dim)}
.tag.good{color:var(--good);border-color:currentColor}.tag.bad{color:var(--bad);border-color:currentColor}.tag.warn{color:var(--warn);border-color:currentColor}
.err{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line2);border-left:3px solid var(--bad);padding:16px;background:var(--card);margin-top:20px}
.err .i{color:var(--bad);margin-top:2px}
ol.steps{padding-left:20px}ol.steps li{margin:6px 0}
pre{background:var(--surface);border:1px solid var(--line);padding:12px;overflow:auto;font:13px/1.5 var(--mono);margin:0}
footer{border-top:1px solid var(--line);padding:18px 20px;color:var(--dim);font-size:13px;display:flex;flex-wrap:wrap;gap:16px;justify-content:center}
footer a{color:var(--dim)}
.scroll{overflow-x:auto}
@media (max-width:560px){h1{font-size:22px}main{padding:26px 16px 40px}header.top{padding:12px 16px}.brand span{display:none}
.kv{grid-template-columns:1fr}.kv>div:nth-child(odd){border-bottom:0;padding-bottom:0;font-size:12px}}
`;

export const REPO = "https://github.com/FadianRoam/roamid";

// Links that change a preference and come back to the same page.
function prefLink(kind, value, path) {
  return `/prefs?${kind}=${value}&next=${encodeURIComponent(path)}`;
}

export function layout({ lang, theme, path, title, body, nonce, narrow = false, script = "", minimal = false }) {
  const other = lang === "zh" ? "en" : "zh";
  const seg = ["system", "light", "dark"].map((v) =>
    `<a href="${esc(prefLink("theme", v, path))}" aria-current="${theme === v}" title="${esc(t(lang, "theme_" + v))}" aria-label="${esc(t(lang, "theme") + ": " + t(lang, "theme_" + v))}">${icon(v)}</a>`).join("");
  const nav = [
    ["/idps", t(lang, "nav_idps")], ["/status", t(lang, "nav_status")], ["/demo", t(lang, "nav_demo")],
    [`${REPO}#readme`, t(lang, "nav_docs")], [REPO, t(lang, "nav_source")],
  ].map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join("");
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}"${theme !== "system" ? ` data-theme="${theme}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<header class="top">
<a class="brand" href="/">RoamID<span>${esc(t(lang, "tagline"))}</span></a>
<div class="prefs">
<a class="lang" href="${esc(prefLink("lang", other, path))}" hreflang="${other === "zh" ? "zh-CN" : "en"}" aria-label="${esc(t(lang, "language"))}">${icon("globe")}${other === "zh" ? "中文" : "English"}</a>
<div class="seg" role="group" aria-label="${esc(t(lang, "theme"))}">${seg}</div>
</div>
</header>
<main${narrow ? ' class="narrow"' : ""}>
${body}
</main>
${minimal ? "" : `<footer>${nav}</footer>`}
${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;
}

// The identity provider picker.
export function pickerPage({ lang, theme, nonce, path, tx, client, idps, last, cancelUrl, health = {} }) {
  const rp = localName(client, lang);
  const row = (idp) => {
    const h = health[idp.id];
    const mark = h === "down" ? `<span class="s">${esc(t(lang, "status_down"))}</span>` : h === "degraded" ? `<span class="s">${esc(t(lang, "status_degraded"))}</span>` : "";
    const host = (() => { try { return new URL(idp.issuer).host; } catch { return ""; } })();
    const q = `${idp.name.en} ${idp.name.zh || ""} ${idp.id} ${host}`.toLowerCase();
    return `<li data-q="${esc(q)}"><button class="idp" type="submit" name="idp" value="${esc(idp.id)}"><span class="t"><span class="n">${esc(localName(idp, lang))}</span><span class="h">${esc(host)}</span></span>${mark}${icon("chevron")}</button></li>`;
  };
  const lastIdp = last && idps.find((i) => i.id === last);
  const body = `
<h1>${esc(t(lang, "pick_title", { rp }))}</h1>
<p class="lead">${esc(t(lang, "pick_lead"))}</p>
${idps.length ? `<form method="post" action="/select">
<input type="hidden" name="tx" value="${esc(tx)}">
<label class="search">${icon("search")}<input id="q" type="search" autocomplete="off" placeholder="${esc(t(lang, "pick_search"))}" aria-label="${esc(t(lang, "pick_search"))}"></label>
${lastIdp ? `<div class="label" data-sec>${esc(t(lang, "pick_last"))}</div><ul class="list">${row(lastIdp)}</ul>` : ""}
<div class="label" data-sec>${esc(t(lang, "pick_all"))}</div>
<ul class="list" id="all">${idps.filter((i) => i !== lastIdp).map(row).join("") || ""}</ul>
<div class="empty" id="none" hidden>${esc(t(lang, "pick_none"))}</div>
</form>` : `<div class="empty">${esc(t(lang, "pick_empty"))}</div>`}
<p class="note">${esc(t(lang, "pick_note", { rp }))}</p>
<p class="note"><a href="${esc(cancelUrl)}">${esc(t(lang, "pick_cancel", { rp }))}</a></p>`;
  const script = `(function(){var q=document.getElementById("q");if(!q)return;var rows=[].slice.call(document.querySelectorAll("li[data-q]"));var secs=[].slice.call(document.querySelectorAll("[data-sec]"));var none=document.getElementById("none");
q.addEventListener("input",function(){var s=q.value.trim().toLowerCase();var n=0;rows.forEach(function(r){var on=!s||r.getAttribute("data-q").indexOf(s)>=0;r.hidden=!on;if(on)n++;});
secs.forEach(function(e){e.hidden=!!s;});document.querySelectorAll(".list").forEach(function(l){l.hidden=!l.querySelector("li:not([hidden])");});none.hidden=n>0;});})();`;
  return layout({ lang, theme, path, nonce, narrow: true, minimal: true, title: t(lang, "pick_title", { rp }) + " · RoamID", body, script });
}

export function errorPage({ lang, theme, nonce, path, code, requestId, detail, backUrl, rpName }) {
  const body = `
<h1>${esc(t(lang, "err_title"))}</h1>
<div class="err">${icon("alert")}<div><p>${esc(errorText(lang, code))}</p>${detail ? `<p class="mono">${esc(detail)}</p>` : ""}
<div class="kv"><div>${esc(t(lang, "err_code"))}</div><div class="mono">${esc(code)}</div><div>${esc(t(lang, "err_request"))}</div><div class="mono">${esc(requestId)}</div></div></div></div>
<div class="row">${backUrl ? `<a class="btn" href="${esc(backUrl)}">${icon("back")}${esc(t(lang, "err_back", { rp: rpName || "" }))}</a>` : ""}<a class="btn ghost" href="/">${esc(t(lang, "err_home"))}</a></div>`;
  return layout({ lang, theme, path, nonce, narrow: true, title: t(lang, "err_title") + " · RoamID", body });
}

export function messagePage({ lang, theme, nonce, path, title, lead }) {
  return layout({ lang, theme, path, nonce, narrow: true, title: title + " · RoamID", body: `<h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p><div class="row"><a class="btn ghost" href="/">RoamID</a></div>` });
}

export function homePage({ lang, theme, nonce, base }) {
  const eps = [
    ["Discovery", "/.well-known/openid-configuration"], ["Authorization", "/authorize"], ["Token", "/token"], ["Userinfo", "/userinfo"],
    ["JWKS", "/jwks.json"], ["Client JWKS", "/client-jwks.json"], ["Logout", "/logout"], ["Identity providers", "/idps.json"], ["Status", "/status.json"],
  ];
  const body = `
<h1>RoamID</h1>
<p class="lead">${esc(t(lang, "home_lead"))}</p>
<h2>${esc(t(lang, "home_how"))}</h2>
<ol class="steps">${t(lang, "home_steps").map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p>${esc(t(lang, "home_registry"))} <a href="${REPO}">${REPO.replace("https://", "")}</a></p>
<h2>${esc(t(lang, "home_endpoints"))}</h2>
<div class="scroll"><table><tbody>${eps.map(([n, p]) => `<tr><td>${esc(n)}</td><td><code>${esc(base + p)}</code></td></tr>`).join("")}</tbody></table></div>
<div class="row"><a class="btn" href="/demo">${esc(t(lang, "nav_demo"))}</a><a class="btn ghost" href="/idps">${esc(t(lang, "nav_idps"))}</a></div>`;
  return layout({ lang, theme, path: "/", nonce, title: "RoamID", body });
}

export function idpsPage({ lang, theme, nonce, idps, health = {} }) {
  const st = (idp) => {
    if (idp.status === "disabled") return `<span class="tag">${esc(t(lang, "disabled"))}</span>`;
    const h = health[idp.id];
    if (h === "up") return `<span class="tag good">${esc(t(lang, "status_up"))}</span>`;
    if (h === "degraded") return `<span class="tag warn">${esc(t(lang, "status_degraded"))}</span>`;
    if (h === "down") return `<span class="tag bad">${esc(t(lang, "status_down"))}</span>`;
    return `<span class="tag">${esc(t(lang, "status_unknown"))}</span>`;
  };
  const rows = idps.map((i) => `<tr><td><b>${esc(localName(i, lang))}</b><br><span class="mono">${esc(i.id)}</span></td><td><code>${esc(i.issuer)}</code></td><td>${(i.email_domains || []).map((d) => `<code>${esc(d)}</code>`).join("<br>") || "-"}</td><td>${st(i)}</td></tr>`).join("");
  const body = `<h1>${esc(t(lang, "idps_title"))}</h1><p class="lead">${esc(t(lang, "idps_lead"))}</p>
<div class="scroll"><table><thead><tr><th>${esc(t(lang, "col_name"))}</th><th>${esc(t(lang, "col_issuer"))}</th><th>${esc(t(lang, "col_domains"))}</th><th>${esc(t(lang, "col_status"))}</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="note"><a href="/idps.json">/idps.json</a></p>`;
  return layout({ lang, theme, path: "/idps", nonce, title: t(lang, "idps_title") + " · RoamID", body });
}

function age(lang, secs) {
  if (secs === null || secs === undefined) return "-";
  const n = secs < 120 ? `${secs} s` : secs < 7200 ? `${Math.round(secs / 60)} min` : secs < 172800 ? `${Math.round(secs / 3600)} h` : `${Math.round(secs / 86400)} d`;
  return t(lang, "ago", { n: lang === "zh" ? n.replace(" s", " 秒").replace(" min", " 分钟").replace(" h", " 小时").replace(" d", " 天") : n });
}

export function statusPage({ lang, theme, nonce, s }) {
  const r = s.registry;
  const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<div>${esc(k)}</div><div>${v}</div>`).join("")}</div>`;
  const proof = (p) => `<span class="tag ${p.state === "verified" ? "good" : p.state === "grace" ? "warn" : p.state === "lost" ? "bad" : ""}">${esc(t(lang, "proof_" + p.state))}</span>`;
  const body = `<h1>${esc(t(lang, "status_title"))}</h1>
<h2>${esc(t(lang, "status_registry"))}</h2>
${kv([
    [t(lang, "status_commit"), r.commit ? `<a class="mono" href="${REPO}/commit/${esc(r.commit)}">${esc(r.commit.slice(0, 12))}</a>` : "-"],
    [t(lang, "status_synced"), `${esc(r.synced_at || "-")} <span class="lead">${esc(age(lang, r.age_seconds))}</span>`],
    [t(lang, "status_checked"), esc(r.checked_at || "-")],
    [t(lang, "nav_idps"), `${r.idps}`], ["Clients", `${r.clients}`],
    [t(lang, "status_error"), r.last_error ? `<span class="mono">${esc(r.last_error)}</span>` : esc(t(lang, "status_none"))],
  ])}
<h2>${esc(t(lang, "status_dropped"))}</h2>
${r.dropped.length ? `<div class="scroll"><table><tbody>${r.dropped.map((d) => `<tr><td class="mono">${esc(d.kind)}/${esc(d.id)}</td><td>${d.errors.map(esc).join("<br>")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="lead">${esc(t(lang, "status_none"))}</p>`}
<h2>${esc(t(lang, "status_domains"))}</h2>
${s.domains.length ? `<div class="scroll"><table><tbody>${s.domains.map((p) => `<tr><td><code>${esc(p.domain)}</code></td><td class="mono">${esc(p.idp)}</td><td>${proof(p)}</td><td class="lead">${esc(p.last_error || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="lead">${esc(t(lang, "status_none"))}</p>`}
<h2>${esc(t(lang, "status_keys"))}</h2>
${kv([[t(lang, "status_signing"), s.keys.signing.map((k) => `<code>${esc(k.kid)}</code> ${esc(k.alg)}${k.created ? ` <span class="lead">${esc(k.created)}</span>` : ""}`).join("<br>")],
    [t(lang, "status_client"), s.keys.client.map((k) => `<code>${esc(k.kid)}</code> ${esc(k.alg)}${k.created ? ` <span class="lead">${esc(k.created)}</span>` : ""}`).join("<br>")]])}
<h2>${esc(t(lang, "status_counts"))}</h2>
${kv([[t(lang, "status_started"), `${s.counts.started}`], [t(lang, "status_completed"), `${s.counts.completed}`],
    [t(lang, "status_failed"), `${s.counts.failed}${Object.keys(s.counts.failures).length ? " · " + Object.entries(s.counts.failures).map(([k, v]) => `<code>${esc(k)}</code> ${v}`).join(", ") : ""}`]])}
<h2>${esc(t(lang, "status_version"))}</h2>
${kv([["RoamID", esc(s.version)], ["Deployment", `<code>${esc(s.deployment || "-")}</code>`]])}
<p class="note"><a href="/status.json">/status.json</a></p>`;
  return layout({ lang, theme, path: "/status", nonce, title: t(lang, "status_title") + " · RoamID", body });
}
