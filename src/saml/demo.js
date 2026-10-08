// /demo/saml: a SAML service provider inside RoamID, registered in the
// registry as client "roamid-demo-saml". It sends an AuthnRequest to
// RoamID's SAML IdP endpoint and verifies the Response with the same code
// RoamID uses for SAML identity providers.

import { b64encode, deflateRaw, samlId, b64decodeText } from "./xml.js";
import { idpEntityId } from "./build.js";
import { verifyResponse } from "./response.js";
import { samlKeys } from "./certs.js";
import { readSamlPost } from "./sp.js";
import { NS, escapeXml as x, samlTime } from "./xml.js";
import { redirect, html, cookie, getCookie, now } from "../lib/http.js";
import { sha256b64url } from "../lib/b64.js";
import { samlDemoPage } from "../ui/pages.js";

export const DEMO_SAML_CLIENT_ID = "roamid-demo-saml";
const REQ_COOKIE = "__Host-rid_dsr";
const entity = (env) => `${env.BASE_URL}/demo/saml`;
const acs = (env) => `${env.BASE_URL}/demo/saml/acs`;

export async function demoSamlStart(env) {
  const id = samlId();
  const xml = `<samlp:AuthnRequest xmlns:samlp="${NS.samlp}" xmlns:saml="${NS.saml}" ID="${id}" Version="2.0" IssueInstant="${samlTime(now())}" Destination="${x(env.BASE_URL)}/saml/idp/sso" AssertionConsumerServiceURL="${x(acs(env))}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${x(entity(env))}</saml:Issuer><samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent" AllowCreate="true"/></samlp:AuthnRequest>`;
  const q = `SAMLRequest=${encodeURIComponent(b64encode(await deflateRaw(xml)))}&RelayState=demo`;
  return redirect(`/saml/idp/sso?${q}`, { cookies: [cookie(REQ_COOKIE, id, { maxAge: 600 })] });
}

export async function demoSamlAcs(request, env, v) {
  const f = await readSamlPost(request);
  const requestId = getCookie(request, REQ_COOKIE);
  const clear = [cookie(REQ_COOKIE, "", { maxAge: 0 })];
  let result;
  try {
    if (!f || !f.response) throw new Error("no SAMLResponse");
    if (!requestId) throw new Error("no pending request in this browser");
    const r = await verifyResponse(b64decodeText(f.response), { acs: acs(env), spEntityId: entity(env), idpEntityId: idpEntityId(env), requestId, certs: samlKeys(env).map((k) => k.cert), keys: samlKeys(env) });
    const k = await sha256b64url(`demo-saml|${r.assertionId}`);
    const ins = await env.DB.prepare("INSERT INTO jti (k, expires) VALUES (?, ?) ON CONFLICT(k) DO NOTHING").bind(k, r.notOnOrAfter + 300).run();
    if (!ins.meta || ins.meta.changes !== 1) throw new Error("assertion already used");
    result = { ok: true, nameId: r.nameId, nameIdFormat: r.nameIdFormat, attributes: r.attributes, relayState: f.relayState };
  } catch (e) {
    result = { ok: false, error: String(e.code ? `${e.code}: ${e.message}` : e.message || e) };
  }
  return html(samlDemoPage({ ...v, result }), { cookies: clear });
}

export function demoSamlPage(v) {
  return html(samlDemoPage({ ...v, result: null }));
}
