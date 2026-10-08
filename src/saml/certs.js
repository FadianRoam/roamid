// X.509 certificates and the SAML key pairs of this instance.
//
// SAML_KEYS: JSON array of { kid, cert, key } (PEM; key is PKCS#8). The first
// pair signs (AuthnRequests to identity providers, Responses and Assertions
// to service providers); every certificate is published in both metadata
// documents, for signing and encryption, and every key is tried when an
// EncryptedAssertion arrives. Rotation is the same as for SIGNING_KEYS.

import { X509Certificate } from "node:crypto";

export function toPem(cert) {
  const s = String(cert || "").trim();
  if (s.startsWith("-----BEGIN CERTIFICATE-----")) return s.replace(/\r/g, "") + (s.endsWith("\n") ? "" : "\n");
  const b = s.replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${b.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
}

export const certBody = (pem) => toPem(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");

export function certInfo(pem) {
  const c = new X509Certificate(toPem(pem));
  return { subject: c.subject, notAfter: Math.floor(Date.parse(c.validTo) / 1000), notBefore: Math.floor(Date.parse(c.validFrom) / 1000), fingerprint256: c.fingerprint256 };
}

let memo = null;
export function samlKeys(env) {
  if (memo && memo.raw === env.SAML_KEYS) return memo.value;
  let list;
  try { list = JSON.parse(env.SAML_KEYS || "[]"); } catch { throw new Error("SAML_KEYS is not valid JSON"); }
  if (!Array.isArray(list) || !list.length) throw new Error("SAML_KEYS is empty");
  const value = list.map((k) => ({ kid: k.kid, cert: toPem(k.cert), key: String(k.key).replace(/\r/g, ""), created: k.created || null }));
  memo = { raw: env.SAML_KEYS, value };
  return value;
}

export function pemToDer(pem) {
  const b = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
