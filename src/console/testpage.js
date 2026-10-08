// /test and /test/<idp>: sign in once at one identity provider and see the
// normalized claims RoamID would give an application (pairwise subject for
// this page). Nothing is stored after the page is shown.

import { b64url, randomToken, safeEqual } from "../lib/b64.js";
import { cookie, getCookie, redirect, html } from "../lib/http.js";
import { getRegistry } from "../registry/store.js";
import { TEST_CLIENT_ID } from "../apps/store.js";
import { token } from "../oidc/op.js";
import { healthMap } from "../oidc/op.js";
import { t, localName } from "../ui/i18n.js";
import { contentPage, esc, healthBadge } from "../ui/pages.js";

const COOKIE = "__Host-rid_tt";

export async function handleTest(request, env, p, v) {
  const reg = await getRegistry(env);
  const idps = [...reg.idps.values()].filter((i) => i.status === "active");
  if (p === "/test") {
    const health = await healthMap(env);
    const rows = idps.map((i) => `<tr><td data-label="${esc(t(v.lang, "col_name"))}"><b>${esc(localName(i, v.lang))}</b><br><span class="mono">${esc(i.id)}</span></td><td data-label="${esc(t(v.lang, "col_status"))}">${healthBadge(v.lang, i, health[i.id])}</td><td><a class="pill small" href="/test/${esc(i.id)}" id="test-${esc(i.id)}">${esc(t(v.lang, "test_run"))}</a></td></tr>`).join("");
    return html(contentPage({ ...v, active: "", title: t(v.lang, "test_title"), body: `<h1 class="title">${esc(t(v.lang, "test_title"))}</h1><p class="lead">${esc(t(v.lang, "test_lead"))}</p><div class="section box"><div class="scroll"><table class="tbl stack"><tbody>${rows}</tbody></table></div></div>` }));
  }
  if (p === "/test/callback") {
    const q = new URL(request.url).searchParams;
    let st; try { st = JSON.parse(atob(getCookie(request, COOKIE) || "")); } catch { st = null; }
    const clear = cookie(COOKIE, "", { maxAge: 0 });
    if (!st || !q.get("state") || !safeEqual(q.get("state"), st.s)) return redirect("/test", { cookies: [clear] });
    let claims = null, error = q.get("error") ? `${q.get("error")}: ${q.get("error_description") || ""}` : null;
    if (!error) {
      const body = new URLSearchParams({ grant_type: "authorization_code", code: q.get("code") || "", redirect_uri: `${env.BASE_URL}/test/callback`, client_id: TEST_CLIENT_ID, code_verifier: st.v });
      const res = await token(new Request(`${env.BASE_URL}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }), env);
      const j = await res.json();
      if (res.ok) claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
      else error = `${j.error}: ${j.error_description || ""}`;
    }
    const idp = reg.idps.get(st.i);
    const rows = claims ? Object.entries(claims).map(([k, x]) => `<tr><td class="mono">${esc(k)}</td><td><code>${esc(typeof x === "object" ? JSON.stringify(x) : String(x))}</code></td></tr>`).join("") : "";
    const body = `<p class="crumb"><a href="/test">${esc(t(v.lang, "test_title"))}</a></p><h1 class="title">${esc(idp ? localName(idp, v.lang) : st.i)}</h1>
${error ? `<div class="alert" role="alert"><div><p>${esc(t(v.lang, "test_failed"))}</p><p class="mono" id="test-error">${esc(error)}</p></div></div>` : `<p class="lead">${esc(t(v.lang, "test_ok"))}</p><div class="section box"><div class="scroll"><table class="tbl" id="test-claims"><tbody>${rows}</tbody></table></div></div>`}
<div class="btnrow"><a class="pill ghost" href="/test/${esc(st.i)}">${esc(t(v.lang, "test_again"))}</a></div>`;
    return html(contentPage({ ...v, active: "", title: t(v.lang, "test_title"), body }), { cookies: [clear] });
  }
  const id = decodeURIComponent(p.slice(6));
  if (!reg.idps.has(id) || reg.idps.get(id).status !== "active") return null;
  const verifier = randomToken(32), state = randomToken(16);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({ client_id: TEST_CLIENT_ID, redirect_uri: `${env.BASE_URL}/test/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", idp_hint: id, prompt: "login" });
  return redirect(`/authorize?${q}`, { status: 303, cookies: [cookie(COOKIE, btoa(JSON.stringify({ s: state, v: verifier, i: id })), { maxAge: 600 })] });
}
