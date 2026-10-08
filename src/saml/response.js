// Verification of a SAML Response from a community identity provider
// (RoamID as service provider). Every check of the design's SAML section:
//   - no DTD / entities (parseXml), unique IDs, exactly one Assertion or
//     EncryptedAssertion and it is a direct child of the Response;
//   - a signed Response or a signed Assertion, verified against the
//     provider's certificates only, with an algorithm allow-list; the
//     assertion that is used is parsed from the signed canonical XML;
//   - Destination, Recipient, InResponseTo (bound to the transaction),
//     Issuer, Audience, NotBefore / NotOnOrAfter with a small skew, Status;
//   - the Assertion ID is single use (the caller records it).

import { NS, SamlError, parseXml, serialize, child, children, descendants, attr, text, parseTime } from "./xml.js";
import { verifyElement, assertUniqueIds, signatureOf } from "./dsig.js";
import { decryptAssertion, contentMode, DecryptFailure } from "./xmlenc.js";

export const SKEW = 120;
const BEARER = "urn:oasis:names:tc:SAML:2.0:cm:bearer";
const SUCCESS = "urn:oasis:names:tc:SAML:2.0:status:Success";
export const PERSISTENT = "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent";
export const TRANSIENT = "urn:oasis:names:tc:SAML:2.0:nameid-format:transient";

function one(list, what) {
  if (list.length !== 1) throw new SamlError("saml_invalid", `expected exactly one ${what}, found ${list.length}`);
  return list[0];
}

export const INVALID_RESPONSE = "the response cannot be processed";
const PLACEHOLDER = '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"/>';

