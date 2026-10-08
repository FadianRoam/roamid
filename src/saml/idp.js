// RoamID as SAML identity provider for service providers that only speak
// SAML. SP-initiated (HTTP-Redirect or HTTP-POST AuthnRequest) and
// IdP-initiated (/saml/idp/sso?sp=<client_id>); the Response goes back by
// HTTP-POST. NameID is persistent and derived like the OIDC sub (public or
// pairwise with the ACS host as sector); attributes come from the
// normalized claims (build.js OUT_ATTRS).

import { NS, SamlError, parseXml, child, attr, text, b64encode, b64decodeText, b64decode, inflateRaw, parseTime } from "./xml.js";
import { samlResponse, samlErrorResponse, idpMetadata, POST } from "./build.js";
import { verifyElement, verifyRedirect, assertUniqueIds } from "./dsig.js";
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

// HTTP-Redirect binding parameters, read once from the raw query string.
// Each SAML parameter may appear at most once (compared by decoded name, so
// "SAML%52equest" counts as "SAMLRequest"). The signed octets (SAML Bindings
// 3.4.4.1) are built from the same raw pieces whose values are decoded and
// used, so what is verified is what is processed.
const REDIRECT_PARAMS = ["SAMLRequest", "SAMLResponse", "RelayState", "SigAlg", "Signature"];
const formDecode = (s) => {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { throw new SamlError("saml_request", "malformed query string"); }
};
export function readRedirectQuery(rawQuery) {
  const out = {};
  for (const piece of String(rawQuery || "").split("&")) {
    if (!piece) continue;
    const i = piece.indexOf("=");
    const name = formDecode(i < 0 ? piece : piece.slice(0, i));
    if (!REDIRECT_PARAMS.includes(name)) continue;
    if (out[name]) throw new SamlError("saml_request", `${name} appears more than once`);
    out[name] = { raw: piece, value: formDecode(i < 0 ? "" : piece.slice(i + 1)) };
  }
  return out;
}
// The octets the Redirect-binding signature covers, from the raw pieces.
export function redirectOctets(params, msg = "SAMLRequest") {
  return [msg, "RelayState", "SigAlg"].filter((k) => params[k]).map((k) => params[k].raw).join("&");
}

// Fields of an AuthnRequest element.
function requestFields(ar) {
  return {
    issuer: text(child(ar, NS.saml, "Issuer")),
    requestId: attr(ar, "ID"),
    acsUrl: attr(ar, "AssertionConsumerServiceURL"),
    acsIndex: attr(ar, "AssertionConsumerServiceIndex"),
    protocolBinding: attr(ar, "ProtocolBinding"),
    issueInstant: attr(ar, "IssueInstant"),
    destination: attr(ar, "Destination"),
    nameIdPolicy: attr(child(ar, NS.samlp, "NameIDPolicy"), "Format"),
    isPassive: attr(ar, "IsPassive"),
    forceAuthn: attr(ar, "ForceAuthn"),
  };
}

const isRequest = (el) => el && el.namespaceURI === NS.samlp && el.localName === "AuthnRequest";

