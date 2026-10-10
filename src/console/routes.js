// Routes of the console, the public application list, the report form and
// the operator queue.

import { json, html, redirect, now, readForm, CSP } from "../lib/http.js";
import { randomToken, sha256b64url, sha256hex, safeEqual } from "../lib/b64.js";
import { allow } from "../lib/ratelimit.js";
import { clientIp, notifyOperator, humanCheck } from "../platform/index.js";
import { getRegistry, resetMemo } from "../registry/store.js";
import { validateClient } from "../registry/validate.js";
import { appEntry, loadApp } from "../apps/store.js";
import { reviewEntry, checkAppDomain, settleStatus } from "../apps/review.js";
import { LIMITS } from "../apps/checks.js";
import { recordDecision, redactReportText } from "../apps/transparency.js";
import { pickLang, pickTheme, t, localName, localPath } from "../ui/i18n.js";
import { norm, idpHost } from "../ui/list.js";
import { newNonce } from "../lib/http.js";
import { loginStart, loginCallback, getSession, logoutSession, readPost, isOperator, verifiedEmail } from "./session.js";
import * as V from "./views.js";

// path: this page's URL in its language (the router strips /zh/ and passes the language).
const view = (request, extra = {}) => { const u = new URL(request.url); const lang = pickLang(request); return { lang, theme: pickTheme(request), nonce: newNonce(), path: localPath(lang, u.pathname) + u.search, ...extra }; };
// A redirect to a console or operator page in the language of `v`.
const back = (v, path, msg) => redirect(`${localPath(v.lang, path)}${msg ? `?msg=${msg}` : ""}`, { status: 303 });
// A form post without a valid session token: the page the form was on, to submit again.
const formPage = (p) => p.replace(/^(\/console\/app\/[a-z0-9-]+)\/[a-z/]+$/, "$1").replace(/^(\/admin\/target\/(?:app|idp)\/[a-z0-9-]+)\/[a-z_]+$/, "$1").replace(/^\/console\/logout$/, "/console");
const badRequest = (request, v) => html(V.expiredPage(v, { back: formPage(new URL(request.url).pathname) }), { status: 400 });

