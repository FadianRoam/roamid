#!/usr/bin/env node
// Generate private JWKs for SIGNING_KEYS (ID tokens: RS256 and ES256) or
// CLIENT_KEYS (RS256 or ES256) and print them as a JSON array. To rotate,
// merge the new key into the existing array (see docs/operations.md) before
// `wrangler secret put`.
//
//   node scripts/keygen.mjs signing            -> [RS256 key, ES256 key]
//   node scripts/keygen.mjs signing RS256|ES256 -> [one key]
//   node scripts/keygen.mjs client [RS256|ES256]
import { webcrypto as crypto } from "node:crypto";

const kind = process.argv[2];
const one = process.argv[3];
if (!["signing", "client"].includes(kind) || (one && !["RS256", "ES256"].includes(one))) {
  console.error("usage: keygen.mjs signing [RS256|ES256] | client [RS256|ES256]");
  process.exit(2);
}
const algs = one ? [one] : kind === "signing" ? ["RS256", "ES256"] : ["RS256"];
const created = new Date().toISOString().slice(0, 10);
const keys = [];
for (const alg of algs) {
  const params = alg === "ES256"
    ? { name: "ECDSA", namedCurve: "P-256" }
    : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const pair = await crypto.subtle.generateKey(params, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const prefix = kind === "client" ? "cli" : alg === "RS256" ? "sig-rs" : "sig";
  const kid = `${prefix}-${created}-${crypto.randomUUID().slice(0, 6)}`;
  delete jwk.key_ops; delete jwk.ext;
  keys.push({ ...jwk, kid, alg, created });
}
process.stdout.write(JSON.stringify(keys) + "\n");
