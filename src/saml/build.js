// SAML documents RoamID produces: AuthnRequest (to identity providers),
// SP and IdP metadata, Response + Assertion (to service providers), and the
// parser for an identity provider's metadata.

import { NS, SamlError, escapeXml as x, samlTime, samlId, parseXml, child, children, descendants, attr, text, parseTime } from "./xml.js";
import { certBody } from "./certs.js";
import { signElement } from "./dsig.js";
import { PERSISTENT } from "./response.js";

export const spEntityId = (env) => `${env.BASE_URL}/saml/sp`;
export const idpEntityId = (env) => `${env.BASE_URL}/saml/idp`;
export const acsUrl = (env, idpId) => `${env.BASE_URL}/saml/acs/${idpId}`;
const POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const REDIRECT = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";

export function authnRequest(env, { id, idpId, destination, forceAuthn, isPassive, now }) {
  return `<samlp:AuthnRequest xmlns:samlp="${NS.samlp}" xmlns:saml="${NS.saml}" ID="${id}" Version="2.0" IssueInstant="${samlTime(now)}" Destination="${x(destination)}" AssertionConsumerServiceURL="${x(acsUrl(env, idpId))}" ProtocolBinding="${POST}"${forceAuthn ? ' ForceAuthn="true"' : ""}${isPassive ? ' IsPassive="true"' : ""}><saml:Issuer>${x(spEntityId(env))}</saml:Issuer><samlp:NameIDPolicy AllowCreate="true"/></samlp:AuthnRequest>`;
}

const keyDescriptors = (keys, uses) => keys.map((k) => uses.map((u) => `<md:KeyDescriptor use="${u}"><ds:KeyInfo xmlns:ds="${NS.ds}"><ds:X509Data><ds:X509Certificate>${certBody(k.cert)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>${u === "encryption" ? '<md:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#aes256-gcm"/><md:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#aes128-gcm"/><md:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"/>' : ""}</md:KeyDescriptor>`).join("")).join("");

// SP metadata: one AssertionConsumerService per SAML identity provider
// (or only `idpId`'s).
export function spMetadata(env, keys, idpIds) {
  const acs = idpIds.map((id, i) => `<md:AssertionConsumerService Binding="${POST}" Location="${x(acsUrl(env, id))}" index="${i}"${i === 0 ? ' isDefault="true"' : ""}/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<md:EntityDescriptor xmlns:md="${NS.md}" entityID="${x(spEntityId(env))}"><md:SPSSODescriptor AuthnRequestsSigned="true" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">${keyDescriptors(keys, ["signing", "encryption"])}<md:NameIDFormat>${PERSISTENT}</md:NameIDFormat>${acs}</md:SPSSODescriptor></md:EntityDescriptor>\n`;
}

export function idpMetadata(env, keys) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<md:EntityDescriptor xmlns:md="${NS.md}" entityID="${x(idpEntityId(env))}"><md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">${keyDescriptors(keys, ["signing"])}<md:NameIDFormat>${PERSISTENT}</md:NameIDFormat><md:SingleSignOnService Binding="${REDIRECT}" Location="${x(env.BASE_URL)}/saml/idp/sso"/><md:SingleSignOnService Binding="${POST}" Location="${x(env.BASE_URL)}/saml/idp/sso"/></md:IDPSSODescriptor></md:EntityDescriptor>\n`;
}

// Attributes sent to service providers, from the normalized claims.
export const OUT_ATTRS = [
  ["email", "urn:oid:0.9.2342.19200300.100.1.3", "mail"],
  ["name", "urn:oid:2.16.840.1.113730.3.1.241", "displayName"],
  ["preferred_username", "urn:oid:0.9.2342.19200300.100.1.1", "uid"],
  ["email_verified", "urn:roamid:claims:email_verified", "email_verified"],
  ["email_authority", "urn:roamid:claims:email_authority", "email_authority"],
  ["idp", "urn:roamid:claims:idp", "idp"],
  ["idp_name", "urn:roamid:claims:idp_name", "idp_name"],
  ["sub", "urn:roamid:claims:sub", "sub"],
];

function statusXml(code, sub, msg) {
  return `<samlp:Status><samlp:StatusCode Value="${code}">${sub ? `<samlp:StatusCode Value="${sub}"/>` : ""}</samlp:StatusCode>${msg ? `<samlp:StatusMessage>${x(msg)}</samlp:StatusMessage>` : ""}</samlp:Status>`;
}

