// XML signature verification and signing (xml-crypto), restricted to an
// algorithm allow-list. Verification returns the canonical XML of the signed
// element; callers parse and use only that string, never nodes of the
// original document (signature wrapping defence).

import { SignedXml } from "xml-crypto";
import crypto from "node:crypto";
import { NS, SamlError, children, child, attr, descendants } from "./xml.js";

const ALG = {
  rsa256: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  rsa512: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512",
  ec256: "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256",
  ec384: "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384",
  ec512: "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512",
  sha256: "http://www.w3.org/2001/04/xmlenc#sha256",
  sha512: "http://www.w3.org/2001/04/xmlenc#sha512",
  exc: "http://www.w3.org/2001/10/xml-exc-c14n#",
  c14n: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  env: "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
};
export { ALG };
const SIG_OK = new Set([ALG.rsa256, ALG.rsa512, ALG.ec256, ALG.ec384, ALG.ec512]);
const DIGEST_OK = new Set([ALG.sha256, ALG.sha512]);
const C14N_OK = new Set([ALG.exc, ALG.c14n]);
const TRANSFORM_OK = new Set([ALG.env, ALG.exc, ALG.c14n]);

// ECDSA for XML-DSig: the signature value is r||s (RFC 4050 / P1363).
class Ecdsa {
  constructor(hash, uri) { this.hash = hash; this.uri = uri; }
  getAlgorithmName() { return this.uri; }
  verifySignature(signedInfo, key, value) {
    return crypto.verify(this.hash, Buffer.from(signedInfo), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(value, "base64"));
  }
  getSignature() { throw new Error("ECDSA signing is not used"); }
}

function restrict(sx) {
  for (const k of Object.keys(sx.SignatureAlgorithms)) if (!SIG_OK.has(k)) delete sx.SignatureAlgorithms[k];
  sx.SignatureAlgorithms[ALG.ec256] = Ecdsa.bind(null, "sha256", ALG.ec256);
  sx.SignatureAlgorithms[ALG.ec384] = Ecdsa.bind(null, "sha384", ALG.ec384);
  sx.SignatureAlgorithms[ALG.ec512] = Ecdsa.bind(null, "sha512", ALG.ec512);
  for (const k of Object.keys(sx.HashAlgorithms)) if (!DIGEST_OK.has(k)) delete sx.HashAlgorithms[k];
  for (const k of Object.keys(sx.CanonicalizationAlgorithms)) if (!TRANSFORM_OK.has(k)) delete sx.CanonicalizationAlgorithms[k];
  return sx;
}

// Every ID / Id / AssertionID in the document must be unique.
export function assertUniqueIds(doc) {
  const seen = new Set();
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    for (const a of ["ID", "Id", "AssertionID"]) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      if (seen.has(v)) throw new SamlError("saml_signature_invalid", "duplicate ID in the document");
      seen.add(v);
    }
  }
}

// The one ds:Signature that is a direct child of `el`, or null.
export function signatureOf(el) {
  const sigs = children(el, NS.ds, "Signature");
  if (sigs.length > 1) throw new SamlError("saml_signature_invalid", "more than one signature on an element");
  return sigs[0] || null;
}

// Verify the enveloped signature of `el` (a direct child ds:Signature whose
// only Reference is "#<el ID>") against `certs` (PEM). `docXml` is the
// serialized document `el` belongs to. Returns the canonical XML of `el` as
// signed.
export function verifyElement(el, docXml, certs) {
  const sig = signatureOf(el);
  if (!sig) throw new SamlError("saml_unsigned", "the element is not signed");
  const id = attr(el, "ID");
  if (!id) throw new SamlError("saml_signature_invalid", "the signed element has no ID");
  const si = child(sig, NS.ds, "SignedInfo");
  const refs = si ? children(si, NS.ds, "Reference") : [];
  if (refs.length !== 1 || attr(refs[0], "URI") !== `#${id}`) throw new SamlError("saml_signature_invalid", "the signature must have one Reference to the element itself");
  const sm = attr(child(si, NS.ds, "SignatureMethod"), "Algorithm");
  const cm = attr(child(si, NS.ds, "CanonicalizationMethod"), "Algorithm");
  const dm = attr(child(refs[0], NS.ds, "DigestMethod"), "Algorithm");
  const tf = descendants(refs[0], NS.ds, "Transform").map((t) => attr(t, "Algorithm"));
  if (!SIG_OK.has(sm)) throw new SamlError("saml_algorithm", `signature algorithm not allowed: ${sm}`);
  if (!C14N_OK.has(cm)) throw new SamlError("saml_algorithm", `canonicalization not allowed: ${cm}`);
  if (!DIGEST_OK.has(dm)) throw new SamlError("saml_algorithm", `digest not allowed: ${dm}`);
  if (tf.some((a) => !TRANSFORM_OK.has(a))) throw new SamlError("saml_algorithm", "transform not allowed");
  for (const cert of certs) {
    const sx = restrict(new SignedXml({ publicCert: cert, getCertFromKeyInfo: () => null }));
    sx.loadSignature(sig);
    let ok = false;
    try { ok = sx.checkSignature(docXml); } catch (e) {
      if (/multiple elements with the same/i.test(String(e.message))) throw new SamlError("saml_signature_invalid", "duplicate ID");
      ok = false;
    }
    if (ok) {
      const signed = sx.getSignedReferences();
      if (signed.length !== 1) throw new SamlError("saml_signature_invalid", "unexpected signed references");
      return signed[0];
    }
  }
  throw new SamlError("saml_signature_invalid", "the signature does not verify with the provider's certificates");
}

// Sign `xml` with an enveloped signature on the element with ID `id`,
// inserted after its saml:Issuer. RSA-SHA256, exclusive c14n.
export function signElement(xml, id, { key, cert }) {
  const sx = new SignedXml({ privateKey: key, publicCert: cert, canonicalizationAlgorithm: ALG.exc, signatureAlgorithm: ALG.rsa256 });
  sx.addReference({ xpath: `//*[@ID='${id}']`, digestAlgorithm: ALG.sha256, transforms: [ALG.env, ALG.exc] });
  sx.computeSignature(xml, { prefix: "ds", location: { reference: `//*[@ID='${id}']/*[local-name()='Issuer']`, action: "after" } });
  return sx.getSignedXml();
}

// HTTP-Redirect binding signature (SAML Bindings 3.4.4.1) over the exact
// query octets "SAMLRequest=..&RelayState=..&SigAlg=..".
export function signRedirect(octets, key) {
  return crypto.sign("sha256", Buffer.from(octets), key).toString("base64");
}
export function verifyRedirect(octets, sigB64, sigAlg, certs) {
  const hash = { [ALG.rsa256]: "sha256", [ALG.rsa512]: "sha512" }[sigAlg];
  if (!hash) throw new SamlError("saml_algorithm", `signature algorithm not allowed: ${sigAlg}`);
  const sig = Buffer.from(String(sigB64 || ""), "base64");
  return certs.some((c) => { try { return crypto.verify(hash, Buffer.from(octets), c, sig); } catch { return false; } });
}
