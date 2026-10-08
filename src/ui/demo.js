// /demo: a relying party that runs in the browser. It is registered in the
// registry as client "roamid-demo" (public client, PKCE S256) and talks to
// RoamID only through the public endpoints, like any single-page application.

import { layout, esc, icon } from "./pages.js";
import { t } from "./i18n.js";

export const DEMO_CLIENT_ID = "roamid-demo";

export function demoPage({ lang, theme, nonce, path }) {
  const L = {};
  for (const k of ["demo_claims", "demo_userinfo", "demo_working", "demo_failed", "demo_again", "demo_signout", "demo_verified", "demo_asserted"]) L[k] = t(lang, k);
  const body = `
<h1>${esc(t(lang, "demo_title"))}</h1>
<p class="lead">${esc(t(lang, "demo_lead"))}</p>
<div class="row" id="start"><button class="btn" id="signin" type="button">${esc(t(lang, "demo_signin"))}</button></div>
<div id="out" aria-live="polite"></div>`;
  const script = `(function(){
var L=${JSON.stringify(L).replace(/</g, "\\u003c")};var CID=${JSON.stringify(DEMO_CLIENT_ID)};var B=location.origin;var RU=B+"/demo/callback";var K="roamid-demo";
function rnd(n){var a=new Uint8Array(n);crypto.getRandomValues(a);return b64(a);}
function b64(a){var s="";a=new Uint8Array(a);for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}
function dec(p){var s=p.replace(/-/g,"+").replace(/_/g,"/");s+="===".slice((s.length+3)%4);return JSON.parse(decodeURIComponent(escape(atob(s))));}
function el(tag,txt,cls){var e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}
var out=document.getElementById("out");
function table(title,obj){var h=el("h2",title);out.appendChild(h);var d=el("div",null,"scroll");var tb=el("table");var b=el("tbody");
Object.keys(obj).forEach(function(k){var tr=el("tr");tr.appendChild(el("td",k,"mono"));var v=obj[k];var td=el("td");
if(k==="email_authority"){td.appendChild(el("span",v,"tag "+(v==="authoritative"?"good":"warn")));td.appendChild(document.createTextNode(" "+(v==="authoritative"?L.demo_verified:L.demo_asserted)));}
else td.appendChild(el("code",typeof v==="string"?v:JSON.stringify(v)));tr.appendChild(td);b.appendChild(tr);});tb.appendChild(b);d.appendChild(tb);out.appendChild(d);}
function fail(msg){out.textContent="";var e=el("div",null,"err");e.appendChild(el("p",L.demo_failed+": "+msg));out.appendChild(e);}
document.getElementById("signin").addEventListener("click",async function(){
var v=rnd(48);var st=rnd(24);var no=rnd(24);var ch=b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));
sessionStorage.setItem(K,JSON.stringify({v:v,st:st,no:no}));
var u=new URL(B+"/authorize");var p={response_type:"code",client_id:CID,redirect_uri:RU,scope:"openid email profile",state:st,nonce:no,code_challenge:ch,code_challenge_method:"S256"};
Object.keys(p).forEach(function(k){u.searchParams.set(k,p[k]);});location.assign(u.toString());});
if(location.pathname!=="/demo/callback")return;
var q=new URLSearchParams(location.search);history.replaceState(null,"","/demo");
var saved=null;try{saved=JSON.parse(sessionStorage.getItem(K)||"null");}catch(e){}sessionStorage.removeItem(K);
if(q.get("error")){fail(q.get("error")+(q.get("error_description")?" ("+q.get("error_description")+")":""));return;}
if(!saved||q.get("state")!==saved.st){fail("state mismatch");return;}
if(q.get("iss")!==B){fail("iss mismatch");return;}
out.appendChild(el("p",L.demo_working,"lead"));
(async function(){
var body=new URLSearchParams({grant_type:"authorization_code",code:q.get("code")||"",redirect_uri:RU,client_id:CID,code_verifier:saved.v});
var r=await fetch(B+"/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body});var tok=await r.json();
if(!r.ok){fail(tok.error+(tok.error_description?" ("+tok.error_description+")":""));return;}
var claims=dec(tok.id_token.split(".")[1]);if(claims.nonce!==saved.no){fail("nonce mismatch");return;}
var ui=await (await fetch(B+"/userinfo",{headers:{Authorization:"Bearer "+tok.access_token}})).json();
sessionStorage.setItem(K+"-idt",tok.id_token);
out.textContent="";document.getElementById("start").hidden=true;
table(L.demo_claims,claims);table(L.demo_userinfo,ui);
var row=el("div",null,"row");var a=el("button",L.demo_again,"btn");a.type="button";a.addEventListener("click",function(){document.getElementById("signin").click();});
var o=el("a",L.demo_signout,"btn ghost");var lu=new URL(B+"/logout");lu.searchParams.set("client_id",CID);lu.searchParams.set("id_token_hint",tok.id_token);lu.searchParams.set("post_logout_redirect_uri",B+"/demo");o.href=lu.toString();
row.appendChild(a);row.appendChild(o);out.appendChild(row);})().catch(function(e){fail(String(e&&e.message||e));});
})();`;
  return layout({ lang, theme, path, nonce, title: t(lang, "demo_title") + " · RoamID", body, script });
}

export { icon };
