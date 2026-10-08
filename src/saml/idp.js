// RoamID as SAML identity provider for service providers that only speak
// SAML. SP-initiated (HTTP-Redirect or HTTP-POST AuthnRequest) and
// IdP-initiated (/saml/idp/sso?sp=<client_id>); the Response goes back by
// HTTP-POST. NameID is persistent and derived like the OIDC sub (public or
// pairwise with the ACS host as sector); attributes come from the
// normalized claims (build.js OUT_ATTRS).

import { NS, SamlError, parseXml, child, attr, text, b64encode, b64decodeText, b64decode, inflateRaw, parseTime } from "./xml.js";
import { samlResponse, samlErrorResponse, idpMetadata, POST } from "./build.js";
import { verifyElement, verifyRedirect } from "./dsig.js";
import { samlKeys, toPem } from "./certs.js";
import { PERSISTENT } from "./response.js";
import { readSamlPost } from "./sp.js";
import { now, html, text as textRes } from "../lib/http.js";
import { getRegistry } from "../registry/store.js";

const UNSPECIFIED = "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified";
export const ST = {
  requester: "urn:oasis:names:tc:SAML:2.0:status:Requester",
  responder: "urn:oasis:names:tc:SAML:2.0:status:Responder",
  authnFailed: "urn:oasis:names:tc:SAML:2.0:status:AuthnFailed",
  noPassive: "urn:oasis:names:tc:SAML:2.0:status:NoPassive",
  denied: "urn:oasis:names:tc:SAML:2.0:status:RequestDenied",
  nameIdPolicy: "urn:oasis:names:tc:SAML:2.0:status:InvalidNameIDPolicy",
};

export function samlSp(reg, entityIdOrClientId, { byClientId = false } = {}) {
  for (const c of reg.clients.values()) {
    if (c.protocol !== "saml2" || c.status !== "active") continue;
    if (byClientId ? c.client_id === entityIdOrClientId : c.entity_id === entityIdOrClientId) return c;
  }
  return null;
}

// Parse and check an AuthnRequest. Returns { sp, requestId, acs, prompt } or
// throws SamlError (code saml_request; `sp`/`acs` set on the error when the
// answer can be posted back to the service provider).
export async function readAuthnRequest(request, env) {
  const url = new URL(request.url);
  let xml, relayState, binding, rawQuery = null;
  if (request.method === "POST") {
    const f = await readSamlPost(request);
    if (!f || !f.request) throw new SamlError("saml_request", "no SAMLRequest");
    xml = b64decodeText(f.request); relayState = f.relayState; binding = "post";
  } else {
    const q = url.searchParams;
    if (!q.get("SAMLRequest")) throw new SamlError("saml_request", "no SAMLRequest");
    xml = await inflateRaw(b64decode(q.get("SAMLRequest")));
    relayState = q.get("RelayState"); binding = "redirect"; rawQuery = url.search.slice(1);
  }
  if (relayState && relayState.length > 1024) throw new SamlError("saml_request", "RelayState too long");
  const doc = parseXml(xml);
  const ar = doc.documentElement;
  if (ar.namespaceURI !== NS.samlp || ar.localName !== "AuthnRequest") throw new SamlError("saml_request", "not an AuthnRequest");
  const reg = await getRegistry(env);
  const issuer = text(child(ar, NS.saml, "Issuer"));
  const sp = samlSp(reg, issuer);
  if (!sp) throw new SamlError("invalid_client", `service provider ${issuer.slice(0, 100)} is not registered`);
  const requestId = attr(ar, "ID");
  if (!requestId || requestId.length > 200) throw new SamlError("saml_request", "AuthnRequest without ID");
  let acs = sp.acs_urls[0];
  if (attr(ar, "AssertionConsumerServiceURL")) {
    acs = attr(ar, "AssertionConsumerServiceURL");
    if (!sp.acs_urls.includes(acs)) throw new SamlError("invalid_redirect_uri", `AssertionConsumerServiceURL ${acs.slice(0, 200)} is not registered`);
  } else if (attr(ar, "AssertionConsumerServiceIndex")) {
    acs = sp.acs_urls[Number(attr(ar, "AssertionConsumerServiceIndex"))];
    if (!acs) throw new SamlError("invalid_redirect_uri", "AssertionConsumerServiceIndex is not registered");
  }
  const err = (msg, status = ST.requester, sub) => Object.assign(new SamlError("saml_request", msg), { sp, acs, requestId, relayState, status, sub });
  if (attr(ar, "ProtocolBinding") && attr(ar, "ProtocolBinding") !== POST) throw err("only the HTTP-POST response binding is supported");
  const ii = parseTime(attr(ar, "IssueInstant"));
  if (!ii || Math.abs(ii - now()) > 600) throw err("IssueInstant missing or more than 10 minutes off");
  if (attr(ar, "Destination") && attr(ar, "Destination") !== `${env.BASE_URL}/saml/idp/sso`) throw err("Destination is not this SSO URL");
  if (sp.sign_cert) {
    const certs = [toPem(sp.sign_cert)];
    if (binding === "redirect") {
      const parts = Object.fromEntries(rawQuery.split("&").map((p) => [p.split("=")[0], p]));
      const octets = ["SAMLRequest", "RelayState", "SigAlg"].filter((k) => parts[k]).map((k) => parts[k]).join("&");
      const q = url.searchParams;
      if (!q.get("Signature") || !verifyRedirect(octets, q.get("Signature"), q.get("SigAlg"), certs)) throw err("the AuthnRequest signature is missing or invalid", ST.requester, ST.denied);
    } else {
      try { verifyElement(ar, xml, certs); } catch { throw err("the AuthnRequest signature is missing or invalid", ST.requester, ST.denied); }
    }
  }
  const policy = attr(child(ar, NS.samlp, "NameIDPolicy"), "Format");
  if (policy && policy !== PERSISTENT && policy !== UNSPECIFIED) throw err("only persistent NameIDs are issued", ST.requester, ST.nameIdPolicy);
  const prompt = attr(ar, "IsPassive") === "true" ? "none" : attr(ar, "ForceAuthn") === "true" ? "login" : null;
  return { sp, requestId, acs, relayState, prompt };
}

// The auto-submitting form that carries a SAML message to the service provider.
export function postForm(acs, samlResponseXml, relayState) {
  return { action: acs, fields: { SAMLResponse: b64encode(samlResponseXml), ...(relayState ? { RelayState: relayState } : {}) } };
}

export function successForm(env, { sp, acs, requestId, relayState, nameId, claims, authnInstant }) {
  const [key] = samlKeys(env);
  const xml = samlResponse(env, key, { sp, acs, inResponseTo: requestId, nameId, claims, now: now(), authnInstant });
  return postForm(acs, xml, relayState);
}

export function errorForm(env, { acs, requestId, relayState, status = ST.responder, sub, message }) {
  const [key] = samlKeys(env);
  const xml = samlErrorResponse(env, key, { acs, inResponseTo: requestId, status, sub, message, now: now() });
  return postForm(acs, xml, relayState);
}

// OIDC error code -> SAML status for the same situation.
export function samlStatusFor(error) {
  if (error === "access_denied") return { status: ST.responder, sub: ST.authnFailed };
  if (["login_required", "interaction_required", "consent_required", "account_selection_required"].includes(error)) return { status: ST.responder, sub: ST.noPassive };
  if (error === "invalid_request") return { status: ST.requester };
  return { status: ST.responder };
}

export function idpMetadataHandler(env) {
  return textRes(idpMetadata(env, samlKeys(env)), { type: "application/samlmetadata+xml; charset=utf-8", cache: "public, max-age=300" });
}
