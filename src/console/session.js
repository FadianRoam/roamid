// Sign-in to the console and the operator queue with RoamID itself: the
// built-in public client "roamid-console" (PKCE, public subject). The
// session key is the RoamID public sub, the same value for every identity
// provider login of the same person at that provider.

import { b64url, randomToken, sha256b64url, safeEqual } from "../lib/b64.js";
import { cookie, getCookie, redirect, now, readForm } from "../lib/http.js";
import { CONSOLE_CLIENT_ID } from "../apps/store.js";
import { token } from "../oidc/op.js";

export const SESSION_COOKIE = "__Host-rid_cs";
const LOGIN_COOKIE = "__Host-rid_cl";
const SESSION_TTL = 8 * 3600;

const safeNext = (n) => (typeof n === "string" && /^\/(console|admin)(\/|$|\?)/.test(n) && !n.startsWith("//") ? n : "/console");

export async function loginStart(request, env) {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const verifier = randomToken(32), state = randomToken(16);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({ client_id: CONSOLE_CLIENT_ID, redirect_uri: `${env.BASE_URL}/console/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", nonce: randomToken(12) });
  const c = btoa(JSON.stringify({ s: state, v: verifier, n: next }));
  return redirect(`/authorize?${q}`, { status: 303, cookies: [cookie(LOGIN_COOKIE, c, { maxAge: 600 })] });
}

export async function loginCallback(request, env) {
  const q = new URL(request.url).searchParams;
  let st;
  try { st = JSON.parse(atob(getCookie(request, LOGIN_COOKIE) || "")); } catch { st = null; }
  const clear = cookie(LOGIN_COOKIE, "", { maxAge: 0 });
  if (!st || !q.get("state") || !safeEqual(q.get("state"), st.s)) return redirect("/console?signin=expired", { cookies: [clear] });
  if (q.get("error") || !q.get("code")) return redirect("/console", { cookies: [clear] });
  if (q.get("iss") !== env.BASE_URL) return redirect("/console?signin=failed", { cookies: [clear] });
  // Redeem the code with the token endpoint's own checks.
  const body = new URLSearchParams({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: `${env.BASE_URL}/console/callback`, client_id: CONSOLE_CLIENT_ID, code_verifier: st.v });
  const res = await token(new Request(`${env.BASE_URL}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }), env);
  if (!res.ok) return redirect("/console?signin=failed", { cookies: [clear] });
  const tok = await res.json();
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(tok.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  const sid = randomToken(32), csrf = randomToken(24);
  await env.DB.prepare("INSERT INTO console_sessions (sid_hash, sub, email, email_authority, name, idp, csrf, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256b64url(sid), claims.sub, claims.email || null, claims.email_authority || null, claims.name || claims.preferred_username || null, claims.idp, csrf, now() + SESSION_TTL).run();
  return redirect(safeNext(st.n), { status: 303, cookies: [clear, cookie(SESSION_COOKIE, sid, { maxAge: SESSION_TTL })] });
}

export async function getSession(request, env) {
  const sid = getCookie(request, SESSION_COOKIE);
  if (!sid || sid.length > 100) return null;
  const row = await env.DB.prepare("SELECT * FROM console_sessions WHERE sid_hash = ?").bind(await sha256b64url(sid)).first();
  return row && row.expires > now() ? row : null;
}

export async function logoutSession(request, env) {
  const sid = getCookie(request, SESSION_COOKIE);
  if (sid) await env.DB.prepare("DELETE FROM console_sessions WHERE sid_hash = ?").bind(await sha256b64url(sid)).run();
  return redirect("/console", { status: 303, cookies: [cookie(SESSION_COOKIE, "", { maxAge: 0 })] });
}

// A state-changing form post: same origin, a session, and its CSRF token.
export async function readPost(request, env, session) {
  if (request.method !== "POST" || !session) return null;
  // Pages send Referrer-Policy: no-referrer, so a browser's form post carries
  // "Origin: null"; Sec-Fetch-Site then decides. Without Sec-Fetch-Site the
  // Origin must be this site.
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site ? site !== "same-origin" : origin !== new URL(env.BASE_URL).origin) { console.warn("[console] post refused:", site || "-", origin || "-"); return null; }
  const f = await readForm(request);
  if (!f || !f.get("csrf") || !safeEqual(f.get("csrf"), session.csrf)) { console.warn("[console] post refused: csrf", !!f, f && !!f.get("csrf")); return null; }
  return f;
}

export const isOperator = (env, session) => !!session && String(env.OPERATOR_SUBS || "").split(/[\s,]+/).filter(Boolean).includes(session.sub);
