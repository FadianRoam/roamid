// Compact JWS for JWTs: ES256 and RS256 signing, and verification against a
// JWK set with an algorithm allow-list. Self-contained, WebCrypto only.

import { b64url, b64urlDecode, utf8, fromUtf8 } from "./b64.js";

const ALGS = {
  RS256: { kty: "RSA", imp: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, sig: { name: "RSASSA-PKCS1-v1_5" } },
  PS256: { kty: "RSA", imp: { name: "RSA-PSS", hash: "SHA-256" }, sig: { name: "RSA-PSS", saltLength: 32 } },
  ES256: { kty: "EC", crv: "P-256", imp: { name: "ECDSA", namedCurve: "P-256" }, sig: { name: "ECDSA", hash: "SHA-256" } },
};

export const SUPPORTED_ALGS = Object.keys(ALGS);

// Only the members that define the key: an `alg`, `use` or `key_ops` in a
// published JWK must not make WebCrypto refuse an otherwise valid key.
function publicPart(jwk) {
  if (jwk.kty === "RSA") return { kty: "RSA", n: jwk.n, e: jwk.e };
  if (jwk.kty === "EC") return { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y };
  throw new Error("unsupported key type");
}

function privatePart(jwk) {
  if (jwk.kty === "RSA") return { kty: "RSA", n: jwk.n, e: jwk.e, d: jwk.d, p: jwk.p, q: jwk.q, dp: jwk.dp, dq: jwk.dq, qi: jwk.qi };
  if (jwk.kty === "EC") return { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d };
  throw new Error("unsupported key type");
}

export function algOf(jwk) {
  if (jwk.alg && ALGS[jwk.alg]) return jwk.alg;
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  if (jwk.kty === "RSA") return "RS256";
  throw new Error("unsupported key");
}

export function publicJwk(jwk) {
  return { ...publicPart(jwk), kid: jwk.kid, alg: algOf(jwk), use: "sig" };
}

const keyCache = new Map();

export async function importPrivate(jwk) {
  const alg = algOf(jwk);
  const k = await crypto.subtle.importKey("jwk", privatePart(jwk), ALGS[alg].imp, false, ["sign"]);
  return { kid: jwk.kid, alg, key: k };
}

export async function sign(payload, signer, header = {}) {
  const h = b64url(JSON.stringify({ alg: signer.alg, typ: "JWT", kid: signer.kid, ...header }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(ALGS[signer.alg].sig, signer.key, utf8(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

export function decode(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  let header, payload;
  try {
    header = JSON.parse(fromUtf8(b64urlDecode(parts[0])));
    payload = JSON.parse(fromUtf8(b64urlDecode(parts[1])));
  } catch { throw new Error("malformed JWT"); }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("malformed JWT");
  return { header, payload, parts };
}

// Verify a JWS against `keys` (JWK array). `algs` is the allow-list; "none"
// and HMAC algorithms are never accepted. Returns { header, payload } or
// throws. `kid` selects the key when present; without a kid every key of the
// right type is tried.
export async function verify(token, keys, algs = ["RS256", "ES256"]) {
  const { header, payload, parts } = decode(token);
  const alg = header.alg;
  if (!algs.includes(alg) || !ALGS[alg]) throw new Error(`algorithm not allowed: ${alg}`);
  if (header.crit !== undefined) throw new Error("unsupported crit header");
  const spec = ALGS[alg];
  const candidates = (keys || []).filter((k) => k && k.kty === spec.kty && (!spec.crv || k.crv === spec.crv)
    && (!header.kid || k.kid === header.kid) && (!k.use || k.use === "sig") && (!k.alg || k.alg === alg));
  if (!candidates.length) { const e = new Error("no matching key"); e.code = "no_key"; throw e; }
  const data = utf8(`${parts[0]}.${parts[1]}`);
  let sig;
  try { sig = b64urlDecode(parts[2]); } catch { throw new Error("malformed signature"); }
  for (const jwk of candidates) {
    const id = `${alg}|${jwk.kid || ""}|${jwk.n || jwk.x}`;
    let key = keyCache.get(id);
    if (!key) {
      try { key = await crypto.subtle.importKey("jwk", publicPart(jwk), spec.imp, false, ["verify"]); } catch { continue; }
      if (keyCache.size > 200) keyCache.clear();
      keyCache.set(id, key);
    }
    if (await crypto.subtle.verify(spec.sig, key, sig, data)) return { header, payload };
  }
  throw new Error("bad signature");
}
