// Pages of the console (/console), the public application list (/apps), the
// report form (/report) and the operator queue (/admin). Server-rendered
// forms; the same visual system as the rest of RoamID.

import { t, localName, localPath, errorText, ERROR_CODES } from "../ui/i18n.js";
import { contentPage, esc, hiddenFields, icon, REGISTRY_DOCS, RP_DOCS, REPO } from "../ui/pages.js";
import { humanCheck } from "../platform/index.js";
import { searchText, norm } from "../ui/list.js";

const STATUS_CLASS = { active: "ok", development: "warn", unverified: "warn", suspended: "bad", banned: "bad" };
export const appStatus = (a) => (a.status === "active" && !a.domain_verified ? "unverified" : a.status);
export const statusBadge = (lang, s) => `<span class="badge ${STATUS_CLASS[s] || ""}">${esc(t(lang, "app_status_" + s))}</span>`;
const day = (secs) => (secs ? new Date(secs * 1000).toISOString().slice(0, 10) : "-");
const when = (secs) => (secs ? new Date(secs * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-");
const sec = (title, inner, id) => `<div class="section"${id ? ` id="${id}"` : ""}><h2>${esc(title)}</h2><div class="box">${inner}</div></div>`;
const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<div>${esc(k)}</div><div>${v}</div>`).join("")}</div>`;
const csrfField = (s) => `<input type="hidden" name="csrf" value="${esc(s.csrf)}">`;
// A page's URL in the page's language.
const P = (v, p) => localPath(v.lang, p);
// A copy button for the text of `#id` (shown when scripts run; assets/roamid.js).
const copyBtn = (lang, id, label = t(lang, "c_copy")) => `<button class="linkbtn copy" type="button" data-copy="${esc(id)}" data-done="${esc(t(lang, "c_copied"))}" hidden>${esc(label)}</button>`;

// Errors of the application form: the field's label (a link to the field),
// the reason, and the technical detail. Field names of the shared checks map
// to the form's inputs.
const FORM_FIELD = { name: "name_en", "name.en": "name_en", "name.zh": "name_zh", domain: "domain", homepage: "homepage", redirect_uris: "redirect_uris", post_logout_redirect_uris: "post_logout_redirect_uris", token_endpoint_auth_method: "auth_method", jwks_uri: "jwks_uri", id_token_signed_response_alg: "id_token_signed_response_alg", subject_type: "subject_type", entity_id: "entity_id", acs_urls: "acs_urls", sign_cert: "sign_cert", idp_initiated: "idp_initiated", allowed_idps: "idp_ids", excluded_idps: "idp_ids", protocol: "protocol" };
const FIELD_LABEL = { name_en: "c_f_name_en", name_zh: "c_f_name_zh", domain: "c_f_domain", homepage: "c_f_homepage", redirect_uris: "c_f_redirects", post_logout_redirect_uris: "c_f_logout", auth_method: "c_f_auth", jwks_uri: "c_f_jwks", id_token_signed_response_alg: "c_f_idtoken_alg", subject_type: "c_f_subject", entity_id: "c_f_entity", acs_urls: "c_f_acs", sign_cert: "c_f_sign_cert", idp_initiated: "c_f_idp_initiated", idp_ids: "c_f_field_idps", protocol: "c_protocol" };
export const formField = (field) => FORM_FIELD[String(field || "").replace(/\[.*$/, "")] || null;
const NO_DETAIL = new Set(["rate", "frozen", "cap_global"]);
const errorsBox = (lang, errors, { appHref } = {}) => (errors && errors.length ? `<div class="alert" role="alert">${icon("alert")}<div><p>${esc(t(lang, "c_fix"))}</p><ul class="errs">${errors.map((e) => {
  const f = formField(e.field);
  const known = t(lang, "chk_" + e.code) !== "chk_" + e.code;
  const detail = String(e.message || "").replace(/^[\w.\[\]]+: /, "");
  return `<li data-code="${esc(e.code)}">${f ? `<a href="#f-${esc(f)}" data-field="${esc(f)}">${esc(t(lang, FIELD_LABEL[f]))}</a>: ` : ""}${known ? esc(t(lang, "chk_" + e.code)) : ""}${e.code === "frozen" && appHref ? ` <a href="${esc(appHref)}#status">${esc(t(lang, "c_appeal_link"))}</a>` : ""}${detail && !NO_DETAIL.has(e.code) ? ` <span class="mono">${esc(detail)}</span>` : ""}</li>`;
}).join("")}</ul></div></div>` : "");
const reasonText = (lang, r) => (r && /^sys_[a-z_]+$/.test(r) ? t(lang, r) : r || "");
const notice = (text, kind = "") => `<div class="notice ${kind}">${text}</div>`;

// s.idp_name: the identity provider's name in this language (set by the routes).
function userBar(lang, s) {
  return `<div class="userbar"><span>${esc(t(lang, "c_signed_in_as"))} <b>${esc(s.name || s.email || s.sub.slice(0, 10))}</b>${s.email ? ` <span class="mono">${esc(s.email)}</span>` : ""} · <span class="idp-name">${esc(s.idp_name || s.idp)}</span></span>
<form method="post" action="${esc(localPath(lang, "/console/logout"))}">${csrfField(s)}<button class="linkbtn" type="submit">${esc(t(lang, "c_sign_out"))}</button></form></div>`;
}

const page = (v, title, body, active = "", head = "") => contentPage({ ...v, active, title, body, head });

// ---- console ------------------------------------------------------------------

const howSteps = (lang) => `<ol class="steps">${[1, 2, 3, 4].map((i) => `<li>${esc(t(lang, "c_how" + i))}</li>`).join("")}</ol>`;

export function consoleLanding(v, { msg } = {}) {
  const body = `<h1 class="title">${esc(t(v.lang, "c_title"))}</h1><p class="lead">${esc(t(v.lang, "c_lead"))}</p>
${msg ? notice(esc(t(v.lang, "c_signin_" + msg)), "warn") : ""}
<div class="btnrow"><a class="pill" href="/console/login${v.lang === "zh" ? `?next=${encodeURIComponent(P(v, "/console"))}` : ""}" id="console-signin">${esc(t(v.lang, "c_signin"))}</a><a class="pill ghost" href="${esc(P(v, "/apps"))}">${esc(t(v.lang, "apps_title"))}</a></div>
<p class="lead"><a href="${esc(REGISTRY_DOCS[v.lang])}" id="pr-channel">${esc(t(v.lang, "pr_channel"))}</a></p>
${sec(t(v.lang, "c_how"), howSteps(v.lang))}`;
  return page(v, t(v.lang, "c_title"), body);
}

export function consoleHome(v, { s, apps, invites }) {
  const L = (k) => ` data-label="${esc(t(v.lang, k))}"`;
  const rows = apps.map((a) => `<tr><td${L("col_name")}><a href="${esc(P(v, `/console/app/${a.client_id}`))}"><b>${esc(localName(a, v.lang))}</b></a><br><span class="mono">${esc(a.client_id)}</span></td><td${L("c_domain")}><code>${esc(a.domain)}</code></td><td${L("c_protocol")}>${a.protocol === "saml2" ? "SAML 2.0" : "OpenID Connect"}</td><td${L("col_status")}>${statusBadge(v.lang, appStatus(a.app))}</td><td${L("c_role")}>${esc(t(v.lang, "c_role_" + a.role))}</td></tr>`).join("");
  const inv = invites.length ? sec(t(v.lang, "c_invites"), invites.map((i) => `<p>${esc(t(v.lang, "c_invite_pending", { app: i.name }))}</p>`).join("")) : "";
  const body = `<h1 class="title">${esc(t(v.lang, "c_title"))}</h1>${userBar(v.lang, s)}
<div class="btnrow"><a class="pill" href="${esc(P(v, "/console/new"))}" id="new-app">${esc(t(v.lang, "c_new"))}</a>${v.operator ? `<a class="pill ghost" href="${esc(P(v, "/admin/reports"))}">${esc(t(v.lang, "adm_title"))}</a>` : ""}</div>
${inv}
${sec(t(v.lang, "c_my_apps"), apps.length ? `<div class="scroll"><table class="tbl stack"><thead><tr><th>${esc(t(v.lang, "col_name"))}</th><th>${esc(t(v.lang, "c_domain"))}</th><th>${esc(t(v.lang, "c_protocol"))}</th><th>${esc(t(v.lang, "col_status"))}</th><th>${esc(t(v.lang, "c_role"))}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div id="no-apps"><p>${esc(t(v.lang, "c_no_apps"))} ${esc(t(v.lang, "c_no_apps_next"))}</p>${howSteps(v.lang)}<div class="btnrow"><a class="pill" href="${esc(P(v, "/console/new"))}" id="new-app-empty">${esc(t(v.lang, "c_new"))}</a><a class="pill ghost" href="${esc(RP_DOCS[v.lang])}">${esc(t(v.lang, "c_guide"))}</a></div></div>`)}`;
  return page(v, t(v.lang, "c_title"), body);
}

// The create / edit form. `f` holds the submitted or stored values.
export function appForm(v, { s, f = {}, errors = [], idps = [], action, title, submit, appHref }) {
  const val = (k) => esc(f[k] ?? "");
  const lines = (k) => esc(Array.isArray(f[k]) ? f[k].join("\n") : f[k] ?? "");
  const proto = f.protocol === "saml2" ? "saml2" : "oidc";
  const method = f.auth_method || "client_secret_basic";
  const idpMode = ["only", "except"].includes(f.idp_mode) ? f.idp_mode : "all";
  const picked = new Set(Array.isArray(f.idp_ids) ? f.idp_ids : []);
  // Selected ids that are no longer active stay visible (and selected), so saving does not drop them silently.
  const pickable = [...idps, ...[...picked].filter((id) => !idps.some((i) => i.id === id)).map((id) => ({ id, name: { en: id } }))];
  // Fields named by an error: marked, with an id the error list links to.
  const bad = new Set(errors.map((e) => formField(e.field)).filter(Boolean));
  const field = (name, label, input, hint) => `<label class="field${bad.has(name) ? " invalid" : ""}"><span class="lbl">${esc(label)}</span>${input.replace(` name="${name}"`, ` id="f-${name}" name="${name}"${bad.has(name) ? ' aria-invalid="true"' : ""}`)}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</label>`;
  const opt = (value, label, cur) => `<option value="${esc(value)}"${value === cur ? " selected" : ""}>${esc(label)}</option>`;
  const body = `<h1 class="title">${esc(title)}</h1>${userBar(v.lang, s)}
${errorsBox(v.lang, errors, { appHref: appHref ? P(v, appHref) : null })}
<form class="form" method="post" action="${esc(P(v, action))}">${csrfField(s)}
${sec(t(v.lang, "c_f_identity"), `
${field("name_en", t(v.lang, "c_f_name_en"), `<input name="name_en" required maxlength="60" value="${val("name_en")}">`)}
${field("name_zh", t(v.lang, "c_f_name_zh"), `<input name="name_zh" maxlength="60" value="${val("name_zh")}">`, t(v.lang, "c_f_optional"))}
${field("domain", t(v.lang, "c_f_domain"), `<input name="domain" required maxlength="253" autocapitalize="off" spellcheck="false" placeholder="example.com" value="${val("domain")}">`, t(v.lang, "c_f_domain_hint"))}
${field("homepage", t(v.lang, "c_f_homepage"), `<input name="homepage" type="url" required maxlength="300" placeholder="https://example.com/" value="${val("homepage")}">`)}`)}
${sec(t(v.lang, "c_protocol"), `<div class="seg-radio" role="radiogroup"><label><input type="radio" name="protocol" value="oidc"${proto === "oidc" ? " checked" : ""}> OpenID Connect</label><label><input type="radio" name="protocol" value="saml2"${proto === "saml2" ? " checked" : ""}> SAML 2.0</label></div>
<div class="when-oidc">
${field("redirect_uris", t(v.lang, "c_f_redirects"), `<textarea name="redirect_uris" rows="3" spellcheck="false" placeholder="https://app.example.com/auth/callback">${lines("redirect_uris")}</textarea>`, t(v.lang, "c_f_redirects_hint"))}
${field("post_logout_redirect_uris", t(v.lang, "c_f_logout"), `<textarea name="post_logout_redirect_uris" rows="2" spellcheck="false">${lines("post_logout_redirect_uris")}</textarea>`, t(v.lang, "c_f_optional"))}
${field("auth_method", t(v.lang, "c_f_auth"), `<select name="auth_method">${opt("client_secret_basic", t(v.lang, "c_auth_basic"), method)}${opt("client_secret_post", t(v.lang, "c_auth_post"), method)}${opt("private_key_jwt", t(v.lang, "c_auth_jwt"), method)}${opt("none", t(v.lang, "c_auth_none"), method)}</select>`)}
${field("jwks_uri", t(v.lang, "c_f_jwks"), `<input name="jwks_uri" type="url" maxlength="300" value="${val("jwks_uri")}">`, t(v.lang, "c_f_jwks_hint"))}
${field("id_token_signed_response_alg", t(v.lang, "c_f_idtoken_alg"), `<select name="id_token_signed_response_alg">${opt("RS256", "RS256", f.id_token_alg || "RS256")}${opt("ES256", "ES256", f.id_token_alg || "RS256")}</select>`, t(v.lang, "c_f_idtoken_alg_hint"))}
</div>
<div class="when-saml">
${field("entity_id", t(v.lang, "c_f_entity"), `<input name="entity_id" maxlength="300" spellcheck="false" value="${val("entity_id")}">`)}
${field("acs_urls", t(v.lang, "c_f_acs"), `<textarea name="acs_urls" rows="2" spellcheck="false">${lines("acs_urls")}</textarea>`, t(v.lang, "c_f_redirects_hint"))}
<label class="check${bad.has("idp_initiated") ? " invalid" : ""}"><input type="checkbox" id="f-idp_initiated" name="idp_initiated" value="yes"${f.idp_initiated ? " checked" : ""}> ${esc(t(v.lang, "c_f_idp_initiated"))}</label>
${field("sign_cert", t(v.lang, "c_f_sign_cert"), `<textarea name="sign_cert" rows="3" spellcheck="false">${val("sign_cert")}</textarea>`, t(v.lang, "c_f_optional"))}
</div>
${field("subject_type", t(v.lang, "c_f_subject"), `<select name="subject_type">${opt("public", t(v.lang, "c_subject_public"), f.subject_type || "public")}${opt("pairwise", t(v.lang, "c_subject_pairwise"), f.subject_type || "public")}</select>`)}
<fieldset class="field idp-pick${bad.has("idp_ids") ? " invalid" : ""}" id="f-idp_ids"><legend class="lbl">${esc(t(v.lang, "c_f_allowed"))}</legend>
<div class="seg-radio" role="radiogroup">${["all", "only", "except"].map((m) => `<label><input type="radio" name="idp_mode" value="${m}"${idpMode === m ? " checked" : ""}> ${esc(t(v.lang, `c_idp_${m}`))}</label>`).join("")}</div>
${["all", "only", "except"].map((m) => `<span class="hint mode-hint ${m}">${esc(t(v.lang, `c_idp_${m}_hint`))}</span>`).join("")}
<div class="idp-list"><input type="search" class="idp-q" placeholder="${esc(t(v.lang, "c_idp_search"))}" aria-label="${esc(t(v.lang, "c_idp_search"))}" autocomplete="off" spellcheck="false">
<div class="checks">${pickable.map((i) => `<label data-q="${esc(searchText(i))}"><input type="checkbox" name="idp_ids" value="${esc(i.id)}"${picked.has(i.id) ? " checked" : ""}> ${esc(localName(i, v.lang))}</label>`).join("")}</div></div></fieldset>`)}
<div class="btnrow"><button class="pill" type="submit" id="save-app">${esc(submit)}</button><a class="pill ghost" href="${esc(P(v, appHref || "/console"))}">${esc(t(v.lang, "c_cancel"))}</a></div>
</form>`;
  return page(v, title, body);
}

// Why the domain proof failed, from the stored check result (an English
// technical sentence, see src/apps/checks.js proveAppDomain), in the page's language.
export function proofWhy(lang, app, err) {
  if (!err) return [];
  const name = `_roamid-app.${app.domain}`, url = `https://${app.domain}/.well-known/roamid-app.txt`, id = app.client_id;
  const out = [];
  if (/^TXT /.test(err) || /does not contain/.test(err)) out.push(t(lang, "proof_why_txt", { name, id }));
  let m;
  if ((m = /returned HTTP (\d+)/.exec(err))) out.push(t(lang, "proof_why_http", { url, status: m[1] }));
  else if (/does not contain/.test(err)) out.push(t(lang, "proof_why_content", { url, id }));
  else out.push(t(lang, "proof_why_fetch", { url }));
  return out;
}

// A failure code of the sign-in statistics, readable (src/ui/i18n.js error codes).
const failText = (lang, code) => (/^upstream_/.test(code || "") ? t(lang, "c_fail_upstream", { e: code.slice(9) }) : ERROR_CODES.includes(code) ? errorText(lang, code) : code || "?");
const ERRORS_DOC = `${REPO}/blob/main/docs/errors.md`;

export function appPage(v, { s, app, row, owners, audit, stats, secret, invite, openAppeal, base, msg, role }) {
  const a = app.app;
  const st = appStatus(a);
  const L = v.lang;
  const AP = (x = "") => P(v, `/console/app/${app.client_id}${x}`);
  const isSaml = app.protocol === "saml2";
  const proof = `<p>${esc(t(L, "c_proof_lead"))}</p>
${kv([[t(L, "c_proof_txt"), `<code>_roamid-app.${esc(app.domain)}</code> TXT <code>roamid-app=${esc(app.client_id)}</code>`], [t(L, "c_proof_file"), `<code>https://${esc(app.domain)}/.well-known/roamid-app.txt</code> → <code>${esc(app.client_id)}</code>`], [t(L, "c_proof_state"), a.domain_verified ? (a.domain_failing_since ? `<span class="badge warn">${esc(t(L, "proof_grace"))}</span>` : `<span class="badge ok">${esc(t(L, "proof_verified"))}</span>`) : `<span class="badge warn">${esc(t(L, "proof_pending"))}</span>`], [t(L, "c_proof_checked"), esc(when(row.domain_checked_at))], ...(row.domain_error ? [[t(L, "status_error"), `<span id="proof-why">${proofWhy(L, app, row.domain_error).map(esc).join(" ")}</span><details class="tech"><summary>${esc(t(L, "proof_why_details"))}</summary><p class="mono">${esc(row.domain_error)}</p></details>`]] : [])])}
<form method="post" action="${esc(AP("/check"))}">${csrfField(s)}<div class="btnrow"><button class="pill" type="submit" id="check-now">${esc(t(L, "c_check_now"))}</button></div></form>`;
  const integration = isSaml
    ? kv([[t(L, "c_idp_metadata"), `<code>${esc(base)}/saml/idp/metadata.xml</code>`], ["Entity ID", `<code>${esc(app.entity_id)}</code>`], ["ACS", (app.acs_urls || []).map((u) => `<code>${esc(u)}</code>`).join("<br>")], [t(L, "c_f_subject"), esc(t(L, "c_subject_" + (app.subject_type || "public")))]])
    : kv([["client_id", `<code id="client-id">${esc(app.client_id)}</code> ${copyBtn(L, "client-id")}`], ["Issuer", `<code>${esc(base)}</code>`], [t(L, "c_discovery"), `<code>${esc(base)}/.well-known/openid-configuration</code>`], [t(L, "c_f_redirects"), (app.redirect_uris || []).map((u) => `<code>${esc(u)}</code>`).join("<br>")], [t(L, "c_f_auth"), `<code>${esc(app.token_endpoint_auth_method)}</code>`], [t(L, "c_f_idtoken_alg"), `<code id="id-token-alg">${esc(app.id_token_signed_response_alg || "RS256")}</code>`], [t(L, "c_f_subject"), esc(t(L, "c_subject_" + (app.subject_type || "public")))]]);
  const usesSecret = !isSaml && /^client_secret_/.test(app.token_endpoint_auth_method);
  const secretBox = usesSecret ? `${secret ? `<div class="notice ok"><p>${esc(t(L, "c_secret_once"))}</p><p><code class="secret" id="client-secret">${esc(secret)}</code> ${copyBtn(L, "client-secret")}</p><p class="hint">${esc(t(L, "c_secret_where"))}</p></div>` : ""}
<p>${esc(t(L, row.secret_sha256_old ? "c_secret_two" : "c_secret_one"))}</p>
<div class="btnrow"><form method="post" action="${esc(AP("/secret"))}">${csrfField(s)}<button class="pill ghost" type="submit" id="rotate-secret">${esc(t(L, "c_secret_new"))}</button></form>${row.secret_sha256_old ? `<form method="post" action="${esc(AP("/secret/revoke"))}">${csrfField(s)}<button class="pill ghost" type="submit" id="revoke-secret">${esc(t(L, "c_secret_revoke"))}</button></form>` : ""}</div>` : "";
  // An owner: the email address (or, without one, the name of this session's
  // account), the identifier behind a copy button.
  const ownerLabel = (o) => o.email || (o.sub === s.sub && s.name ? `${s.name} · ${t(L, "c_owner_at", { idp: s.idp_name || s.idp })}` : t(L, "c_owner_noemail"));
  const ownerRows = owners.map((o, i) => `<tr><td>${esc(ownerLabel(o))}${o.sub === s.sub ? ` (${esc(t(L, "c_you"))})` : ""}<code class="sub-id" id="owner-sub-${i}" hidden>${esc(o.sub)}</code> ${copyBtn(L, `owner-sub-${i}`, t(L, "c_copy_id"))}</td><td>${esc(t(L, "c_role_" + o.role))}</td><td>${role === "owner" && o.role === "co-owner" ? `<form method="post" action="${esc(AP("/owners/remove"))}">${csrfField(s)}<input type="hidden" name="sub" value="${esc(o.sub)}"><button class="linkbtn" type="submit">${esc(t(L, "c_remove"))}</button></form>` : ""}</td></tr>`).join("");
  const coOwners = owners.filter((o) => o.role === "co-owner");
  const ownersBox = `<div class="scroll"><table class="tbl stack"><tbody>${ownerRows}</tbody></table></div>
${invite ? `<div class="notice ok"><p>${esc(t(L, "c_invite_link"))}</p><p><code class="secret" id="invite-link">${esc(invite)}</code> ${copyBtn(L, "invite-link")}</p><p class="hint">${esc(t(L, "c_invite_where"))}</p></div>` : ""}
<form class="inline" method="post" action="${esc(AP("/owners/invite"))}">${csrfField(s)}<label class="field"><span class="lbl">${esc(t(L, "c_invite_email"))}</span><input type="email" name="email" required maxlength="254"></label><button class="pill ghost" type="submit" id="invite">${esc(t(L, "c_invite"))}</button></form>
${role === "owner" && coOwners.length ? `<form class="inline" method="post" action="${esc(AP("/owners/transfer"))}">${csrfField(s)}<label class="field"><span class="lbl">${esc(t(L, "c_transfer"))}</span><select name="sub">${coOwners.map((o) => `<option value="${esc(o.sub)}">${esc(o.email ? o.email : `${t(L, "c_owner_noemail")} · ${o.sub.slice(0, 8)}`)}</option>`).join("")}</select></label><button class="pill ghost" type="submit">${esc(t(L, "c_transfer_go"))}</button></form>` : ""}`;
  const statRows = stats.map((r) => `<tr><td class="mono">${esc(r.day)}</td><td>${r.started}</td><td>${r.completed}</td><td>${r.failed}${r.codes.length ? `<ul class="fails">${r.codes.map((c) => `<li><span title="${esc(c.code || "")}">${esc(failText(L, c.code))}</span> × ${c.n}</li>`).join("")}</ul>` : ""}</td></tr>`).join("");
  const statsBox = stats.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>${esc(t(L, "c_day"))}</th><th>${esc(t(L, "status_started"))}</th><th>${esc(t(L, "status_completed"))}</th><th>${esc(t(L, "status_failed"))}</th></tr></thead><tbody>${statRows}</tbody></table></div>${stats.some((r) => r.codes.length) ? `<p class="hint"><a href="${esc(ERRORS_DOC)}">${esc(t(L, "c_fail_doc"))}</a></p>` : ""}` : `<p class="muted-p">${esc(t(L, "c_no_stats"))}</p>`;
  const auditBox = audit.length ? `<div class="scroll"><table class="tbl stack"><tbody>${audit.map((r) => `<tr><td class="mono">${esc(when(r.at))}</td><td>${esc(t(L, "act_" + r.action))}</td><td>${esc(reasonText(L, r.reason))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted-p">-</p>`;
  const blocked = st === "suspended" || st === "banned";
  const statusText = st === "development" ? t(L, "c_dev_note") : st === "unverified" ? t(L, "c_unverified_note") : st === "active" ? (a.active_since && !a.limit_lifted && Date.now() / 1000 - a.active_since < 7 * 86400 ? t(L, "c_new_limit_note") : t(L, "c_active_note")) : t(L, "c_blocked_note");
  const appeal = blocked ? (openAppeal ? `<p>${esc(t(L, "c_appeal_open"))}</p>` : `<form method="post" action="${esc(AP("/appeal"))}">${csrfField(s)}<label class="field"><span class="lbl">${esc(t(L, "c_appeal"))}</span><textarea class="prose" name="text" rows="4" required maxlength="4000"></textarea></label><button class="pill" type="submit" id="appeal">${esc(t(L, "c_appeal_send"))}</button></form>`) : "";
  const WARN = new Set(["checked_fail", "rate", "appeal_short", "bad_email"]);
  const msgText = msg ? esc(t(L, "c_msg_" + msg)) + (msg === "checked_fail" ? ` ${proofWhy(L, app, row.domain_error).map(esc).join(" ")}` : "") : "";
  const body = `<p class="crumb"><a href="${esc(P(v, "/console"))}">${esc(t(L, "c_title"))}</a></p>
<h1 class="title">${esc(localName(app, L))}</h1>${userBar(L, s)}
${msg ? `<div class="notice ${WARN.has(msg) ? "warn" : "ok"}" id="msg" data-msg="${esc(msg)}">${msgText}</div>` : ""}
${sec(t(L, "col_status"), `${kv([[t(L, "col_status"), statusBadge(L, st)], [t(L, "c_domain"), `<code>${esc(app.domain)}</code>`], [t(L, "c_created"), esc(day(a.created_at))], ...(a.reason ? [[t(L, "c_reason"), esc(a.reason)]] : [])])}<p class="muted-p">${esc(statusText)}</p>${appeal}`, "status")}
${sec(t(L, "c_domain_proof"), proof, "domain")}
${sec(t(L, "c_integration"), integration + secretBox, "integration")}
${sec(t(L, "c_stats"), statsBox, "stats")}
${sec(t(L, "c_owners"), ownersBox, "owners")}
${sec(t(L, "c_history"), auditBox, "history")}
<div class="btnrow"><a class="pill ghost" href="${esc(AP("/edit"))}" id="edit-app">${esc(t(L, "c_edit"))}</a><a class="pill ghost" href="${esc(P(v, `/apps/${app.client_id}`))}">${esc(t(L, "c_public_page"))}</a></div>
${role === "owner" ? sec(t(L, "c_delete"), `<form method="post" action="${esc(AP("/delete"))}">${csrfField(s)}<label class="check"><input type="checkbox" name="confirm" value="yes" required> ${esc(t(L, "c_delete_confirm"))}</label><div class="btnrow"><button class="pill danger" type="submit" id="delete-app">${esc(t(L, "c_delete_go"))}</button></div></form>`) : ""}`;
  return page(v, localName(app, L), body);
}

export function invitePage(v, { s, invite, app, ok, error, domain }) {
  const body = `<h1 class="title">${esc(t(v.lang, "c_invite_title"))}</h1>${userBar(v.lang, s)}
${error ? notice(esc(t(v.lang, "c_invite_err_" + error, { domain: domain || "" })), "warn") : ""}
${app && !error ? `<p class="lead">${esc(t(v.lang, "c_invite_for", { app: localName(app, v.lang) }))} <span class="mono">${esc(invite.email)}</span></p>
<form method="post" action="${esc(P(v, `/console/invite/${ok}`))}">${csrfField(s)}<div class="btnrow"><button class="pill" type="submit" id="accept-invite">${esc(t(v.lang, "c_invite_accept"))}</button></div></form>` : ""}
<div class="btnrow"><a class="pill ghost" href="${esc(P(v, "/console"))}">${esc(t(v.lang, "c_title"))}</a></div>`;
  return page(v, t(v.lang, "c_invite_title"), body);
}

// ---- public application list ------------------------------------------------------

export function appsList(v, { apps }) {
  const L = (k) => ` data-label="${esc(t(v.lang, k))}"`;
  const rows = apps.map((a) => `<tr><td${L("col_name")}><a href="${esc(P(v, `/apps/${a.client_id}`))}"><b>${esc(localName(a, v.lang))}</b></a><br><span class="mono">${esc(a.client_id)}</span></td><td${L("c_domain")}><code>${esc(a.domain || "-")}</code></td><td${L("c_created")}>${esc(a.created || "-")}</td><td${L("col_status")}>${statusBadge(v.lang, a.status)}</td></tr>`).join("");
  const body = `<h1 class="title">${esc(t(v.lang, "apps_title"))}</h1><p class="lead">${esc(t(v.lang, "apps_lead"))}</p>
<div class="section box"><div class="scroll"><table class="tbl stack"><thead><tr><th>${esc(t(v.lang, "col_name"))}</th><th>${esc(t(v.lang, "c_domain"))}</th><th>${esc(t(v.lang, "c_created"))}</th><th>${esc(t(v.lang, "col_status"))}</th></tr></thead><tbody>${rows}</tbody></table></div></div>
<p class="lead"><a href="/apps.json">/apps.json</a> · <a href="${esc(P(v, "/report"))}">${esc(t(v.lang, "rep_link"))}</a></p>`;
  return page(v, t(v.lang, "apps_title"), body, "apps");
}

export function appPublic(v, { a }) {
  const body = `<p class="crumb"><a href="${esc(P(v, "/apps"))}">${esc(t(v.lang, "apps_title"))}</a></p><h1 class="title">${esc(localName(a, v.lang))}</h1>
${sec(t(v.lang, "c_details"), kv([["client_id", `<code>${esc(a.client_id)}</code>`], [t(v.lang, "c_domain"), `<code>${esc(a.domain || "-")}</code>`], [t(v.lang, "c_f_homepage"), a.homepage ? `<code>${esc(a.homepage)}</code>` : "-"], [t(v.lang, "c_protocol"), a.protocol === "saml2" ? "SAML 2.0" : "OpenID Connect"], [t(v.lang, "c_created"), esc(a.created || "-")], [t(v.lang, "col_status"), statusBadge(v.lang, a.status)], [t(v.lang, "c_source"), esc(t(v.lang, a.source === "registry" ? "c_source_registry" : "c_source_console"))]]))}
<div class="btnrow"><a class="pill ghost" href="${esc(P(v, `/report?app=${encodeURIComponent(a.client_id)}`))}" id="report-app">${esc(t(v.lang, "rep_this_app"))}</a></div>`;
  return page(v, localName(a, v.lang), body, "apps");
}

// ---- report form ----------------------------------------------------------------

export const CATEGORIES = ["phishing", "fraud", "malware", "illegal", "other"];

// options: { apps: [{ id, name, domain }], idps: [{ id, name, domain }] }, the
// targets to choose from (names in this language). Without JavaScript the
// list is a plain select; with it, a search field filters it.
export function reportPage(v, { target, targetName, tx, check = "", errors = [], sent, f = {}, options = { apps: [], idps: [] } }) {
  if (sent) return page(v, t(v.lang, "rep_title"), `<h1 class="title">${esc(t(v.lang, "rep_sent_title"))}</h1><p class="lead">${esc(t(v.lang, "rep_sent_lead"))}</p><p class="lead mono" id="report-id">${esc(sent)}</p><div class="btnrow"><a class="pill ghost" href="${esc(P(v, "/"))}">${esc(t(v.lang, "err_home"))}</a></div>`);
  const kind = target && target.kind;
  const opt = (k, o) => `<option value="${esc(`${k}:${o.id}`)}" data-q="${esc(norm([o.names && o.names.en, o.names && o.names.zh, o.id, o.domain].filter(Boolean).join(" ")))}"${f.target === `${k}:${o.id}` ? " selected" : ""}>${esc(o.name)}${o.domain ? ` (${esc(o.domain)})` : ""}</option>`;
  const picker = `<label class="field${errors.includes("target") ? " invalid" : ""}"><span class="lbl">${esc(t(v.lang, "rep_target"))}</span>
<input type="search" class="target-q" placeholder="${esc(t(v.lang, "rep_target_search"))}" aria-label="${esc(t(v.lang, "rep_target_search"))}" aria-controls="f-target" autocomplete="off" spellcheck="false" hidden>
<select name="target" id="f-target"${errors.includes("target") ? ' aria-invalid="true"' : ""}><option value="">${esc(t(v.lang, "rep_target_pick"))}</option>
${options.apps.length ? `<optgroup label="${esc(t(v.lang, "apps_title"))}">${options.apps.map((o) => opt("app", o)).join("")}</optgroup>` : ""}
${options.idps.length ? `<optgroup label="${esc(t(v.lang, "nav_idps"))}">${options.idps.map((o) => opt("idp", o)).join("")}</optgroup>` : ""}</select></label>
<details class="manual"${f.target_id ? " open" : ""}><summary>${esc(t(v.lang, "rep_target_manual"))}</summary>
<label class="field"><span class="lbl">${esc(t(v.lang, "rep_target_id"))}</span><input name="target_id" id="f-target_id" maxlength="80" spellcheck="false" autocapitalize="off" value="${esc(f.target_id || "")}"><span class="hint">${esc(t(v.lang, "rep_target_id_hint"))}</span></label>
<div class="seg-radio"><label><input type="radio" name="target_kind" value="app"${f.target_kind !== "idp" ? " checked" : ""}> ${esc(t(v.lang, "rep_target_app"))}</label><label><input type="radio" name="target_kind" value="idp"${f.target_kind === "idp" ? " checked" : ""}> ${esc(t(v.lang, "rep_target_idp"))}</label></div></details>`;
  const body = `<h1 class="title">${esc(t(v.lang, "rep_title"))}</h1><p class="lead">${esc(t(v.lang, "rep_lead"))}</p>
${errors.length ? `<div class="alert" role="alert">${icon("alert")}<div>${errors.map((e) => `<p data-err="${esc(e)}">${esc(t(v.lang, "rep_err_" + e))}</p>`).join("")}</div></div>` : ""}
<form class="form" method="post" action="${esc(P(v, "/report"))}" id="report-form">
<input type="hidden" name="tx" value="${esc(tx || "")}">
<div class="section"><div class="box">
${target ? `<input type="hidden" name="target" value="${esc(`${target.kind}:${target.id}`)}"><input type="hidden" name="fixed" value="1">${kv([[t(v.lang, kind === "idp" ? "rep_target_idp" : "rep_target_app"), `<b>${esc(targetName || target.id)}</b> <span class="mono">${esc(target.id)}</span>`]])}<p class="hint"><a href="${esc(P(v, "/report"))}" id="report-other">${esc(t(v.lang, "rep_change"))}</a></p>`
    : picker}
<fieldset class="field"><legend class="lbl">${esc(t(v.lang, "rep_category"))}</legend><div class="checks">${CATEGORIES.map((c, i) => `<label><input type="radio" name="category" value="${c}"${(f.category ? f.category === c : i === 0) ? " checked" : ""}> ${esc(t(v.lang, "rep_cat_" + c))}</label>`).join("")}</div></fieldset>
<label class="field${errors.includes("description") ? " invalid" : ""}"><span class="lbl">${esc(t(v.lang, "rep_description"))}</span><textarea class="prose" name="description" rows="5" required minlength="10" maxlength="4000">${esc(f.description || "")}</textarea></label>
<label class="field${errors.includes("email") ? " invalid" : ""}"><span class="lbl">${esc(t(v.lang, "rep_email"))}</span><input type="email" name="contact_email" maxlength="254" value="${esc(f.contact_email || "")}"><span class="hint">${esc(t(v.lang, "rep_email_hint"))}</span></label>
${check || ""}
<label class="check"><input type="checkbox" name="no_publish" value="yes"${f.no_publish ? " checked" : ""}> ${esc(t(v.lang, "rep_no_publish"))}</label>
<p class="hint">${esc(t(v.lang, "rep_publish_note"))}</p>
<p class="hint">${esc(t(v.lang, "rep_privacy"))}</p>
<div class="btnrow"><button class="pill" type="submit" id="send-report">${esc(t(v.lang, "rep_send"))}</button></div>
</div></div></form>`;
  return page(v, t(v.lang, "rep_title"), body, "", check ? humanCheck.script || "" : "");
}

// ---- operator ---------------------------------------------------------------------

const KIND_KEY = { app: "rep_target_app", idp: "rep_target_idp" };
const targetHref = (v, kind, id) => P(v, `/admin/target/${kind}/${id}`);
// Who acted: the operator's email address when the audit row has it.
const actorText = (lang, s, r) => (r.actor_email ? r.actor_email : r.actor === s.sub ? t(lang, "adm_by_you") : ["system", "github"].includes(r.actor) ? r.actor : t(lang, "adm_by_operator", { id: String(r.actor || "").slice(0, 8) }));
const lookupForm = (v, q = "") => `<form class="inline" method="get" action="${esc(P(v, "/admin/target"))}" id="lookup"><label class="field"><span class="lbl">${esc(t(v.lang, "adm_lookup"))}</span><input type="search" name="q" required maxlength="120" spellcheck="false" autocapitalize="off" value="${esc(q)}"></label><button class="pill ghost" type="submit">${esc(t(v.lang, "adm_open_target"))}</button></form>`;

export function adminQueue(v, { s, items, recent }) {
  const L = (k) => ` data-label="${esc(t(v.lang, k))}"`;
  const rows = items.map((r) => `<tr${r.ids ? ` id="${esc(r.ids[0])}"` : ""}><td${L("adm_target")}>${(r.ids || []).slice(1).map((x) => `<span id="${esc(x)}"></span>`).join("")}<a href="${esc(targetHref(v, r.target_kind, r.target_id))}"><b>${esc(r.name || r.target_id)}</b></a><br><span class="hint">${esc(t(v.lang, KIND_KEY[r.target_kind] || "adm_target"))} · <span class="mono">${esc(r.target_id)}</span></span></td><td${L("adm_open")}>${r.open}${r.appeals ? ` · ${esc(t(v.lang, "adm_appeals", { n: r.appeals }))}` : ""}</td><td${L("adm_priority")}><span class="badge ${r.reporters24 >= 3 ? "bad" : r.reporters24 >= 1 ? "warn" : ""}">${esc(t(v.lang, "adm_reporters", { n: r.reporters24 }))}</span></td><td${L("adm_categories")}>${esc(r.categories.map((c) => t(v.lang, "rep_cat_" + c)).join(", "))}</td><td${L("adm_latest")} class="mono">${esc(when(r.latest))}</td></tr>`).join("");
  const body = `<h1 class="title">${esc(t(v.lang, "adm_title"))}</h1>${userBar(v.lang, s)}
${lookupForm(v)}
${sec(t(v.lang, "adm_queue"), items.length ? `<div class="scroll"><table class="tbl stack"><thead><tr><th>${esc(t(v.lang, "adm_target"))}</th><th>${esc(t(v.lang, "adm_open"))}</th><th>${esc(t(v.lang, "adm_priority"))}</th><th>${esc(t(v.lang, "adm_categories"))}</th><th>${esc(t(v.lang, "adm_latest"))}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted-p" id="queue-empty">${esc(t(v.lang, "adm_empty"))}</p>`)}
${sec(t(v.lang, "adm_recent"), recent.length ? `<div class="scroll"><table class="tbl stack" id="recent"><tbody>${recent.map((r) => `<tr><td class="mono">${esc(when(r.at))}</td><td><a href="${esc(targetHref(v, r.target_kind, r.target_id))}">${esc(r.name || r.target_id)}</a> <span class="mono hint">${esc(r.target_id)}</span></td><td>${esc(t(v.lang, "act_" + r.action))}</td><td>${esc(reasonText(v.lang, r.reason))}</td><td>${esc(actorText(v.lang, s, r))}</td></tr>`).join("")}</tbody></table></div>` : "-")}`;
  return page(v, t(v.lang, "adm_title"), body);
}

// The lookup's matches (several, or none).
export function adminSearch(v, { s, q, results }) {
  const body = `<p class="crumb"><a href="${esc(P(v, "/admin/reports"))}">${esc(t(v.lang, "adm_title"))}</a></p><h1 class="title">${esc(results.length ? t(v.lang, "adm_results", { q }) : t(v.lang, "adm_no_match", { q }))}</h1>${userBar(v.lang, s)}
${lookupForm(v, q)}
${results.length ? `<div class="section box"><ul class="plain" id="matches">${results.map((r) => `<li><a href="${esc(targetHref(v, r.kind, r.id))}"><b>${esc(r.name)}</b></a> <span class="hint">${esc(t(v.lang, KIND_KEY[r.kind]))} · <span class="mono">${esc(r.id)}</span>${r.domain ? ` · <code>${esc(r.domain)}</code>` : ""}</span></li>`).join("")}</ul></div>` : ""}`;
  return page(v, t(v.lang, "adm_title"), body);
}

export function adminTarget(v, { s, kind, id, name, info, reports, audit, actions }) {
  // One form: the open items the decision is based on, the reason, and one
  // button per action (formaction). Unticked items stay open.
  const open = reports.filter((r) => r.state === "open");
  const firstLine = (x) => { const l = String(x || "").split(/\r?\n/).find((y) => y.trim()) || ""; return l.length > 90 ? `${l.slice(0, 89)}…` : l; };
  const basis = open.length ? `<fieldset class="basis"><legend class="lbl">${esc(t(v.lang, "adm_basis"))}</legend>${open.map((r) => `<label class="check"><input type="checkbox" name="report_ids" value="${esc(r.id)}"> <span><b>${esc(r.kind === "appeal" ? t(v.lang, "adm_appeal") : t(v.lang, "rep_cat_" + r.category))}</b> · <span class="mono">${esc(when(r.created_at))}</span> · <a href="#${esc(r.id)}" class="mono">${esc(r.id)}</a><br><span class="hint">${esc(firstLine(r.description))}</span></span></label>`).join("")}</fieldset>` : "";
  const btn = (action, label, { danger = false } = {}) => `<button class="pill ${danger ? "danger" : "ghost"}" type="submit" id="act-${action}" formaction="${esc(P(v, `/admin/target/${kind}/${id}/${action}`))}">${esc(label)}</button>`;
  const actForm = `<form class="form act" method="post" action="${esc(P(v, `/admin/target/${kind}/${id}/dismiss`))}">${csrfField(s)}${basis}<label class="check"><input type="checkbox" name="own_initiative" value="yes"> ${esc(t(v.lang, "adm_own"))}</label><p class="hint">${esc(t(v.lang, "adm_basis_hint"))}</p><input name="reason" required maxlength="500" placeholder="${esc(t(v.lang, "adm_reason"))}" aria-label="${esc(t(v.lang, "adm_reason"))}"><div class="btnrow">${actions.map(([a, label, o]) => btn(a, label, o)).join("")}</div></form>`;
  const body = `<p class="crumb"><a href="${esc(P(v, "/admin/reports"))}">${esc(t(v.lang, "adm_title"))}</a></p><h1 class="title">${esc(name || id)}</h1>${userBar(v.lang, s)}
${sec(t(v.lang, "c_details"), kv(info))}
${sec(t(v.lang, "adm_reports"), reports.length ? reports.map((r) => `<div class="report ${r.state}" id="${esc(r.id)}"><p><span class="badge">${esc(r.kind === "appeal" ? t(v.lang, "adm_appeal") : t(v.lang, "rep_cat_" + r.category))}</span> <span class="mono">${esc(when(r.created_at))}</span> <span class="mono">${esc(r.id)}</span> ${r.state === "open" ? "" : `<span class="badge">${esc(t(v.lang, "adm_closed"))}</span>`}${r.ticket ? ` <span class="mono">#${esc(r.ticket)}</span>` : ""}</p><p class="pre">${esc(r.description)}</p>${r.contact_email ? `<p class="mono">${esc(r.contact_email)}</p>` : ""}${r.context ? `<p class="mono hint">${esc(r.context)}</p>` : ""}${publishForm(v, s, kind, id, r)}</div>`).join("") : "-")}
${sec(t(v.lang, "adm_actions"), actForm)}
${sec(t(v.lang, "c_history"), audit.length ? `<div class="scroll"><table class="tbl stack" id="target-history"><tbody>${audit.map((r) => `<tr><td class="mono">${esc(when(r.at))}</td><td>${esc(t(v.lang, "act_" + r.action))}</td><td>${esc(reasonText(v.lang, r.reason))}</td><td data-label="${esc(t(v.lang, "adm_by"))}">${esc(actorText(v.lang, s, r))}</td></tr>`).join("")}</tbody></table></div>` : "-")}`;
  return page(v, name || id, body);
}

// "Publish report" for a closed report: upheld ones directly, dismissed ones
// only with an explicit choice. The text is prefilled redacted and editable.
function publishForm(v, s, kind, id, r) {
  if (r.kind !== "report" || r.state !== "closed") return "";
  if (r.published) return `<p class="hint">${esc(t(v.lang, "adm_published"))}</p>`;
  const L = v.lang;
  const inner = `<form class="form pub" method="post" action="${esc(P(v, `/admin/target/${kind}/${id}/publish`))}">${csrfField(s)}<input type="hidden" name="report_id" value="${esc(r.id)}">
${r.no_publish ? `<p class="hint">${esc(t(L, "adm_pub_optout"))}</p>` : `<label class="field"><span class="lbl">${esc(t(L, "adm_pub_text"))}</span><textarea class="prose" name="text" rows="5" maxlength="4000">${esc(r.prefill)}</textarea></label>`}
${r.outcome === "upheld" ? "" : `<label class="check"><input type="checkbox" name="publish_dismissed" value="yes" required> ${esc(t(L, "adm_pub_dismissed"))}</label>`}
<div class="btnrow"><button class="pill ghost" type="submit" id="publish-${esc(r.id)}">${esc(t(L, "adm_publish"))}</button></div></form>`;
  return r.outcome === "upheld" ? inner : `<details class="pubd"><summary>${esc(t(L, "adm_publish_dismissed"))}</summary>${inner}</details>`;
}

// The operator console for anyone else: what it is and where the public
// documentation explains how reports are handled. No contact channel.
const POLICY_DOCS = { en: `${REPO}/blob/main/docs/policy.md#operator-console`, zh: `${REPO}/blob/main/docs/zh-CN/policy.md#运营后台` };
export function forbiddenPage(v, { s }) {
  return page(v, t(v.lang, "adm_title"), `<h1 class="title">${esc(t(v.lang, "adm_title"))}</h1>${s ? userBar(v.lang, s) : ""}<div class="alert" id="operators-only">${icon("alert")}<div><p>${esc(t(v.lang, "adm_forbidden"))}</p><p><a href="${esc(POLICY_DOCS[v.lang])}" id="operators-doc">${esc(t(v.lang, "adm_forbidden_doc"))}</a></p></div></div>
<div class="btnrow"><a class="pill ghost" href="${esc(P(v, "/console"))}">${esc(t(v.lang, "c_title"))}</a></div>`);
}

// A target the operator asked for that does not exist.
export function adminNotFound(v, { s }) {
  return page(v, t(v.lang, "adm_title"), `<p class="crumb"><a href="${esc(P(v, "/admin/reports"))}">${esc(t(v.lang, "adm_title"))}</a></p><h1 class="title">${esc(t(v.lang, "adm_title"))}</h1>${userBar(v.lang, s)}<div class="alert" id="target-missing">${icon("alert")}<div><p>${esc(t(v.lang, "adm_notfound"))}</p></div></div>${lookupForm(v)}`);
}

// An application that does not exist or is not this person's.
export function appNotFoundPage(v, { s }) {
  return page(v, t(v.lang, "c_notfound_title"), `<p class="crumb"><a href="${esc(P(v, "/console"))}">${esc(t(v.lang, "c_title"))}</a></p><h1 class="title">${esc(t(v.lang, "c_notfound_title"))}</h1>${userBar(v.lang, s)}<div class="alert" id="app-missing">${icon("alert")}<div><p>${esc(t(v.lang, "c_notfound_lead"))}</p></div></div>
<div class="btnrow"><a class="pill" href="${esc(P(v, "/console"))}">${esc(t(v.lang, "c_my_apps"))}</a><form method="post" action="${esc(P(v, "/console/logout"))}">${csrfField(s)}<input type="hidden" name="then" value="login"><button class="pill ghost" type="submit" id="switch-account">${esc(t(v.lang, "c_switch_account"))}</button></form></div>`);
}

// An owner-only action by a co-owner.
export function ownerOnlyPage(v, { s, clientId }) {
  return page(v, t(v.lang, "c_title"), `<h1 class="title">${esc(t(v.lang, "c_title"))}</h1>${userBar(v.lang, s)}<div class="alert" id="owner-only">${icon("alert")}<div><p>${esc(t(v.lang, "c_owner_only"))}</p></div></div>
<div class="btnrow"><a class="pill" href="${esc(P(v, `/console/app/${clientId}`))}">${esc(t(v.lang, "c_back_app"))}</a></div>`);
}

// A form post without a valid session token (expired, or not from this site).
export function expiredPage(v, { back = "/console" } = {}) {
  return page(v, t(v.lang, "c_expired_title"), `<h1 class="title">${esc(t(v.lang, "c_expired_title"))}</h1><div class="alert" id="form-expired">${icon("alert")}<div><p>${esc(t(v.lang, "c_expired_lead"))}</p></div></div>
<div class="btnrow"><a class="pill" href="${esc(P(v, back))}" id="expired-back">${esc(t(v.lang, "c_go_back"))}</a></div>`);
}
