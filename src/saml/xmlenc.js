// EncryptedAssertion decryption with WebCrypto.
// Key transport: RSA-OAEP (xmlenc#rsa-oaep-mgf1p, or xmlenc11#rsa-oaep with
// the same digest for OAEP and MGF1). RSA PKCS#1 v1.5 is refused.
// Content: AES-128/256-GCM (xmlenc11). AES-128/256-CBC (xmlenc) only when the
// caller has already verified a signature over the EncryptedAssertion (the
// outer Response): unauthenticated CBC is a padding / format oracle
// (Jager and Somorovsky, "How to break XML encryption", 2011).
//
// Failures inside this module are not told apart to the caller: every one is
// a DecryptFailure with a short internal reason for the server log. The
// caller turns it, and any failure to parse the plaintext, into one external
// error (response.js).

import { NS, child, descendants, attr, text, b64decode } from "./xml.js";
import { pemToDer } from "./certs.js";

const CONTENT = {
  "http://www.w3.org/2009/xmlenc11#aes128-gcm": "gcm", "http://www.w3.org/2009/xmlenc11#aes256-gcm": "gcm",
  "http://www.w3.org/2001/04/xmlenc#aes128-cbc": "cbc", "http://www.w3.org/2001/04/xmlenc#aes256-cbc": "cbc",
};
const OAEP_HASH = { "http://www.w3.org/2000/09/xmldsig#sha1": "SHA-1", "http://www.w3.org/2001/04/xmlenc#sha256": "SHA-256", "http://www.w3.org/2001/04/xmlenc#sha512": "SHA-512" };
const MGF_HASH = { "http://www.w3.org/2009/xmlenc11#mgf1sha1": "SHA-1", "http://www.w3.org/2009/xmlenc11#mgf1sha256": "SHA-256", "http://www.w3.org/2009/xmlenc11#mgf1sha512": "SHA-512" };

export class DecryptFailure extends Error {
  constructor(reason) { super("decryption failed"); this.reason = reason; }
}

// Calls of decryptAssertion, for tests that must show it did not run.
export const decryptStats = { calls: 0 };

// "gcm", "cbc" or null: the content encryption mode an EncryptedAssertion
// declares. Read before decrypting, from structure only.
export function contentMode(encAssertionEl) {
  const ed = child(encAssertionEl, NS.xenc, "EncryptedData");
  return (ed && CONTENT[attr(child(ed, NS.xenc, "EncryptionMethod"), "Algorithm")]) || null;
}

function oaepHash(em) {
  const alg = attr(em, "Algorithm");
  const dm = attr(child(em, NS.ds, "DigestMethod"), "Algorithm") || "http://www.w3.org/2000/09/xmldsig#sha1";
  if (alg === "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p") {
    if (OAEP_HASH[dm] !== "SHA-1") throw new DecryptFailure("rsa-oaep-mgf1p digest");
    return "SHA-1";
  }
  if (alg === "http://www.w3.org/2009/xmlenc11#rsa-oaep") {
    const mgf = attr(child(em, NS.xenc11, "MGF"), "Algorithm") || "http://www.w3.org/2009/xmlenc11#mgf1sha1";
    const h = OAEP_HASH[dm];
    if (!h || MGF_HASH[mgf] !== h) throw new DecryptFailure("rsa-oaep digest/mgf");
    return h;
  }
  throw new DecryptFailure("key transport algorithm");
}

const b64 = (s) => { try { return b64decode(s); } catch { throw new DecryptFailure("base64"); } };

// The content key, or null when no key of this instance unwraps it.
async function unwrapKey(encKeyEl, keys) {
  const hash = oaepHash(child(encKeyEl, NS.xenc, "EncryptionMethod"));
  const cv = b64(text(child(child(encKeyEl, NS.xenc, "CipherData"), NS.xenc, "CipherValue")));
  for (const k of keys) {
    try {
      const priv = await crypto.subtle.importKey("pkcs8", pemToDer(k.key), { name: "RSA-OAEP", hash }, false, ["decrypt"]);
      return new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, cv));
    } catch { /* try the next key */ }
  }
  return null;
}

// AES-CBC with XML Encryption's ISO 10126 padding: WebCrypto only removes
// PKCS#7 padding, so one extra block that decrypts to a full PKCS#7 block is
// appended, and the XML padding is removed afterwards.
async function cbcDecrypt(keyBytes, data) {
  if (data.length < 32 || data.length % 16) throw new DecryptFailure("cbc length");
  const iv = data.subarray(0, 16), ct = data.subarray(16);
  const k = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt", "decrypt"]);
  const extra = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: ct.subarray(ct.length - 16) }, k, new Uint8Array(16).fill(16))).subarray(0, 16);
  const full = new Uint8Array(ct.length + 16); full.set(ct); full.set(extra, ct.length);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, k, full));
  const n = pt[pt.length - 1];
  if (n < 1 || n > 16) throw new DecryptFailure("cbc padding");
  return pt.subarray(0, pt.length - n);
}

async function gcmDecrypt(keyBytes, data) {
  if (data.length < 12 + 16) throw new DecryptFailure("gcm length");
  const k = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12), tagLength: 128 }, k, data.subarray(12)));
  } catch { throw new DecryptFailure("gcm tag"); }
}

// The plaintext bytes of an EncryptedAssertion. Throws DecryptFailure only.
// `allowCbc` is true only when a signature over the EncryptedAssertion has
// already been verified.
export async function decryptAssertion(encAssertionEl, keys, { allowCbc = false } = {}) {
  decryptStats.calls++;
  try {
    const ed = child(encAssertionEl, NS.xenc, "EncryptedData");
    if (!ed) throw new DecryptFailure("no EncryptedData");
    const mode = contentMode(encAssertionEl);
    if (!mode) throw new DecryptFailure("content algorithm");
    if (mode === "cbc" && !allowCbc) throw new DecryptFailure("cbc without a verified signature");
    const encKeys = descendants(encAssertionEl, NS.xenc, "EncryptedKey");
    if (encKeys.length !== 1) throw new DecryptFailure("EncryptedKey count");
    let keyBytes = await unwrapKey(encKeys[0], keys);
    let reason = null;
    // A key that does not unwrap, or has the wrong length, is replaced by a
    // random one and decryption goes on, so the outcome is the same as for a
    // bad ciphertext.
    if (!keyBytes) { reason = "key unwrap"; keyBytes = crypto.getRandomValues(new Uint8Array(32)); }
    else if (![16, 32].includes(keyBytes.length)) { reason = "content key length"; keyBytes = crypto.getRandomValues(new Uint8Array(32)); }
    const data = b64(text(child(child(ed, NS.xenc, "CipherData"), NS.xenc, "CipherValue")));
    let pt;
    try { pt = mode === "gcm" ? await gcmDecrypt(keyBytes, data) : await cbcDecrypt(keyBytes, data); } catch (e) {
      throw e instanceof DecryptFailure ? new DecryptFailure(reason || e.reason) : new DecryptFailure(reason || "decrypt");
    }
    if (reason) throw new DecryptFailure(reason);
    return pt;
  } catch (e) {
    throw e instanceof DecryptFailure ? e : new DecryptFailure("unexpected");
  }
}