// Decrypt and parse an EncryptedAssertion. Every failure on the way (key
// unwrap, decryption, padding, UTF-8, XML parsing, the root element, nested
// assertions) gives the same SamlError: same code, same message. The reason
// goes to the server log only, without plaintext or parser messages, and the
// parse step runs even when decryption failed (on a fixed placeholder), so
// there is no early return to time.
async function openEncryptedAssertion(encEl, keys, allowCbc) {
  let reason = null, bytes = null;
  try { bytes = await decryptAssertion(encEl, keys, { allowCbc }); } catch (e) { reason = e instanceof DecryptFailure ? e.reason : "decrypt"; }
  let aDoc = null, aXml = PLACEHOLDER;
  try {
    if (bytes) aXml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { reason = reason || "utf-8"; aXml = PLACEHOLDER; }
  try {
    const d = parseXml(aXml);
    const root = d.documentElement;
    if (root.namespaceURI !== NS.saml || root.localName !== "Assertion") reason = reason || "not an Assertion";
    else if (descendants(d, NS.saml, "Assertion").length !== 1) reason = reason || "nested assertions";
    aDoc = d;
  } catch { reason = reason || "plaintext parse"; }
  if (reason) {
    console.warn("[saml] encrypted assertion refused:", reason);
    throw new SamlError("saml_invalid_response", INVALID_RESPONSE);
  }
  return { aDoc, aXml };
}

// `expected`: { acs, spEntityId, idpEntityId, requestId, certs, keys, now }
export async function verifyResponse(xml, expected) {
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const doc = parseXml(xml);
  const resp = doc.documentElement;
  if (resp.namespaceURI !== NS.samlp || resp.localName !== "Response") throw new SamlError("saml_invalid", "not a SAML Response");
  assertUniqueIds(doc);
  const all = descendants(doc, NS.saml, "Assertion").length + descendants(doc, NS.saml, "EncryptedAssertion").length;
  if (all !== 1) throw new SamlError("saml_invalid", `expected exactly one assertion in the document, found ${all}`);

  // Status, Destination, InResponseTo, Issuer of the Response (read from the
  // signed copy when the Response is signed).
  let r = resp;
  if (signatureOf(resp)) r = parseXml(verifyElement(resp, xml, expected.certs)).documentElement;
  const respSigned = r !== resp;
  const st = attr(child(child(r, NS.samlp, "Status"), NS.samlp, "StatusCode"), "Value");
  if (st !== SUCCESS) {
    const sub = attr(child(child(child(r, NS.samlp, "Status"), NS.samlp, "StatusCode"), NS.samlp, "StatusCode"), "Value");
    throw new SamlError("saml_status", `status ${st}${sub ? ` / ${sub}` : ""}`);
  }
  if (attr(r, "Destination") !== expected.acs) throw new SamlError("saml_invalid", "Destination is not this ACS URL");
  if (attr(r, "InResponseTo") !== expected.requestId) throw new SamlError("saml_invalid", "InResponseTo does not match the request");
  const ri = child(r, NS.saml, "Issuer");
  if (ri && text(ri) !== expected.idpEntityId) throw new SamlError("saml_invalid", "Response Issuer is not the registered entity ID");

  // The assertion: a direct child of the (signed) Response.
  const plain = children(r, NS.saml, "Assertion"), enc = children(r, NS.saml, "EncryptedAssertion");
  if (plain.length + enc.length !== 1) throw new SamlError("saml_invalid", "the assertion must be a direct child of the Response");
  let aDoc, aXml;
  if (enc.length) {
    // AES-CBC only inside a Response whose signature was verified above;
    // refused here, before anything is decrypted.
    if (contentMode(enc[0]) === "cbc" && !respSigned) throw new SamlError("saml_algorithm", "AES-CBC encryption is accepted only in a signed Response; use AES-GCM");
    ({ aDoc, aXml } = await openEncryptedAssertion(enc[0], expected.keys, respSigned));
  } else {
    aXml = serialize(r.ownerDocument === doc ? doc : r.ownerDocument);
    aDoc = r.ownerDocument;
  }
  let a = enc.length ? aDoc.documentElement : plain[0];
  if (!enc.length && descendants(aDoc, NS.saml, "Assertion").length !== 1) throw new SamlError("saml_invalid", "nested assertions");
  if (signatureOf(a)) {
    if (enc.length) assertUniqueIds(aDoc);
    a = parseXml(verifyElement(a, enc.length ? aXml : (respSigned ? serialize(r.ownerDocument) : xml), expected.certs)).documentElement;
  } else if (!respSigned) {
    throw new SamlError("saml_unsigned", "neither the Response nor the Assertion is signed");
  }

  // Assertion checks.
  const id = attr(a, "ID");
  if (!id) throw new SamlError("saml_invalid", "the assertion has no ID");
  if (text(child(a, NS.saml, "Issuer")) !== expected.idpEntityId) throw new SamlError("saml_invalid", "Assertion Issuer is not the registered entity ID");
  const subject = child(a, NS.saml, "Subject");
  if (!subject) throw new SamlError("saml_invalid", "no Subject");
  const scs = children(subject, NS.saml, "SubjectConfirmation").filter((sc) => attr(sc, "Method") === BEARER);
  const scd = one(scs, "bearer SubjectConfirmation") && child(scs[0], NS.saml, "SubjectConfirmationData");
  if (!scd) throw new SamlError("saml_invalid", "no SubjectConfirmationData");
  if (attr(scd, "Recipient") !== expected.acs) throw new SamlError("saml_invalid", "Recipient is not this ACS URL");
  if (attr(scd, "InResponseTo") !== expected.requestId) throw new SamlError("saml_invalid", "SubjectConfirmationData InResponseTo does not match");
  const scdNoa = parseTime(attr(scd, "NotOnOrAfter"));
  if (!scdNoa || scdNoa + SKEW <= now) throw new SamlError("saml_expired", "the subject confirmation has expired");
  if (attr(scd, "NotBefore")) { const nb = parseTime(attr(scd, "NotBefore")); if (!nb || nb - SKEW > now) throw new SamlError("saml_expired", "the subject confirmation is not yet valid"); }
  const cond = child(a, NS.saml, "Conditions");
  if (!cond) throw new SamlError("saml_invalid", "no Conditions");
  const nb = attr(cond, "NotBefore") ? parseTime(attr(cond, "NotBefore")) : null;
  const noa = attr(cond, "NotOnOrAfter") ? parseTime(attr(cond, "NotOnOrAfter")) : null;
  if ((attr(cond, "NotBefore") && !nb) || (nb && nb - SKEW > now)) throw new SamlError("saml_expired", "the assertion is not yet valid");
  if ((attr(cond, "NotOnOrAfter") && !noa) || (noa && noa + SKEW <= now)) throw new SamlError("saml_expired", "the assertion has expired");
  const ars = children(cond, NS.saml, "AudienceRestriction");
  if (!ars.length || !ars.every((ar) => children(ar, NS.saml, "Audience").some((au) => text(au) === expected.spEntityId))) throw new SamlError("saml_invalid", "Audience is not this service provider");

  const nameIdEl = child(subject, NS.saml, "NameID");
  if (child(subject, NS.saml, "EncryptedID")) throw new SamlError("saml_invalid", "encrypted NameID is not supported");
  const attributes = [];
  for (const as of children(a, NS.saml, "AttributeStatement")) {
    for (const at of children(as, NS.saml, "Attribute")) {
      attributes.push({ name: attr(at, "Name"), friendly: attr(at, "FriendlyName"), values: children(at, NS.saml, "AttributeValue").map(text) });
    }
  }
  const authn = child(a, NS.saml, "AuthnStatement");
  return {
    assertionId: id,
    notOnOrAfter: Math.max(scdNoa, noa || 0),
    nameId: nameIdEl ? text(nameIdEl) : null,
    nameIdFormat: nameIdEl ? attr(nameIdEl, "Format") : null,
    attributes,
    authnInstant: authn ? parseTime(attr(authn, "AuthnInstant")) : null,
    authnContext: authn ? text(child(child(authn, NS.saml, "AuthnContext"), NS.saml, "AuthnContextClassRef")) || null : null,
  };
}

// Attribute names understood without configuration, per normalized claim.
export const DEFAULT_ATTRS = {
  email: ["urn:oid:0.9.2342.19200300.100.1.3", "mail", "email", "emailAddress", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
  name: ["urn:oid:2.16.840.1.113730.3.1.241", "displayName", "urn:oid:2.5.4.3", "cn", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"],
  preferred_username: ["urn:oid:0.9.2342.19200300.100.1.1", "uid", "username", "urn:oid:1.3.6.1.4.1.5923.1.1.1.6", "eduPersonPrincipalName"],
};

export function attrValue(attributes, names) {
  for (const n of names) {
    const a = attributes.find((x) => x.name === n || x.friendly === n);
    if (a && a.values.length && a.values[0]) return a.values[0];
  }
  return undefined;
}
