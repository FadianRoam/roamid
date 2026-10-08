// RoamID pages: menu, stage scaling, entrance, band video, picker, demo.
(function () {
  "use strict";
  var d = document.documentElement;
  var reduce = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // ---- compact menu: Escape and outside click close it
  $$("details.menu").forEach(function (m) {
    var s = $("summary", m);
    var sync = function () { s.setAttribute("aria-expanded", m.open ? "true" : "false"); };
    m.addEventListener("toggle", sync); sync();
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && m.open) { m.open = false; s.focus(); } });
    document.addEventListener("click", function (e) { if (m.open && !m.contains(e.target)) m.open = false; });
  });

  // ---- 1290x860 design stage, scaled to fit; the grid flow below 940 px,
  // and on the picker whenever scaling would make the input smaller than 16 px.
  var hero = $(".hero");
  if (hero) {
    var picker = hero.getAttribute("data-page") === "picker";
    var fit = function () {
      var W = d.clientWidth, H = window.innerHeight;
      var s = Math.min(W / 1290, H / 860);
      var on = W >= 940 && (!picker || s * 17 >= 16);
      d.classList.toggle("staged", on);
      if (on) {
        d.style.setProperty("--s", String(s));
        d.style.setProperty("--bleed", Math.max(0, (W / s - 1290) / 2) + "px");
        d.style.setProperty("--below", Math.max(0, H / s - 860) + "px");
      }
    };
    fit();
    window.addEventListener("resize", fit);
  }

  // ---- entrance, once: after fonts and two frames, or after 1200 ms
  if (d.classList.contains("enter")) {
    $$(".nav .brand, .nav .links a, .nav .tools > *, .nav .nav-cta, .nav .menu").forEach(function (e, i) { e.style.setProperty("--i", String(i)); });
    var started = false;
    var go = function () {
      if (started) return; started = true;
      d.classList.add("entering");
      requestAnimationFrame(function () {
        d.classList.remove("enter");
        setTimeout(function () { d.classList.remove("entering"); }, 1900);
      });
    };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(go); });
    });
    setTimeout(go, 1200);
  }

  // ---- band video: plays unless reduced motion
  var v = $(".band video");
  if (v) {
    var sync = function () {
      if (reduce.matches) { v.pause(); return; }
      v.muted = true;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    };
    sync();
    if (reduce.addEventListener) reduce.addEventListener("change", sync);
  }

  // ---- picker: search, keyboard, Continue
  var form = $("form.picker");
  if (form) {
    var q = $("input[type=search]", form);
    var rows = $$("li[data-q]", form);
    var none = $(".none", form);
    var btn = $("button[type=submit]", form);
    var visible = function () { return rows.filter(function (r) { return !r.hidden; }).map(function (r) { return $("input", r); }); };
    var update = function () {
      var s = q.value.trim().toLowerCase(), n = 0;
      rows.forEach(function (r) { var on = !s || r.getAttribute("data-q").indexOf(s) >= 0; r.hidden = !on; if (on) n++; });
      none.hidden = n > 0 || !rows.length;
      var c = $("input[name=idp]:checked", form);
      if (!c || c.closest("li").hidden) { var f = visible()[0]; if (f) f.checked = true; }
      btn.disabled = !$("li:not([hidden]) input[name=idp]:checked", form);
    };
    q.addEventListener("input", update);
    q.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); var c = $("li:not([hidden]) input:checked", form) || visible()[0]; if (c) c.focus(); }
      if (e.key === "Enter") { e.preventDefault(); if (!btn.disabled) form.requestSubmit(btn); }
    });
    rows.forEach(function (r) {
      $("input", r).addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp" && visible()[0] === e.target) { e.preventDefault(); q.focus(); }
      });
      r.addEventListener("dblclick", function () { if (!btn.disabled) form.requestSubmit(btn); });
    });
    form.addEventListener("submit", function () { btn.disabled = true; });
    update();
  }

  // ---- demo application (public client with PKCE), runs in the browser
  var demo = $("#demo");
  if (demo) {
    var L = JSON.parse($("#demo-text").textContent);
    var CID = demo.getAttribute("data-client"), B = location.origin, RU = B + "/demo/callback", K = "roamid-demo";
    var b64 = function (a) { var s = "", u = new Uint8Array(a); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    var rnd = function (n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64(a); };
    var dec = function (p) { var s = p.replace(/-/g, "+").replace(/_/g, "/"); s += "===".slice((s.length + 3) % 4); return JSON.parse(decodeURIComponent(escape(atob(s)))); };
    var el = function (tag, txt, cls) { var e = document.createElement(tag); if (txt != null) e.textContent = txt; if (cls) e.className = cls; return e; };
    var out = $("#out");
    var table = function (title, obj) {
      var sec = el("div", null, "section"); sec.appendChild(el("h2", title));
      var wrap = el("div", null, "scroll"), tb = el("table", null, "tbl"), body = el("tbody");
      Object.keys(obj).forEach(function (k) {
        var tr = el("tr"); tr.appendChild(el("td", k, "mono")); var v = obj[k], td = el("td");
        if (k === "email_authority") { td.appendChild(el("span", v, "claims-tag" + (v === "authoritative" ? " ok" : ""))); td.appendChild(document.createTextNode(v === "authoritative" ? L.verified : L.asserted)); }
        else td.appendChild(el("code", typeof v === "string" ? v : JSON.stringify(v)));
        tr.appendChild(td); body.appendChild(tr);
      });
      tb.appendChild(body); wrap.appendChild(tb); sec.appendChild(wrap); out.appendChild(sec);
    };
    var fail = function (msg) { out.textContent = ""; var a = el("div", null, "alert"); a.appendChild(el("p", L.failed + ": " + msg)); out.appendChild(a); };
    var signin = async function () {
      var v = rnd(48), st = rnd(24), no = rnd(24);
      var ch = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
      sessionStorage.setItem(K, JSON.stringify({ v: v, st: st, no: no }));
      var u = new URL(B + "/authorize");
      var p = { response_type: "code", client_id: CID, redirect_uri: RU, scope: "openid email profile", state: st, nonce: no, code_challenge: ch, code_challenge_method: "S256" };
      Object.keys(p).forEach(function (k) { u.searchParams.set(k, p[k]); });
      location.assign(u.toString());
    };
    $("#signin").addEventListener("click", signin);
    if (location.pathname === "/demo/callback") {
      var q2 = new URLSearchParams(location.search); history.replaceState(null, "", "/demo");
      var saved = null; try { saved = JSON.parse(sessionStorage.getItem(K) || "null"); } catch (e) { /* none */ }
      sessionStorage.removeItem(K);
      if (q2.get("error")) fail(q2.get("error") + (q2.get("error_description") ? " (" + q2.get("error_description") + ")" : ""));
      else if (!saved || q2.get("state") !== saved.st) fail("state mismatch");
      else if (q2.get("iss") !== B) fail("iss mismatch");
      else (async function () {
        out.appendChild(el("p", L.working, "lead"));
        var body = new URLSearchParams({ grant_type: "authorization_code", code: q2.get("code") || "", redirect_uri: RU, client_id: CID, code_verifier: saved.v });
        var r = await fetch(B + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body });
        var tok = await r.json();
        if (!r.ok) { fail(tok.error + (tok.error_description ? " (" + tok.error_description + ")" : "")); return; }
        var claims = dec(tok.id_token.split(".")[1]);
        if (claims.nonce !== saved.no) { fail("nonce mismatch"); return; }
        var ui = await (await fetch(B + "/userinfo", { headers: { Authorization: "Bearer " + tok.access_token } })).json();
        out.textContent = ""; $("#start").hidden = true;
        table(L.claims, claims); table(L.userinfo, ui);
        var row = el("div", null, "btnrow");
        var a = el("button", L.again, "pill"); a.type = "button"; a.id = "again"; a.addEventListener("click", signin);
        var o = el("a", L.signout, "pill ghost"); o.id = "signout";
        var lu = new URL(B + "/logout"); lu.searchParams.set("client_id", CID); lu.searchParams.set("id_token_hint", tok.id_token); lu.searchParams.set("post_logout_redirect_uri", B + "/demo");
        o.href = lu.toString(); row.appendChild(a); row.appendChild(o); out.appendChild(row);
      })().catch(function (e) { fail(String(e && e.message || e)); });
    }
  }
})();
