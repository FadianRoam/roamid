// RoamID pages: menu, lists of identity providers, SAML auto-post, demo.
(function () {
  "use strict";
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


  // ---- lists of identity providers (picker and /idps)
  // Case-, accent- and width-insensitive, as src/ui/list.js norm().
  var norm = function (s) { return String(s || "").normalize("NFKC").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim(); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var countText = function (el, n) { el.textContent = n === 1 ? el.getAttribute("data-one") : el.getAttribute("data-many").replace("{n}", String(n)); };
  // Highlight the first match of the query in a name (text nodes only).
  var mark = function (el, q) {
    var full = el.getAttribute("title") || el.textContent;
    el.textContent = "";
    var i = q ? full.toLowerCase().indexOf(q) : -1;
    if (i < 0) { el.textContent = full; return; }
    el.appendChild(document.createTextNode(full.slice(0, i)));
    var m = document.createElement("mark"); m.textContent = full.slice(i, i + q.length); el.appendChild(m);
    el.appendChild(document.createTextNode(full.slice(i + q.length)));
  };

  // The picker: a combobox (the search field) over a listbox. Arrow keys move
  // through the visible options, Enter selects (Enter again continues),
  // Escape clears the search. "Show all" expands the list; search always
  // looks through every provider.
  var form = $("form.picker");
  if (form) {
    var q = $("#q", form), list = $("#idp-list", form), btn = $("#continue", form), more = $("#show-all", form), cnt = $("#idp-count", form), none = $(".empty.none", form);
    var opts = $$("li[role=option]", list);
    var expanded = !more;
    var active = null;
    var setActive = function (li) {
      if (active) active.classList.remove("active");
      active = li;
      if (li) { li.classList.add("active"); q.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); } else q.removeAttribute("aria-activedescendant");
    };
    var choose = function (li) {
      opts.forEach(function (o) { o.setAttribute("aria-selected", o === li ? "true" : "false"); });
      $("input", li).checked = true;
      btn.disabled = false;
    };
    var visible = function () { return opts.filter(function (o) { return !o.hidden; }); };
    var update = function () {
      var s = norm(q.value), n = 0;
      opts.forEach(function (o) {
        var on = s ? o.getAttribute("data-q").indexOf(s) >= 0 : expanded || !o.hasAttribute("data-more");
        o.hidden = !on; if (on) n++;
        mark($(".n", o), s && on ? q.value.trim().toLowerCase() : "");
      });
      if (more) more.hidden = !!s;
      none.hidden = n > 0;
      countText(cnt, s ? n : opts.length);
      if (active && active.hidden) setActive(null);
    };
    if (more) more.addEventListener("click", function (e) {
      e.preventDefault();
      expanded = !expanded;
      more.setAttribute("aria-expanded", expanded ? "true" : "false");
      var t = more.textContent; more.textContent = more.getAttribute("data-less"); more.setAttribute("data-less", t);
      update();
    });
    q.addEventListener("input", function () { setActive(null); update(); });
    q.addEventListener("keydown", function (e) {
      var vis = visible(), i = active ? vis.indexOf(active) : -1;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(vis[Math.min(vis.length - 1, i + 1)] || null); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(vis[Math.max(0, i - 1)] || null); }
      else if (e.key === "Home" && active) { e.preventDefault(); setActive(vis[0]); }
      else if (e.key === "End" && active) { e.preventDefault(); setActive(vis[vis.length - 1]); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var target = active || (vis.length === 1 ? vis[0] : null);
        if (target && target.getAttribute("aria-selected") !== "true") choose(target);
        else if (!btn.disabled && $("input:checked", list)) form.requestSubmit(btn);
      } else if (e.key === "Escape") { if (q.value) { e.preventDefault(); q.value = ""; setActive(null); update(); } }
    });
    opts.forEach(function (o) {
      o.addEventListener("click", function () { choose(o); setActive(o); });
      o.addEventListener("dblclick", function () { choose(o); if (!btn.disabled) form.requestSubmit(btn); });
    });
    form.addEventListener("submit", function () { btn.disabled = true; });
    update();
  }

  // /idps: search, sort without a reload, sections that remember being closed.
  var bar = $("#idps-bar");
  if (bar) {
    var iq = $("#iq", bar), sort = $("#isort", bar), icnt = $("#icount", bar), inone = $(".empty.none");
    var groups = $$("#idps-groups details.group");
    var closed = {}; try { closed = JSON.parse(store.get("roamid.idps.closed") || "{}") || {}; } catch (e) {}
    groups.forEach(function (g) {
      if (closed[g.id]) g.open = false;
      g.addEventListener("toggle", function () { closed[g.id] = !g.open; store.set("roamid.idps.closed", JSON.stringify(closed)); });
    });
    var rows = $$(".idrow");
    var filter = function () {
      var s = norm(iq.value), n = 0;
      rows.forEach(function (r) { var on = !s || r.getAttribute("data-q").indexOf(s) >= 0; r.hidden = !on; if (on) n++; mark($(".nm", r), s && on ? iq.value.trim().toLowerCase() : ""); });
      groups.forEach(function (g) { var any = $$(".idrow", g).some(function (r) { return !r.hidden; }); g.hidden = !any; if (s && any) g.open = true; });
      countText(icnt, n);
      inone.hidden = n > 0;
    };
    var cmp = {
      name: function (a, b) { return a.getAttribute("data-name").localeCompare(b.getAttribute("data-name")); },
      added: function (a, b) { return (+b.getAttribute("data-added") - +a.getAttribute("data-added")) || cmp.name(a, b); },
      status: function (a, b) { return (+a.getAttribute("data-rank") - +b.getAttribute("data-rank")) || cmp.name(a, b); },
    };
    var resort = function () {
      var by = cmp[sort.value] ? sort.value : "name";
      groups.forEach(function (g) { var ul = $(".idlist", g); $$(".idrow", ul).sort(cmp[by]).forEach(function (r) { ul.appendChild(r); }); });
      try { var u = new URL(location.href); u.searchParams.set("sort", by); history.replaceState(null, "", u); } catch (e) {}
    };
    iq.addEventListener("input", filter);
    iq.addEventListener("keydown", function (e) { if (e.key === "Escape" && iq.value) { iq.value = ""; filter(); } });
    sort.addEventListener("change", resort);
  }

  // Console app form: filter the identity provider list (ticked ones stay visible).
  $$(".idp-list").forEach(function (box) {
    var q = $(".idp-q", box), ls = $$("label[data-q]", box);
    var run = function () { var s = norm(q.value); ls.forEach(function (l) { l.hidden = !!s && l.getAttribute("data-q").indexOf(s) < 0 && !$("input", l).checked; }); };
    q.addEventListener("input", run);
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); if (e.key === "Escape" && q.value) { q.value = ""; run(); } });
  });

  // ---- SAML: post the message on load
  var ap = $("form[data-autopost]");
  if (ap) { var bt = $("button", ap); if (bt) bt.disabled = true; setTimeout(function () { ap.submit(); }, 50); setTimeout(function () { if (bt) bt.disabled = false; }, 3000); }

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
      // /demo?idp=<id> (the landing's sample picker): sign in at that provider.
      var hint = new URLSearchParams(location.search).get("idp");
      if (hint && /^[a-z0-9-]{2,32}$/.test(hint)) p.idp_hint = hint;
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