// Parse and check an AuthnRequest. Returns { sp, requestId, acs, prompt } or
// throws SamlError (code saml_request; `sp`/`acs` set on the error when the
// answer can be posted back to the service provider).
export async function readAuthnRequest(request, env) {
  const url = new URL(request.url);
  let xml, relayState, binding, params = null;
  if (request.method === "POST") {
    const f = await readSamlPost(request);
    if (!f || !f.request) throw new SamlError("saml_request", "no SAMLRequest");
    xml = b64decodeText(f.request); relayState = f.relayState; binding = "post";
  } else {
    params = readRedirectQuery(url.search.slice(1));
    if (!params.SAMLRequest || !params.SAMLRequest.value) throw new SamlError("saml_request", "no SAMLRequest");
    if (params.SAMLResponse) throw new SamlError("saml_request", "SAMLRequest and SAMLResponse together");
    xml = await inflateRaw(b64decode(params.SAMLRequest.value));
    relayState = params.RelayState ? params.RelayState.value : null; binding = "redirect";
  }
  if (relayState && relayState.length > 1024) throw new SamlError("saml_request", "RelayState too long");
  const doc = parseXml(xml);
  if (!isRequest(doc.documentElement)) throw new SamlError("saml_request", "not an AuthnRequest");
  assertUniqueIds(doc);
  let fields = requestFields(doc.documentElement);
  const reg = await getRegistry(env);
  const sp = samlSp(reg, fields.issuer);
  if (!sp) throw new SamlError("invalid_client", `service provider ${fields.issuer.slice(0, 100)} is not registered`);
  const denied = (msg) => Object.assign(new SamlError("saml_request", msg), { sp, acs: sp.acs_urls[0], requestId: fields.requestId && fields.requestId.length <= 200 ? fields.requestId : null, relayState, status: ST.requester, sub: ST.denied });
  if (sp.sign_cert) {
    // Verify first; everything below is read from what was verified.
    const certs = [toPem(sp.sign_cert)];
    if (binding === "redirect") {
      if (!params.Signature || !params.SigAlg) throw denied("the AuthnRequest signature is missing or invalid");
      let ok;
      try { ok = verifyRedirect(redirectOctets(params), params.Signature.value, params.SigAlg.value, certs); } catch (e) {
        if (e instanceof SamlError && e.code === "saml_algorithm") throw denied(e.message);
        ok = false;
      }
      if (!ok) throw denied("the AuthnRequest signature is missing or invalid");
    } else {
      let signed;
      try { signed = parseXml(verifyElement(doc.documentElement, xml, certs)).documentElement; } catch { throw denied("the AuthnRequest signature is missing or invalid"); }
      if (!isRequest(signed)) throw denied("the AuthnRequest signature is missing or invalid");
      const v = requestFields(signed);
      if (v.issuer !== fields.issuer) throw denied("the AuthnRequest signature is missing or invalid");
      fields = v;
    }
  } else if (binding === "redirect" && (params.Signature || params.SigAlg)) {
    // A signature that cannot be checked is not ignored silently.
    if (params.SigAlg && !["http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512"].includes(params.SigAlg.value)) throw denied(`signature algorithm not allowed: ${params.SigAlg.value.slice(0, 100)}`);
  }
  const requestId = fields.requestId;
  if (!requestId || requestId.length > 200) throw new SamlError("saml_request", "AuthnRequest without ID");
  let acs = sp.acs_urls[0];
  if (fields.acsUrl) {
    acs = fields.acsUrl;
    if (!sp.acs_urls.includes(acs)) throw new SamlError("invalid_redirect_uri", `AssertionConsumerServiceURL ${acs.slice(0, 200)} is not registered`);
  } else if (fields.acsIndex) {
    acs = /^\d{1,3}$/.test(fields.acsIndex) ? sp.acs_urls[Number(fields.acsIndex)] : null;
    if (!acs) throw new SamlError("invalid_redirect_uri", "AssertionConsumerServiceIndex is not registered");
  }
  const err = (msg, status = ST.requester, sub) => Object.assign(new SamlError("saml_request", msg), { sp, acs, requestId, relayState, status, sub });
  if (fields.protocolBinding && fields.protocolBinding !== POST) throw err("only the HTTP-POST response binding is supported");
  const ii = parseTime(fields.issueInstant);
  if (!ii || Math.abs(ii - now()) > 600) throw err("IssueInstant missing or more than 10 minutes off");
  if (fields.destination && fields.destination !== `${env.BASE_URL}/saml/idp/sso`) throw err("Destination is not this SSO URL");
  if (fields.nameIdPolicy && fields.nameIdPolicy !== PERSISTENT && fields.nameIdPolicy !== UNSPECIFIED) throw err("only persistent NameIDs are issued", ST.requester, ST.nameIdPolicy);
  const prompt = fields.isPassive === "true" ? "none" : fields.forceAuthn === "true" ? "login" : null;
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
