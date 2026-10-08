// EncryptedAssertion decryption with WebCrypto.
// Key transport: RSA-OAEP (xmlenc#rsa-oaep-mgf1p, or xmlenc11#rsa-oaep with
// the same digest for OAEP and MGF1). RSA PKCS#1 v1.5 is refused.
// Content: AES-128/256-GCM (xmlenc11), AES-128/256-CBC (xmlenc).

import { NS, SamlError, child, descendants, attr, text, b64decode } from "./xml.js";
import { pemToDer } from "./certs.js";

const CONTENT = {
  "http://www.w3.org/2009/xmlenc11#aes128-gcm": "gcm", "http://www.w3.org/2009/xmlenc11#aes256-gcm": "gcm",
  "http://www.w3.org/2001/04/xmlenc#aes128-cbc": "cbc", "http://www.w3.org/2001/04/xmlenc#aes256-cbc": "cbc",
};
const OAEP_HASH = { "http://www.w3.org/2000/09/xmldsig#sha1": "SHA-1", "http://www.w3.org/2001/04/xmlenc#sha256": "SHA-256", "http://www.w3.org/2001/04/xmlenc#sha512": "SHA-512" };
const MGF_HASH = { "http://www.w3.org/2009/xmlenc11#mgf1sha1": "SHA-1", "http://www.w3.org/2009/xmlenc11#mgf1sha256": "SHA-256", "http://www.w3.org/2009/xmlenc11#mgf1sha512": "SHA-512" };

function oaepHash(em) {
  const alg = attr(em, "Algorithm");
  const dm = attr(child(em, NS.ds, "DigestMethod"), "Algorithm") || "http://www.w3.org/2000/09/xmldsig#sha1";
  if (alg === "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p") {
    if (OAEP_HASH[dm] !== "SHA-1") throw new SamlError("saml_algorithm", "rsa-oaep-mgf1p requires SHA-1 digest");
    return "SHA-1";
  }
  if (alg === "http://www.w3.org/2009/xmlenc11#rsa-oaep") {
    const mgf = attr(child(em, NS.xenc11, "MGF"), "Algorithm") || "http://www.w3.org/2009/xmlenc11#mgf1sha1";
    const h = OAEP_HASH[dm];
    if (!h || MGF_HASH[mgf] !== h) throw new SamlError("saml_algorithm", "RSA-OAEP digest and MGF1 hash must be the same");
    return h;
  }
  throw new SamlError("saml_algorithm", `key transport not allowed: ${alg}`);
}

async function unwrapKey(encKeyEl, keys) {
  const em = child(encKeyEl, NS.xenc, "EncryptionMethod");
  const hash = oaepHash(em);
  const cv = b64decode(text(child(child(encKeyEl, NS.xenc, "CipherData"), NS.xenc, "CipherValue")));
  for (const k of keys) {
    try {
      const priv = await crypto.subtle.importKey("pkcs8", pemToDer(k.key), { name: "RSA-OAEP", hash }, false, ["decrypt"]);
      return new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, cv));
    } catch { /* try the next key */ }
  }
  throw new SamlError("saml_decrypt_failed", "no key of this instance decrypts the assertion key");
}

// AES-CBC with XML Encryption's ISO 10126 padding: WebCrypto only removes
// PKCS#7 padding, so one extra block that decrypts to a full PKCS#7 block is
// appended, and the XML padding is removed afterwards.
async function cbcDecrypt(keyBytes, data) {
  if (data.length < 32 || data.length % 16) throw new SamlError("saml_decrypt_failed", "bad AES-CBC data");
  const iv = data.subarray(0, 16), ct = data.subarray(16);
  const k = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt", "decrypt"]);
  const extra = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: ct.subarray(ct.length - 16) }, k, new Uint8Array(16).fill(16))).subarray(0, 16);
  const full = new Uint8Array(ct.length + 16); full.set(ct); full.set(extra, ct.length);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, k, full));
  const n = pt[pt.length - 1];
  if (n < 1 || n > 16) throw new SamlError("saml_decrypt_failed", "bad padding");
  return pt.subarray(0, pt.length - n);
}

async function gcmDecrypt(keyBytes, data) {
  if (data.length < 12 + 16) throw new SamlError("saml_decrypt_failed", "bad AES-GCM data");
  const k = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12), tagLength: 128 }, k, data.subarray(12)));
}

// Returns the decrypted saml:Assertion XML string.
export async function decryptAssertion(encAssertionEl, keys) {
  const ed = child(encAssertionEl, NS.xenc, "EncryptedData");
  if (!ed) throw new SamlError("saml_decrypt_failed", "no EncryptedData");
  const mode = CONTENT[attr(child(ed, NS.xenc, "EncryptionMethod"), "Algorithm")];
  if (!mode) throw new SamlError("saml_algorithm", "content encryption algorithm not allowed");
  const encKeys = descendants(encAssertionEl, NS.xenc, "EncryptedKey");
  if (encKeys.length !== 1) throw new SamlError("saml_decrypt_failed", "expected exactly one EncryptedKey");
  const keyBytes = await unwrapKey(encKeys[0], keys);
  if (![16, 32].includes(keyBytes.length)) throw new SamlError("saml_decrypt_failed", "bad content key length");
  const data = b64decode(text(child(child(ed, NS.xenc, "CipherData"), NS.xenc, "CipherValue")));
  let pt;
  try { pt = mode === "gcm" ? await gcmDecrypt(keyBytes, data) : await cbcDecrypt(keyBytes, data); } catch (e) {
    if (e instanceof SamlError) throw e;
    throw new SamlError("saml_decrypt_failed", "decryption failed");
  }
  return new TextDecoder().decode(pt);
}