// actor: a console session ({ sub, email }) or a fixed name ("system", "github").
async function audit(env, actor, kind, id, action, reason = null, reportId = null) {
  const sub = typeof actor === "string" ? actor : actor.sub, email = typeof actor === "string" ? null : actor.email || null;
  await env.DB.prepare("INSERT INTO audit (at, actor, actor_email, target_kind, target_id, action, reason, report_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(now(), sub, email, kind, id, action, reason, reportId).run();
}

// The session's identity provider by name, for the user bar.
function withIdpName(s, reg, lang) {
  if (!s) return s;
  const i = reg.idps.get(s.idp);
  return { ...s, idp_name: i ? localName(i, lang) : s.idp };
}

// ---- form <-> entry -------------------------------------------------------------

const SECRET_METHODS = new Set(["client_secret_basic", "client_secret_post"]);

function readAppForm(f) {
  const lines = (k) => String(f.get(k) || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const str = (k, max = 500) => String(f.get(k) || "").trim().slice(0, max);
  const method = ["client_secret_basic", "client_secret_post", "private_key_jwt", "none"].includes(f.get("auth_method")) ? f.get("auth_method") : "client_secret_basic";
  return {
    name_en: str("name_en", 80), name_zh: str("name_zh", 80), domain: str("domain", 253).toLowerCase().replace(/\.$/, ""), homepage: str("homepage", 300),
    protocol: f.get("protocol") === "saml2" ? "saml2" : "oidc", redirect_uris: lines("redirect_uris"), post_logout_redirect_uris: lines("post_logout_redirect_uris"),
    auth_method: method, jwks_uri: str("jwks_uri", 300), id_token_alg: str("id_token_signed_response_alg", 20) || "RS256", subject_type: f.get("subject_type") === "pairwise" ? "pairwise" : "public",
    idp_mode: ["only", "except"].includes(f.get("idp_mode")) ? f.get("idp_mode") : "all", idp_ids: [...new Set(f.getAll("idp_ids").map(String))].slice(0, 200), entity_id: str("entity_id", 300), acs_urls: lines("acs_urls"), idp_initiated: f.get("idp_initiated") === "yes", sign_cert: str("sign_cert", 8000),
  };
}

function formFromRow(row) {
  const e = appEntry(row);
  return { name_en: e.name.en, name_zh: e.name.zh || "", domain: e.domain, homepage: e.homepage, protocol: e.protocol, redirect_uris: e.redirect_uris || [], post_logout_redirect_uris: e.post_logout_redirect_uris || [],
    auth_method: e.token_endpoint_auth_method, jwks_uri: e.jwks_uri || "", id_token_alg: e.id_token_signed_response_alg || "RS256", subject_type: e.subject_type || "public",
    idp_mode: e.allowed_idps ? "only" : e.excluded_idps ? "except" : "all", idp_ids: e.allowed_idps || e.excluded_idps || [], entity_id: e.entity_id || "", idp_initiated: e.idp_initiated === true, acs_urls: e.acs_urls || [], sign_cert: e.sign_cert || "" };
}

// The registry-shaped entry (for the shared rules) and the stored config.
function toEntry(clientId, v) {
  const config = { subject_type: v.subject_type };
  // "except" with nothing ticked is the same as "all".
  if (v.idp_mode === "only" && v.idp_ids.length) config.allowed_idps = v.idp_ids;
  else if (v.idp_mode === "except" && v.idp_ids.length) config.excluded_idps = v.idp_ids;
  if (v.protocol === "saml2") {
    config.entity_id = v.entity_id; config.acs_urls = v.acs_urls; if (v.idp_initiated) config.idp_initiated = true;
    if (v.sign_cert) config.sign_cert = v.sign_cert;
  } else {
    config.redirect_uris = v.redirect_uris; config.token_endpoint_auth_method = v.auth_method;
    config.id_token_signed_response_alg = v.id_token_alg;
    if (v.post_logout_redirect_uris.length) config.post_logout_redirect_uris = v.post_logout_redirect_uris;
    if (v.auth_method === "private_key_jwt") config.jwks_uri = v.jwks_uri;
  }
  const entry = {
    client_id: clientId, protocol: v.protocol, name: { en: v.name_en, ...(v.name_zh ? { zh: v.name_zh } : {}) }, homepage: v.homepage, domain: v.domain,
    contact: { github: "roamid-console", email: "console@fadianro.am" }, status: "active", ...config,
    ...(SECRET_METHODS.has(config.token_endpoint_auth_method) ? { client_secret_sha256: "0".repeat(64) } : {}),
  };
  return { entry, config };
}

async function reviewForm(env, reg, clientId, v, { creator, editing } = {}) {
  const { entry, config } = toEntry(clientId, v);
  const errors = validateClient(entry).map((m) => ({ code: "schema", field: m.split(":")[0], message: m }));
  if (v.idp_mode === "only" && !v.idp_ids.length) errors.push({ code: "idps_pick", field: "allowed_idps", message: "choose at least one identity provider" });
  if (v.idp_mode !== "all") for (const a of v.idp_ids) if (!reg.idps.has(a)) errors.push({ code: "schema", field: v.idp_mode === "only" ? "allowed_idps" : "excluded_idps", message: `unknown identity provider ${a}` });
  if (v.idp_mode === "except" && v.idp_ids.length && ![...reg.idps.values()].some((i) => i.status === "active" && !v.idp_ids.includes(i.id))) errors.push({ code: "idps_none", field: "excluded_idps", message: "this would leave no identity provider to offer" });
  if (!errors.length) errors.push(...(await reviewEntry(env, reg, entry)).errors);
  if (v.protocol === "saml2" && v.entity_id && !errors.length) {
    const dupReg = [...reg.clients.values()].some((c) => c.protocol === "saml2" && c.entity_id === v.entity_id);
    const dupApp = await env.DB.prepare("SELECT client_id FROM apps WHERE protocol = 'saml2' AND json_extract(config, '$.entity_id') = ? AND client_id != ?").bind(v.entity_id, clientId).first();
    if (dupReg || dupApp) errors.push({ code: "entity_taken", field: "entity_id", message: "this entity ID is already registered" });
  }
  if (!editing && creator) {
    const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM apps WHERE created_by = ?").bind(creator).first();
    if (mine.n >= LIMITS.perCreator) errors.push({ code: "cap_creator", field: "-", message: `at most ${LIMITS.perCreator} applications per person` });
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM apps WHERE created_at >= ?").bind(now() - 86400).first();
    if (today.n >= LIMITS.globalPerDay) errors.push({ code: "cap_global", field: "-", message: "the daily limit for new applications is reached; try again tomorrow" });
  }
  if (!errors.length && (await env.DB.prepare("SELECT 1 FROM banned_domains WHERE domain = ?").bind(v.domain).first())) errors.push({ code: "domain_banned", field: "domain", message: "banned" });
  return { errors, entry, config };
}

// ---- console ------------------------------------------------------------------------

async function myRole(env, clientId, sub) {
  const r = await env.DB.prepare("SELECT role FROM app_owners WHERE client_id = ? AND sub = ?").bind(clientId, sub).first();
  return r ? r.role : null;
}

async function appPageData(env, request, s, clientId, extra = {}) {
  const row = await loadApp(env, clientId);
  if (!row) return null;
  const role = await myRole(env, clientId, s.sub);
  if (!role) return null;
  const { results: owners } = await env.DB.prepare("SELECT * FROM app_owners WHERE client_id = ? ORDER BY role DESC, added_at").bind(clientId).all();
  const { results: auditRows } = await env.DB.prepare("SELECT at, action, reason FROM audit WHERE target_kind = 'app' AND target_id = ? ORDER BY at DESC, id DESC LIMIT 50").bind(clientId).all();
  const since = new Date(Date.now() - 13 * 86400e3).toISOString().slice(0, 10);
  const { results: ev } = await env.DB.prepare("SELECT day, kind, code, SUM(n) AS n FROM events WHERE client_id = ? AND day >= ? GROUP BY day, kind, code ORDER BY day DESC").bind(clientId, since).all();
  const byDay = new Map();
  for (const e of ev || []) {
    const d = byDay.get(e.day) || { day: e.day, started: 0, completed: 0, failed: 0, codes: [] };
    if (e.kind === "failed") { d.failed += e.n; d.codes.push({ code: e.code || null, n: e.n }); } else if (e.kind in d) d[e.kind] += e.n;
    byDay.set(e.day, d);
  }
  const stats = [...byDay.values()];
  const openAppeal = await env.DB.prepare("SELECT 1 FROM reports WHERE kind = 'appeal' AND target_id = ? AND state = 'open'").bind(clientId).first();
  const msg = new URL(request.url).searchParams.get("msg");
  return { s, app: appEntry(row), row, owners: owners || [], audit: auditRows || [], stats, role, openAppeal: !!openAppeal, base: env.BASE_URL, msg: /^[a-z_]{1,30}$/.test(msg || "") ? msg : null, ...extra };
}

export async function handleConsole(request, env, p) {
  const m = request.method;
  if (p === "/console/login") return loginStart(request, env);
  if (p === "/console/callback") return loginCallback(request, env);
  const reg = await getRegistry(env);
  const v0 = view(request);
  const s = withIdpName(await getSession(request, env), reg, v0.lang);
  const v = { ...v0, operator: isOperator(env, s) };
  if (p === "/console/logout") { const lf = m === "POST" ? await readPost(request, env, s) : null; if (lf) return logoutSession(request, env, { lang: v.lang, then: lf.get("then") }); return redirect(localPath(v.lang, "/console")); }
  if (!s) {
    if (p === "/console") return html(V.consoleLanding(v, { msg: ["expired", "failed"].includes(new URL(request.url).searchParams.get("signin")) ? new URL(request.url).searchParams.get("signin") : null }));
    return redirect(`/console/login?next=${encodeURIComponent(localPath(v.lang, p))}`, { status: 303 });
  }
  const activeIdps = [...reg.idps.values()].filter((i) => i.status === "active");

  if (p === "/console" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT a.*, o.role FROM apps a JOIN app_owners o ON o.client_id = a.client_id WHERE o.sub = ? ORDER BY a.created_at DESC").bind(s.sub).all();
    const apps = (results || []).map((r) => ({ ...appEntry(r), role: r.role }));
    const invites = [];
    if (verifiedEmail(s)) {
      const { results: inv } = await env.DB.prepare("SELECT i.*, a.name_en, a.name_zh FROM app_invites i JOIN apps a ON a.client_id = i.client_id WHERE i.email = ? AND i.expires > ?").bind(verifiedEmail(s), now()).all();
      for (const i of inv || []) invites.push({ name: v.lang === "zh" && i.name_zh ? i.name_zh : i.name_en });
    }
    return html(V.consoleHome(v, { s, apps, invites }));
  }

  if (p === "/console/new") {
    const title = t(v.lang, "c_new");
    if (m === "GET") return html(V.appForm(v, { s, idps: activeIdps, action: "/console/new", title, submit: t(v.lang, "c_create"), f: { protocol: "oidc", subject_type: "public" } }));
    const f = await readPost(request, env, s);
    if (!f) return badRequest(request, v);
    if (!(await allow(env, "console", s.sub))) return html(V.appForm(v, { s, idps: activeIdps, action: "/console/new", title, submit: t(v.lang, "c_create"), f: readAppForm(f), errors: [{ code: "rate", field: "-", message: "too many requests; wait a minute" }] }), { status: 429 });
    const vals = readAppForm(f);
    const clientId = `app-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10).padEnd(10, "0")}`;
    const { errors, config } = await reviewForm(env, reg, clientId, vals, { creator: s.sub });
    if (errors.length) return html(V.appForm(v, { s, idps: activeIdps, action: "/console/new", title, submit: t(v.lang, "c_create"), f: vals, errors }), { status: 422 });
    const t0 = now();
    let secret = null;
    if (SECRET_METHODS.has(config.token_endpoint_auth_method)) secret = randomToken(32);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO apps (client_id, protocol, name_en, name_zh, domain, homepage, config, secret_sha256, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'development', ?, ?, ?)`)
        .bind(clientId, vals.protocol, vals.name_en, vals.name_zh || null, vals.domain, vals.homepage, JSON.stringify(config), secret ? await sha256hex(secret) : null, s.sub, t0, t0),
      env.DB.prepare("INSERT INTO app_owners (client_id, sub, role, email, added_at) VALUES (?, ?, 'owner', ?, ?)").bind(clientId, s.sub, s.email, t0),
      env.DB.prepare("INSERT INTO audit (at, actor, actor_email, target_kind, target_id, action, reason) VALUES (?, ?, ?, 'app', ?, 'created', NULL)").bind(t0, s.sub, s.email || null, clientId),
    ]);
    await checkAppDomain(env, await loadApp(env, clientId));
    return html(V.appPage(v, await appPageData(env, request, s, clientId, { secret, msg: "created" })));
  }

  let mm;
  if ((mm = /^\/console\/invite\/([A-Za-z0-9_-]{20,80})$/.exec(p))) {
    const hash = await sha256b64url(mm[1]);
    const inv = await env.DB.prepare("SELECT * FROM app_invites WHERE token_hash = ?").bind(hash).first();
    const app = inv && (await loadApp(env, inv.client_id));
    if (!inv || inv.expires <= now() || !app) return html(V.invitePage(v, { s, error: "expired" }), { status: 404 });
    // An invitation for another address reads as not valid (it does not
    // reveal that one exists). For the right address, the identity provider
    // must be authoritative for its domain and the address verified.
    if (!s.email || s.email.toLowerCase() !== inv.email) return html(V.invitePage(v, { s, error: "expired" }), { status: 404 });
    if (verifiedEmail(s) !== inv.email) return html(V.invitePage(v, { s, error: "authority", domain: inv.email.split("@")[1] }), { status: 403 });
    if (m === "GET") return html(V.invitePage(v, { s, invite: inv, app: appEntry(app), ok: mm[1] }));
    if (!(await readPost(request, env, s))) return badRequest(request, v);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_owners WHERE client_id = ?").bind(inv.client_id).first();
    if (n.n >= 10) return html(V.invitePage(v, { s, error: "full" }), { status: 409 });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO app_owners (client_id, sub, role, email, added_at) VALUES (?, ?, 'co-owner', ?, ?) ON CONFLICT DO NOTHING").bind(inv.client_id, s.sub, s.email, now()),
      env.DB.prepare("DELETE FROM app_invites WHERE token_hash = ?").bind(hash),
    ]);
    await audit(env, s, "app", inv.client_id, "owner_added", s.email);
    return back(v, `/console/app/${inv.client_id}`, "joined");
  }

  if (!(mm = /^\/console\/app\/(app-[a-z0-9]{6,40})(\/[a-z/]+)?$/.exec(p))) return null;
  const clientId = mm[1], sub = mm[2] || "";
  const data = await appPageData(env, request, s, clientId);
  if (!data) return html(V.appNotFoundPage(v, { s }), { status: 404 });
  const row = data.row, role = data.role;
  const appHref = `/console/app/${clientId}`;
  const editForm = (o) => V.appForm(v, { s, idps: activeIdps, action: `${appHref}/edit`, title: `${t(v.lang, "c_edit")}: ${localName(data.app, v.lang)}`, submit: t(v.lang, "c_save"), appHref, ...o });
  if (sub === "" && m === "GET") return html(V.appPage(v, data));
  if (sub === "/edit" && m === "GET") return html(editForm({ f: formFromRow(row) }));
  if (m !== "POST") return null;
  const f = await readPost(request, env, s);
  if (!f) return badRequest(request, v);
  if (!(await allow(env, "console", s.sub))) {
    // The form again (with what was typed), or the application page, saying how long to wait.
    if (sub === "/edit") return html(editForm({ f: readAppForm(f), errors: [{ code: "rate", field: "-", message: "" }] }), { status: 429 });
    return html(V.appPage(v, { ...data, msg: "rate" }), { status: 429 });
  }
  const frozen = row.status === "suspended" || row.status === "banned";

  if (sub === "/edit") {
    const vals = readAppForm(f);
    if (frozen) return html(editForm({ f: vals, errors: [{ code: "frozen", field: "-", message: "" }] }), { status: 409 });
    const { errors, config } = await reviewForm(env, reg, clientId, vals, { editing: true });
    if (errors.length) return html(editForm({ f: vals, errors }), { status: 422 });
    let secret = null, secretHash = row.secret_sha256, old = row.secret_sha256_old;
    if (SECRET_METHODS.has(config.token_endpoint_auth_method) && !row.secret_sha256) { secret = randomToken(32); secretHash = await sha256hex(secret); }
    if (!SECRET_METHODS.has(config.token_endpoint_auth_method)) { secretHash = null; old = null; }
    const domainChanged = vals.domain !== row.domain;
    await env.DB.prepare(`UPDATE apps SET protocol = ?, name_en = ?, name_zh = ?, domain = ?, homepage = ?, config = ?, secret_sha256 = ?, secret_sha256_old = ?, updated_at = ?${domainChanged ? ", domain_verified_at = NULL, domain_failing_since = NULL, domain_checked_at = NULL" : ""} WHERE client_id = ?`)
      .bind(vals.protocol, vals.name_en, vals.name_zh || null, vals.domain, vals.homepage, JSON.stringify(config), secretHash, old, now(), clientId).run();
    await audit(env, s, "app", clientId, "edited", domainChanged ? `domain ${vals.domain}` : null);
    const fresh = await loadApp(env, clientId);
    if (domainChanged) await checkAppDomain(env, fresh); else await settleStatus(env, fresh);
    return html(V.appPage(v, await appPageData(env, request, s, clientId, { secret, msg: "saved" })));
  }
  if (sub === "/check") { const r = await checkAppDomain(env, row); return back(v, appHref, r.ok ? "checked_ok" : "checked_fail"); }
  if (sub === "/secret") {
    if (frozen || !SECRET_METHODS.has(data.app.token_endpoint_auth_method)) return badRequest(request, v);
    const secret = randomToken(32);
    await env.DB.prepare("UPDATE apps SET secret_sha256_old = secret_sha256, secret_sha256 = ?, updated_at = ? WHERE client_id = ?").bind(await sha256hex(secret), now(), clientId).run();
    await audit(env, s, "app", clientId, "secret_rotated");
    return html(V.appPage(v, await appPageData(env, request, s, clientId, { secret, msg: "rotated" })));
  }
  if (sub === "/secret/revoke") {
    await env.DB.prepare("UPDATE apps SET secret_sha256_old = NULL, updated_at = ? WHERE client_id = ?").bind(now(), clientId).run();
    await audit(env, s, "app", clientId, "secret_revoked");
    return back(v, appHref, "revoked");
  }
  if (sub === "/owners/invite") {
    const email = String(f.get("email") || "").trim().toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,253}$/.test(email)) return back(v, appHref, "bad_email");
    const tok = randomToken(24);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM app_invites WHERE client_id = ? AND email = ?").bind(clientId, email),
      env.DB.prepare("INSERT INTO app_invites (token_hash, client_id, email, invited_by, expires) VALUES (?, ?, ?, ?, ?)").bind(await sha256b64url(tok), clientId, email, s.sub, now() + 7 * 86400),
    ]);
    await audit(env, s, "app", clientId, "owner_invited", email);
    return html(V.appPage(v, await appPageData(env, request, s, clientId, { invite: `${env.BASE_URL}/console/invite/${tok}`, msg: "invited" })));
  }
  if (sub === "/owners/remove" || sub === "/owners/transfer") {
    if (role !== "owner") return html(V.ownerOnlyPage(v, { s, clientId }), { status: 403 });
    const target = String(f.get("sub") || "");
    const tr = await env.DB.prepare("SELECT * FROM app_owners WHERE client_id = ? AND sub = ? AND role = 'co-owner'").bind(clientId, target).first();
    if (!tr) return badRequest(request, v);
    if (sub === "/owners/remove") {
      await env.DB.prepare("DELETE FROM app_owners WHERE client_id = ? AND sub = ?").bind(clientId, target).run();
      await audit(env, s, "app", clientId, "owner_removed", tr.email);
      return back(v, appHref, "removed");
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE app_owners SET role = 'owner' WHERE client_id = ? AND sub = ?").bind(clientId, target),
      env.DB.prepare("UPDATE app_owners SET role = 'co-owner' WHERE client_id = ? AND sub = ?").bind(clientId, s.sub),
    ]);
    await audit(env, s, "app", clientId, "transferred", tr.email);
    return back(v, appHref, "transferred");
  }
  if (sub === "/appeal") {
    if (!frozen) return badRequest(request, v);
    const text = String(f.get("text") || "").trim().slice(0, 4000);
    if (text.length < 5) return back(v, appHref, "appeal_short");
    const id = await createReport(env, { kind: "appeal", target_kind: "app", target_id: clientId, category: "appeal", description: text, contact_email: s.email, context: null, reporter_hash: await sha256b64url(`appeal|${s.sub}`) });
    await audit(env, s, "app", clientId, "appeal", null, id);
    return back(v, appHref, "appealed");
  }
  if (sub === "/delete") {
    if (role !== "owner") return html(V.ownerOnlyPage(v, { s, clientId }), { status: 403 });
    if (frozen || f.get("confirm") !== "yes") return badRequest(request, v);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM apps WHERE client_id = ?").bind(clientId),
      env.DB.prepare("DELETE FROM app_owners WHERE client_id = ?").bind(clientId),
      env.DB.prepare("DELETE FROM app_invites WHERE client_id = ?").bind(clientId),
      env.DB.prepare("INSERT INTO audit (at, actor, actor_email, target_kind, target_id, action) VALUES (?, ?, ?, 'app', ?, 'deleted')").bind(now(), s.sub, s.email || null, clientId),
    ]);
    return back(v, "/console", null);
  }
  return null;
}

// ---- public list -----------------------------------------------------------------------

// Every application that can be signed in to now: registry entries and active console apps.
export async function publicApps(env) {
  const reg = await getRegistry(env);
  const out = [];
  for (const c of reg.clients.values()) {
    if (c.status !== "active") continue;
    out.push({ client_id: c.client_id, name: c.name, domain: c.domain || (() => { try { return new URL(c.homepage).host; } catch { return null; } })(), domain_verified: !!c.domain, homepage: c.homepage, protocol: c.protocol, created: null, status: "active", source: "registry", ...(c.note ? { note: c.note } : {}) });
  }
  const { results } = await env.DB.prepare("SELECT * FROM apps WHERE status = 'active' ORDER BY created_at").all();
  for (const r of results || []) {
    const e = appEntry(r);
    if (!e.app.domain_verified) continue;
    out.push({ client_id: e.client_id, name: e.name, domain: e.domain, domain_verified: true, homepage: e.homepage, protocol: e.protocol, created: new Date(r.created_at * 1000).toISOString().slice(0, 10), status: "active", source: "console" });
  }
  return out;
}

export async function handleApps(request, env, p) {
  const v = view(request);
  if (p === "/apps.json") {
    const { results: banned } = await env.DB.prepare("SELECT domain FROM banned_domains ORDER BY domain").all();
    // Entity IDs held by console SAML applications in any state: a registry pull request may not reuse one.
    const { results: ents } = await env.DB.prepare("SELECT client_id, json_extract(config, '$.entity_id') AS entity_id FROM apps WHERE protocol = 'saml2'").all();
    return json({ apps: (await publicApps(env)).map(({ client_id, name, domain, protocol, created, status, source }) => ({ client_id, name, domain, protocol, created, status, source })), banned_domains: (banned || []).map((r) => r.domain), saml_entities: (ents || []).filter((r) => r.entity_id).map((r) => ({ client_id: r.client_id, entity_id: r.entity_id })) }, { cache: "public, max-age=60", cors: true });
  }
  if (p === "/apps") return html(V.appsList(v, { apps: await publicApps(env) }));
  const mm = /^\/apps\/([a-z0-9-]{2,64})$/.exec(p);
  if (!mm) return null;
  const a = (await publicApps(env)).find((x) => x.client_id === mm[1]);
  if (!a) {
    // Suspended and banned console apps keep a public page with their state.
    const row = await loadApp(env, mm[1]);
    if (!row || row.status === "development") return null;
    const e = appEntry(row);
    return html(V.appPublic(v, { a: { client_id: e.client_id, name: e.name, domain: e.domain, homepage: e.homepage, protocol: e.protocol, created: new Date(row.created_at * 1000).toISOString().slice(0, 10), status: V.appStatus(e.app), source: "console" } }));
  }
  return html(V.appPublic(v, { a }));
}

// ---- reports ------------------------------------------------------------------------------

export async function createReport(env, r) {
  const id = `r-${randomToken(9).replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}`;
  await env.DB.prepare(`INSERT INTO reports (id, kind, target_kind, target_id, category, description, contact_email, context, reporter_hash, created_at, no_publish) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, r.kind, r.target_kind, r.target_id, r.category, r.description, r.contact_email || null, r.context, r.reporter_hash, now(), r.no_publish ? 1 : 0).run();
  const ticket = await notifyOperator(env, {
    subject: `RoamID ${r.kind === "appeal" ? "appeal" : "report"}: ${r.target_kind} ${r.target_id} (${r.category})`,
    body: `${r.kind === "appeal" ? "Appeal" : "Report"} ${id}\nTarget: ${r.target_kind} ${r.target_id}\nCategory: ${r.category}\nContact: ${r.contact_email || "-"}\nContext: ${r.context || "-"}\n\n${r.description}\n\nReports: ${env.BASE_URL}/admin/reports#${id}\nTarget: ${env.BASE_URL}/admin/target/${r.target_kind}/${r.target_id}`,
    link: `${env.BASE_URL}/admin/reports#${id}`,
  });
  if (ticket) await env.DB.prepare("UPDATE reports SET ticket = ? WHERE id = ?").bind(ticket, id).run();
  return id;
}

// The report page's CSP: the base policy plus what the platform's human check needs.
const addSrc = (csp, dir, hosts) => (hosts && hosts.length ? csp.replace(new RegExp(`${dir} ([^;]*)`), (m, v) => `${dir} ${v} ${hosts.join(" ")}`) : csp);
const hc = humanCheck.csp || {};
export const REPORT_CSP = ["script-src", "connect-src", "frame-src", "style-src", "img-src"].reduce((c, d) => addSrc(c, d, hc[d.split("-")[0]]), CSP);

async function targetOf(env, kind, id) {
  const reg = await getRegistry(env);
  if (kind === "idp") { const i = reg.idps.get(id); return i ? { kind, id, name: i.name } : null; }
  if (kind === "app") {
    const c = reg.clients.get(id);
    if (c) return { kind, id, name: c.name };
    const row = await loadApp(env, id);
    return row ? { kind, id, name: appEntry(row).name } : null;
  }
  return null;
}

// Applications, identity providers and console applications whose name,
// domain or identifier matches `q` (normalized): exact matches first.
// { kind, id, name, domain, exact }.
async function findTargets(env, q, lang, { limit = 50 } = {}) {
  const n = norm(q);
  if (!n) return [];
  const reg = await getRegistry(env);
  const out = [];
  const add = (kind, id, names, domains) => {
    const keys = [names && names.en, names && names.zh, id, ...domains].filter(Boolean).map(norm);
    const exact = keys.includes(n);
    if (exact || keys.some((k) => k.includes(n))) out.push({ kind, id, name: localName({ name: names }, lang) || id, domain: domains[0] || null, exact });
  };
  const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };
  for (const i of reg.idps.values()) add("idp", i.id, i.name, [idpHost(i), ...(i.email_domains || [])].filter(Boolean));
  for (const c of reg.clients.values()) add("app", c.client_id, c.name, [c.domain || hostOf(c.homepage)].filter(Boolean));
  const { results } = await env.DB.prepare("SELECT client_id, name_en, name_zh, domain FROM apps").all();
  for (const r of results || []) if (!reg.clients.has(r.client_id)) add("app", r.client_id, { en: r.name_en, ...(r.name_zh ? { zh: r.name_zh } : {}) }, [r.domain]);
  out.sort((a, b) => (b.exact - a.exact) || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

// What the report form offers: the applications people can sign in to and
// the identity providers that are not disabled, by name.
async function reportOptions(env, lang) {
  const reg = await getRegistry(env);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const apps = (await publicApps(env)).map((a) => ({ id: a.client_id, names: a.name, name: localName(a, lang), domain: a.domain })).sort(byName);
  const idps = [...reg.idps.values()].filter((i) => i.status !== "disabled").map((i) => ({ id: i.id, names: i.name, name: localName(i, lang), domain: idpHost(i) })).sort(byName);
  return { apps, idps };
}

export async function handleReport(request, env) {
  const v = view(request);
  const headers = { "Content-Security-Policy": REPORT_CSP };
  const check = humanCheck.field ? humanCheck.widget({ env, lang: v.lang, action: "report" }) || "" : "";
  if (request.method === "GET") {
    const q = new URL(request.url).searchParams;
    const target = q.get("app") ? await targetOf(env, "app", q.get("app")) : q.get("idp") ? await targetOf(env, "idp", q.get("idp")) : null;
    const tx = /^[A-Za-z0-9_-]{10,64}$/.test(q.get("tx") || "") ? q.get("tx") : "";
    return html(V.reportPage(v, { target, targetName: target && localName(target, v.lang), tx, check, options: target ? undefined : await reportOptions(env, v.lang) }), { headers });
  }
  if (request.method !== "POST") return null;
  const f = await readForm(request);
  if (!f) return html(V.reportPage(v, { check, errors: ["form"], options: await reportOptions(env, v.lang) }), { status: 400, headers });
  const ip = await clientIp(request, env);
  const tv = String(f.get("target") || "");
  const fv = { target: tv, target_id: String(f.get("target_id") || "").slice(0, 120), target_kind: f.get("target_kind") === "idp" ? "idp" : "app", category: String(f.get("category") || ""), description: String(f.get("description") || "").trim().slice(0, 4000), contact_email: String(f.get("contact_email") || "").trim().slice(0, 254), no_publish: f.get("no_publish") === "yes" };
  let target = null;
  // The chosen entry; else the identifier typed in (or an exact, unique name or domain).
  if (/^(app|idp):[a-z0-9-]{2,64}$/.test(tv)) target = await targetOf(env, tv.split(":")[0], tv.split(":")[1]);
  else if (fv.target_id.trim()) {
    const typed = fv.target_id.trim();
    target = /^[a-z0-9-]{2,64}$/.test(typed) ? await targetOf(env, fv.target_kind, typed) : null;
    if (!target) {
      const exact = (await findTargets(env, typed, v.lang)).filter((x) => x.exact);
      const sameKind = exact.filter((x) => x.kind === fv.target_kind);
      const pick = sameKind.length === 1 ? sameKind : exact;
      if (pick.length === 1) target = await targetOf(env, pick[0].kind, pick[0].id);
    }
  }
  const errors = [];
  if (!target) errors.push("target");
  if (!V.CATEGORIES.includes(fv.category)) errors.push("category");
  if (fv.description.length < 10) errors.push("description");
  if (fv.contact_email && !/^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(fv.contact_email)) errors.push("email");
  // A target fixed by the page the report came from (?app= / ?idp=) stays fixed; otherwise the list again.
  const fixed = f.get("fixed") === "1" && target;
  const render = async (errs, status) => html(V.reportPage(v, { target: fixed ? target : null, targetName: target && localName(target, v.lang), tx: f.get("tx") || "", check, errors: errs, f: { ...fv, target: target ? `${target.kind}:${target.id}` : tv }, options: fixed ? undefined : await reportOptions(env, v.lang) }), { status, headers });
  if (errors.length) return await render(errors, 400);
  if (!(await allow(env, "report", ip))) return await render(["rate"], 429);
  // The platform's human check, when it has one (off by default: the rate limits apply).
  if (humanCheck.field) {
    const ok = await humanCheck.verify(env, f.get(humanCheck.field), ip).catch(() => "verify_unavailable");
    if (ok !== true) { const code = ["verify_required", "verify_failed", "verify_unavailable"].includes(ok) ? ok : "verify_failed"; return await render([code], code === "verify_unavailable" ? 503 : 403); }
  }
  // Context: the sign-in in progress (which application, which provider), no personal data.
  let context = null;
  const txId = String(f.get("tx") || "");
  if (/^[A-Za-z0-9_-]{10,64}$/.test(txId)) {
    const tx = await env.DB.prepare("SELECT client_id, idp, proto FROM tx WHERE id = ?").bind(txId).first();
    if (tx) context = JSON.stringify({ sign_in: { client_id: tx.client_id, idp: tx.idp || null, protocol: tx.proto } });
  }
  const id = await createReport(env, { kind: "report", target_kind: target.kind, target_id: target.id, category: fv.category, description: fv.description, contact_email: fv.contact_email || null, context, reporter_hash: await sha256b64url(`report|${ip || "-"}`), no_publish: f.get("no_publish") === "yes" });
  return html(V.reportPage(v, { sent: id }), { headers });
}

// ---- operator ---------------------------------------------------------------------------------

const APP_ACTIONS = { dismiss: "dismiss", warn: "warn", suspend: "suspend", ban: "ban", restore: "restore", lift_limit: "lift_limit", publish: "publish" };
const UPHOLDING = new Set(["warn", "suspend", "ban", "idp_disable"]);
const IDP_ACTIONS = { dismiss: "dismiss", idp_disable: "idp_disable", idp_enable: "idp_enable", publish: "publish" };

export async function handleAdmin(request, env, p) {
  const v = view(request);
  const reg = await getRegistry(env);
  const s = withIdpName(await getSession(request, env), reg, v.lang);
  if (!s) return redirect(`/console/login?next=${encodeURIComponent(localPath(v.lang, p) + new URL(request.url).search)}`, { status: 303 });
  if (!isOperator(env, s)) return html(V.forbiddenPage(v, { s }), { status: 403 });
  const nameOf = async (kind, id) => { const tg = await targetOf(env, kind, id); return tg ? localName(tg, v.lang) : id; };

  if (p === "/admin/reports" && request.method === "GET") {
    const t0 = now();
    const { results } = await env.DB.prepare("SELECT * FROM reports WHERE state = 'open' ORDER BY created_at DESC LIMIT 500").all();
    const groups = new Map();
    for (const r of results || []) {
      const k = `${r.target_kind}:${r.target_id}`;
      const g = groups.get(k) || { target_kind: r.target_kind, target_id: r.target_id, open: 0, appeals: 0, reporters: new Set(), categories: new Set(), latest: 0, ids: [] };
      g.open++; g.ids.push(r.id); if (r.kind === "appeal") g.appeals++;
      if (r.kind === "report" && t0 - r.created_at < 86400) g.reporters.add(r.reporter_hash);
      if (r.kind === "report") g.categories.add(r.category);
      g.latest = Math.max(g.latest, r.created_at);
      groups.set(k, g);
    }
    const items = [];
    for (const g of groups.values()) items.push({ ...g, reporters24: g.reporters.size, categories: [...g.categories], name: await nameOf(g.target_kind, g.target_id) });
    // Priority: distinct reporters in 24 hours, then appeals, then the newest.
    items.sort((a, b) => b.reporters24 - a.reporters24 || b.appeals - a.appeals || b.latest - a.latest);
    const { results: recent } = await env.DB.prepare("SELECT * FROM audit WHERE actor != 'system' ORDER BY at DESC, id DESC LIMIT 20").all();
    const names = new Map();
    for (const r of recent || []) { const k = `${r.target_kind}:${r.target_id}`; if (!names.has(k)) names.set(k, await nameOf(r.target_kind, r.target_id)); r.name = names.get(k); }
    return html(V.adminQueue({ ...v }, { s, items, recent: recent || [] }));
  }
  if (p === "/admin/target" && request.method === "GET") {
    // By identifier, name or domain: one exact match (or a single match) opens it, otherwise the list.
    const sp = new URL(request.url).searchParams;
    const q = String(sp.get("q") || sp.get("id") || "").trim().slice(0, 120);
    const results = await findTargets(env, q, v.lang);
    const exact = results.filter((r) => r.exact);
    const one = exact.length === 1 ? exact[0] : results.length === 1 ? results[0] : null;
    if (one) return back(v, `/admin/target/${one.kind}/${one.id}`, null);
    return html(V.adminSearch(v, { s, q, results }), { status: results.length ? 200 : 404 });
  }
  const mm = /^\/admin\/target\/(app|idp)\/([a-z0-9-]{2,64})(?:\/([a-z_]+))?$/.exec(p);
  if (!mm) return null;
  const [, kind, id, action] = mm;
  const target = await targetOf(env, kind, id);
  if (!target) return html(V.adminNotFound(v, { s }), { status: 404 });
  const row = kind === "app" ? await loadApp(env, id) : null;
  if (!action && request.method === "GET") {
    const { results: reports } = await env.DB.prepare("SELECT * FROM reports WHERE target_kind = ? AND target_id = ? ORDER BY state = 'open' DESC, created_at DESC LIMIT 200").bind(kind, id).all();
    const { results: au } = await env.DB.prepare("SELECT * FROM audit WHERE target_kind = ? AND target_id = ? ORDER BY at DESC, id DESC LIMIT 100").bind(kind, id).all();
    let info, actions;
    if (kind === "app") {
      const reg2 = reg.clients.get(id);
      const owners = row ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM app_owners WHERE client_id = ?").bind(id).first()).n : 0;
      info = [["client_id", `<code>${id}</code>`], [t(v.lang, "c_source"), t(v.lang, reg2 ? "c_source_registry" : "c_source_console")], [t(v.lang, "c_domain"), `<code>${(row && row.domain) || (reg2 && reg2.domain) || "-"}</code>`], [t(v.lang, "col_status"), row ? V.statusBadge(v.lang, V.appStatus(appEntry(row).app)) : (reg2 ? reg2.status : "-")], [t(v.lang, "c_owners"), String(owners)]];
      actions = [["dismiss", t(v.lang, "adm_act_dismiss"), { reason: true }]];
      if (row) actions.push(["warn", t(v.lang, "adm_act_warn")], ["suspend", t(v.lang, "adm_act_suspend")], ["ban", t(v.lang, "adm_act_ban"), { danger: true }], ["restore", t(v.lang, "adm_act_restore")], ["lift_limit", t(v.lang, "adm_act_lift")]);
    } else {
      const i = reg.idps.get(id);
      const ov = await env.DB.prepare("SELECT * FROM idp_overrides WHERE idp = ?").bind(id).first();
      info = [["id", `<code>${id}</code>`], [t(v.lang, "col_status"), i.status], [t(v.lang, "adm_override"), ov && ov.disabled ? `${t(v.lang, "adm_override_on")} · ${ov.reason || ""}` : t(v.lang, "status_none")]];
      actions = [["dismiss", t(v.lang, "adm_act_dismiss")], ["idp_disable", t(v.lang, "adm_act_idp_disable"), { danger: true }], ["idp_enable", t(v.lang, "adm_act_idp_enable")]];
    }
    const esc2 = (x) => x; // values above are built from validated ids
    const { results: pubs } = await env.DB.prepare("SELECT report_id FROM publications WHERE target_kind = ? AND target_id = ?").bind(kind, id).all();
    const published = new Set((pubs || []).map((r) => r.report_id));
    const shown = (reports || []).map((r) => ({ ...r, published: published.has(r.id), prefill: r.no_publish ? "" : `Category: ${r.category}. Target: ${kind} ${id}.\n\n${redactReportText(r.description)}` }));
    return html(V.adminTarget(v, { s, kind, id, name: localName(target, v.lang), info: info.map(([k, x]) => [k, esc2(x)]), reports: shown, audit: au || [], actions }));
  }
  if (request.method !== "POST" || !action) return null;
  const f = await readPost(request, env, s);
  if (!f) return badRequest(request, v);
  const reason = String(f.get("reason") || "").trim().slice(0, 500) || null;
  const valid = kind === "app" ? APP_ACTIONS[action] : IDP_ACTIONS[action];
  if (!valid || (!reason && action !== "dismiss" && action !== "publish")) return back(v, `/admin/target/${kind}/${id}`, null);
  const t0 = now();
  if (action === "publish") return publishReport(v, env, s, kind, id, f);
  // The basis of the decision: the open items the operator ticked. Only those
  // are closed; a report becomes "upheld" only when ticked for warn, suspend,
  // ban or an identity provider disable. Without a ticked report such an
  // action needs the explicit "own initiative" choice and upholds nothing.
  const wanted = new Set(f.getAll("report_ids").map(String).slice(0, 200));
  const { results: openItems } = await env.DB.prepare("SELECT id, kind, category FROM reports WHERE target_kind = ? AND target_id = ? AND state = 'open'").bind(kind, id).all();
  const ticked = (openItems || []).filter((r) => wanted.has(r.id));
  const tickedReports = ticked.filter((r) => r.kind === "report");
  const upholds = UPHOLDING.has(action);
  if (action === "dismiss" && !ticked.length) return back(v, `/admin/target/${kind}/${id}`, null);
  if (upholds && !tickedReports.length && f.get("own_initiative") !== "yes") return back(v, `/admin/target/${kind}/${id}`, null);
  if (action === "dismiss") {
    for (const r of ticked) await env.DB.prepare("UPDATE reports SET state = 'closed', outcome = CASE WHEN kind = 'report' THEN 'dismissed' ELSE outcome END, closed_by = ?, closed_at = ? WHERE id = ? AND state = 'open'").bind(s.sub, t0, r.id).run();
  } else if (kind === "app") {
    if (!row) return back(v, `/admin/target/${kind}/${id}`, null);
    if (action === "suspend" || action === "ban") {
      await env.DB.prepare("UPDATE apps SET status = ?, status_reason = ?, updated_at = ? WHERE client_id = ?").bind(action === "ban" ? "banned" : "suspended", reason, t0, id).run();
      if (action === "ban") await env.DB.prepare("INSERT INTO banned_domains (domain, client_id, at, reason) VALUES (?, ?, ?, ?) ON CONFLICT(domain) DO NOTHING").bind(row.domain, id, t0, reason).run();
    } else if (action === "restore") {
      await env.DB.prepare("UPDATE apps SET status = 'development', status_reason = NULL, updated_at = ? WHERE client_id = ?").bind(t0, id).run();
      if (row.status === "banned") await env.DB.prepare("DELETE FROM banned_domains WHERE client_id = ?").bind(id).run();
      await settleStatus(env, await loadApp(env, id));
    } else if (action === "lift_limit") {
      await env.DB.prepare("UPDATE apps SET limit_lifted = 1, updated_at = ? WHERE client_id = ?").bind(t0, id).run();
    }
    if (action === "restore") await env.DB.prepare("UPDATE reports SET state = 'closed', closed_by = ?, closed_at = ? WHERE target_kind = 'app' AND target_id = ? AND state = 'open' AND kind = 'appeal'").bind(s.sub, t0, id).run();
  } else if (action === "idp_disable") {
    await env.DB.prepare("INSERT INTO idp_overrides (idp, disabled, reason, by_sub, at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(idp) DO UPDATE SET disabled = 1, reason = excluded.reason, by_sub = excluded.by_sub, at = excluded.at").bind(id, reason, s.sub, t0).run();
    resetMemo();
  } else if (action === "idp_enable") {
    await env.DB.prepare("DELETE FROM idp_overrides WHERE idp = ?").bind(id).run();
    resetMemo();
  }
  await audit(env, s, kind, id, action, reason);
  // The public record (transparency.json): no reporter data, no operator id.
  const decisionId = await recordDecision(env, { kind, id, domain: row ? row.domain : null, decision: action, reason, categories: upholds ? tickedReports.map((r) => r.category) : [] });
  // The ticked reports are upheld by exactly this decision.
  if (upholds) for (const r of tickedReports) await env.DB.prepare("UPDATE reports SET state = 'closed', outcome = 'upheld', decision_id = ?, closed_by = ?, closed_at = ? WHERE id = ? AND state = 'open'").bind(decisionId, s.sub, t0, r.id).run();
  return back(v, `/admin/target/${kind}/${id}`, null);
}

// Publish one closed report after review. The text is redacted again here;
// a reporter who opted out gets category and decision only; a dismissed
// report needs an explicit choice.
async function publishReport(v, env, s, kind, id, f) {
  const rep = await env.DB.prepare("SELECT * FROM reports WHERE id = ? AND target_kind = ? AND target_id = ? AND kind = 'report' AND state = 'closed'").bind(String(f.get("report_id") || ""), kind, id).first();
  if (!rep) return back(v, `/admin/target/${kind}/${id}`, null);
  if (rep.outcome !== "upheld" && f.get("publish_dismissed") !== "yes") return back(v, `/admin/target/${kind}/${id}`, null);
  // Exactly the decision this report was upheld by; a dismissed report has none.
  const dec = rep.outcome === "upheld" && rep.decision_id ? await env.DB.prepare("SELECT id, decision FROM decisions WHERE id = ? AND target_kind = ? AND target_id = ?").bind(rep.decision_id, kind, id).first() : null;
  if (rep.outcome === "upheld" && !dec) return back(v, `/admin/target/${kind}/${id}`, null);
  const lead = dec ? "" : "Not upheld. ";
  const text = rep.no_publish ? `Category: ${rep.category}. Decision: ${dec ? dec.decision : "not upheld"}. (The reporter asked not to publish the description.)` : redactReportText(String(f.get("text") || "")).trim();
  if (!text) return back(v, `/admin/target/${kind}/${id}`, null);
  const body = (rep.no_publish ? text : lead + text).slice(0, 4000);
  await env.DB.prepare("INSERT INTO publications (at, report_id, decision_id, target_kind, target_id, category, text) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(report_id) DO NOTHING")
    .bind(now(), rep.id, dec ? dec.id : null, kind, id, rep.category, body).run();
  await audit(env, s, kind, id, "published", null, rep.id);
  return back(v, `/admin/target/${kind}/${id}`, null);
}

// POST /admin/appeal: an appeal filed as a GitHub issue (appeal form), passed
// on by the repository's issue workflow with the APPEAL_TOKEN bearer. It only
// creates an appeal item in the operator queue.
export async function handleAppealApi(request, env) {
  const authz = request.headers.get("Authorization") || "";
  const tok = /^Bearer /i.test(authz) ? authz.slice(7).trim() : "";
  if (request.method !== "POST" || !env.APPEAL_TOKEN || !tok || !safeEqual(tok, env.APPEAL_TOKEN)) return json({ error: "unauthorized" }, { status: 401 });
  let b; try { b = await request.json(); } catch { return json({ error: "invalid_request" }, { status: 400 }); }
  const issue = Number(b && b.issue) | 0, login = String(b && b.login || "").slice(0, 39), text = String(b && b.text || "").trim().slice(0, 4000);
  const kind = b && b.target_kind === "idp" ? "idp" : "app", tid = String(b && b.target_id || "").trim();
  if (!issue || !login || text.length < 5 || !/^[a-z0-9-]{2,64}$/.test(tid)) return json({ error: "invalid_request" }, { status: 400 });
  const target = await targetOf(env, kind, tid);
  if (!target) return json({ error: "unknown_target" }, { status: 404 });
  const ctx = JSON.stringify({ github_issue: issue });
  const dup = await env.DB.prepare("SELECT id FROM reports WHERE kind = 'appeal' AND context = ?").bind(ctx).first();
  if (dup) return json({ ok: true, id: dup.id, duplicate: true });
  const id = await createReport(env, { kind: "appeal", target_kind: kind, target_id: tid, category: "appeal", description: text, contact_email: null, context: ctx, reporter_hash: await sha256b64url(`appeal|gh|${login}`) });
  await audit(env, "github", kind, tid, "appeal", null, id);
  return json({ ok: true, id });
}