// A signed Response with a signed Assertion for service provider `sp`.
export function samlResponse(env, key, { sp, acs, inResponseTo, nameId, claims, now, authnInstant }) {
  const rid = samlId(), aid = samlId();
  const irt = inResponseTo ? ` InResponseTo="${x(inResponseTo)}"` : "";
  const exp = samlTime(now + 300);
  const attrs = OUT_ATTRS.filter(([k]) => claims[k] !== undefined && claims[k] !== null).map(([k, name, friendly]) =>
    `<saml:Attribute Name="${name}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" FriendlyName="${friendly}"><saml:AttributeValue>${x(String(claims[k]))}</saml:AttributeValue></saml:Attribute>`).join("");
  const assertion = `<saml:Assertion xmlns:saml="${NS.saml}" ID="${aid}" Version="2.0" IssueInstant="${samlTime(now)}"><saml:Issuer>${x(idpEntityId(env))}</saml:Issuer><saml:Subject><saml:NameID Format="${PERSISTENT}" NameQualifier="${x(idpEntityId(env))}" SPNameQualifier="${x(sp.entity_id)}">${x(nameId)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${irt} NotOnOrAfter="${exp}" Recipient="${x(acs)}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${samlTime(now - 60)}" NotOnOrAfter="${exp}"><saml:AudienceRestriction><saml:Audience>${x(sp.entity_id)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${samlTime(authnInstant || now)}" SessionIndex="${aid}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>${attrs ? `<saml:AttributeStatement>${attrs}</saml:AttributeStatement>` : ""}</saml:Assertion>`;
  const signedAssertion = signElement(assertion, aid, key);
  const response = `<samlp:Response xmlns:samlp="${NS.samlp}" xmlns:saml="${NS.saml}" ID="${rid}" Version="2.0" IssueInstant="${samlTime(now)}" Destination="${x(acs)}"${irt}><saml:Issuer>${x(idpEntityId(env))}</saml:Issuer>${statusXml("urn:oasis:names:tc:SAML:2.0:status:Success")}${signedAssertion.replace(/^<\?xml[^>]*>/, "")}</samlp:Response>`;
  return signElement(response, rid, key);
}

export function samlErrorResponse(env, key, { acs, inResponseTo, status, sub, message, now }) {
  const rid = samlId();
  const irt = inResponseTo ? ` InResponseTo="${x(inResponseTo)}"` : "";
  const xml = `<samlp:Response xmlns:samlp="${NS.samlp}" xmlns:saml="${NS.saml}" ID="${rid}" Version="2.0" IssueInstant="${samlTime(now)}" Destination="${x(acs)}"${irt}><saml:Issuer>${x(idpEntityId(env))}</saml:Issuer>${statusXml(status, sub, message)}</samlp:Response>`;
  return signElement(xml, rid, key);
}

// An identity provider's metadata: entity ID, HTTP-Redirect SSO URL, signing
// certificates, validUntil.
export function parseIdpMetadata(xml) {
  const doc = parseXml(xml);
  let ed = doc.documentElement;
  let validUntil = attr(ed, "validUntil") ? parseTime(attr(ed, "validUntil")) : null;
  if (ed.namespaceURI === NS.md && ed.localName === "EntitiesDescriptor") {
    const eds = descendants(doc, NS.md, "EntityDescriptor");
    if (eds.length !== 1) throw new SamlError("saml_metadata", "metadata must describe exactly one entity");
    ed = eds[0];
    if (attr(ed, "validUntil")) validUntil = Math.min(validUntil || Infinity, parseTime(attr(ed, "validUntil")));
  }
  if (ed.namespaceURI !== NS.md || ed.localName !== "EntityDescriptor") throw new SamlError("saml_metadata", "not SAML metadata");
  const idp = child(ed, NS.md, "IDPSSODescriptor");
  if (!idp) throw new SamlError("saml_metadata", "no IDPSSODescriptor");
  const sso = children(idp, NS.md, "SingleSignOnService").find((s) => attr(s, "Binding") === REDIRECT);
  if (!sso) throw new SamlError("saml_metadata", "no HTTP-Redirect SingleSignOnService");
  const certs = children(idp, NS.md, "KeyDescriptor").filter((k) => !attr(k, "use") || attr(k, "use") === "signing")
    .flatMap((k) => descendants(k, NS.ds, "X509Certificate").map(text)).filter(Boolean);
  if (!certs.length) throw new SamlError("saml_metadata", "no signing certificate");
  return { entity_id: attr(ed, "entityID"), sso_url: attr(sso, "Location"), certs, valid_until: validUntil };
}

export { REDIRECT, POST };
