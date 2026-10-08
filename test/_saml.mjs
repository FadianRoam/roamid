// A mock SAML identity provider and helpers for SAML tests.
import { readFileSync } from "node:fs";
import { publicEncrypt, constants, randomBytes, createCipheriv } from "node:crypto";
import { inflateRawSync, deflateRawSync } from "node:zlib";
import { signElement } from "../src/saml/dsig.js";
import { NS } from "../src/saml/xml.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
export const FX = { idpCert: fx("idp.cert.pem"), idpKey: fx("idp.key.pem"), otherCert: fx("other.cert.pem"), otherKey: fx("other.key.pem"), roamidCert: fx("roamid.cert.pem"), roamidKey: fx("roamid.key.pem"), spCert: fx("sp.cert.pem"), spKey: fx("sp.key.pem") };
export const SAML_KEYS = JSON.stringify([{ kid: "saml-test", cert: FX.roamidCert, key: FX.roamidKey, created: "2026-10-08" }]);
export const IDP_ENTITY = "https://saml-idp.example.test/idp";
export const IDP_SSO = "https://saml-idp.example.test/sso";

export function samlIdpEntry(id = "samlidp", extra = {}) {
  return { id, protocol: "saml2", name: { en: `SAML ${id}` }, homepage: "https://saml-idp.example.test/", contact: { github: "example", email: "ops@example.org" },
    entity_id: IDP_ENTITY, sso_url: IDP_SSO, certs: [FX.idpCert], sub_source: "nameid", email_attribute_verified: true, status: "active", ...extra };
}

export function samlSpEntry(client_id = "sp", extra = {}) {
  return { client_id, protocol: "saml2", name: { en: `SP ${client_id}` }, homepage: "https://sp.example.test/", contact: { github: "example", email: "ops@example.org" },
    entity_id: `https://sp.example.test/${client_id}`, acs_urls: [`https://sp.example.test/${client_id}/acs`], status: "active", ...extra };
}

// Read the AuthnRequest out of an HTTP-Redirect URL.
export function readRedirect(url) {
  const u = new URL(url);
  const xml = inflateRawSync(Buffer.from(u.searchParams.get("SAMLRequest"), "base64")).toString("utf8");
  return { xml, id: /ID="([^"]+)"/.exec(xml)[1], relayState: u.searchParams.get("RelayState"), u };
}
export const redirectRequest = (xml) => encodeURIComponent(deflateRawSync(Buffer.from(xml)).toString("base64"));

const iso = (s) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

// Build a Response. o: { acs, inResponseTo, audience, nameId, nameIdFormat, attrs, notOnOrAfter, signAssertion, signResponse, key, cert, issuer, assertionId, sha1 }
export function buildResponse(o) {
  const t = Math.floor(Date.now() / 1000);
  const aid = o.assertionId || `_a${randomBytes(8).toString("hex")}`;
  const rid = `_r${randomBytes(8).toString("hex")}`;
  const noa = iso(o.notOnOrAfter ?? t + 300);
  const attrs = Object.entries(o.attrs || { "urn:oid:0.9.2342.19200300.100.1.3": "lemon@lab.yunzheng.space", "urn:oid:2.16.840.1.113730.3.1.241": "Lemon" })
    .map(([n, v]) => `<saml:Attribute Name="${n}"><saml:AttributeValue>${v}</saml:AttributeValue></saml:Attribute>`).join("");
  let assertion = `<saml:Assertion xmlns:saml="${NS.saml}" ID="${aid}" Version="2.0" IssueInstant="${iso(t)}"><saml:Issuer>${o.issuer || IDP_ENTITY}</saml:Issuer><saml:Subject><saml:NameID Format="${o.nameIdFormat || "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent"}">${o.nameId ?? "user-42"}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${o.inResponseTo}" NotOnOrAfter="${noa}" Recipient="${o.recipient || o.acs}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(t - 60)}" NotOnOrAfter="${noa}"><saml:AudienceRestriction><saml:Audience>${o.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(t)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attrs}</saml:AttributeStatement></saml:Assertion>`;
  const key = { key: o.key || FX.idpKey, cert: o.cert || FX.idpCert };
  if (o.signAssertion !== false) assertion = signElement(assertion, aid, key);
  if (o.sha1) assertion = assertion.replace("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", "http://www.w3.org/2000/09/xmldsig#rsa-sha1");
  if (o.encryptTo) assertion = encryptAssertion(assertion, o.encryptTo, o.encMode || "gcm");
  if (o.mutateAssertion) assertion = o.mutateAssertion(assertion);
  let response = `<samlp:Response xmlns:samlp="${NS.samlp}" xmlns:saml="${NS.saml}" ID="${rid}" Version="2.0" IssueInstant="${iso(t)}" Destination="${o.destination || o.acs}" InResponseTo="${o.inResponseTo}"><saml:Issuer>${o.issuer || IDP_ENTITY}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${o.status || "urn:oasis:names:tc:SAML:2.0:status:Success"}"/></samlp:Status>${assertion.replace(/^<\?xml[^>]*>/, "")}</samlp:Response>`;
  if (o.signResponse) response = signElement(response, rid, key);
  if (o.mutate) response = o.mutate(response);
  return { xml: response, b64: Buffer.from(response).toString("base64"), aid, rid };
}

// EncryptedAssertion: RSA-OAEP (mgf1p, SHA-1) + AES-256-GCM or AES-256-CBC.
export function encryptAssertion(assertionXml, certPem, mode = "gcm") {
  const k = randomBytes(32);
  let data, alg;
  if (mode === "gcm") {
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", k, iv);
    data = Buffer.concat([iv, c.update(assertionXml, "utf8"), c.final(), c.getAuthTag()]); alg = "http://www.w3.org/2009/xmlenc11#aes256-gcm";
  } else {
    const iv = randomBytes(16); const c = createCipheriv("aes-256-cbc", k, iv); c.setAutoPadding(false);
    const pt = Buffer.from(assertionXml, "utf8"); const n = 16 - (pt.length % 16);
    const padded = Buffer.concat([pt, randomBytes(n - 1), Buffer.from([n])]); // ISO 10126
    data = Buffer.concat([iv, c.update(padded), c.final()]); alg = "http://www.w3.org/2001/04/xmlenc#aes256-cbc";
  }
  const ek = publicEncrypt({ key: certPem, padding: constants.RSA_PKCS1_OAEP_PADDING }, k);
  return `<saml:EncryptedAssertion xmlns:saml="${NS.saml}"><xenc:EncryptedData xmlns:xenc="${NS.xenc}" Type="http://www.w3.org/2001/04/xmlenc#Element"><xenc:EncryptionMethod Algorithm="${alg}"/><ds:KeyInfo xmlns:ds="${NS.ds}"><xenc:EncryptedKey><xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"><ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/></xenc:EncryptionMethod><xenc:CipherData><xenc:CipherValue>${ek.toString("base64")}</xenc:CipherValue></xenc:CipherData></xenc:EncryptedKey></ds:KeyInfo><xenc:CipherData><xenc:CipherValue>${data.toString("base64")}</xenc:CipherValue></xenc:CipherData></xenc:EncryptedData></saml:EncryptedAssertion>`;
}

// Pull SAMLResponse / RelayState / action out of RoamID's auto-post page.
export function readPostPage(html) {
  const action = /<form method="post" action="([^"]+)"/.exec(html);
  const field = (n) => { const m = new RegExp(`name="${n}" value="([^"]*)"`).exec(html); return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null; };
  return { action: action && action[1].replace(/&amp;/g, "&"), response: field("SAMLResponse"), relayState: field("RelayState") };
}
