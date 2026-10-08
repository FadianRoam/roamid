#!/usr/bin/env node
// Generate a private JWK for SIGNING_KEYS (ES256) or CLIENT_KEYS (RS256 or
// ES256) and print it as a one-element JSON array. To rotate, merge it into
// the existing array (see docs/operations.md) before `wrangler secret put`.
//
//   node scripts/keygen.mjs signing            -> [ES256 key]
//   node scripts/keygen.mjs client [RS256|ES256]
import { webcrypto as crypto } from "node:crypto";

const kind = process.argv[2];
const alg = kind === "signing" ? "ES256" : (process.argv[3] || "RS256");
if (!["signing", "client"].includes(kind) || !["RS256", "ES256"].includes(alg)) {
  console.error("usage: keygen.mjs signing | client [RS256|ES256]");
  process.exit(2);
}
const params = alg === "ES256"
  ? { name: "ECDSA", namedCurve: "P-256" }
  : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const pair = await crypto.subtle.generateKey(params, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const created = new Date().toISOString().slice(0, 10);
const kid = `${kind === "signing" ? "sig" : "cli"}-${created}-${crypto.randomUUID().slice(0, 6)}`;
delete jwk.key_ops; delete jwk.ext;
process.stdout.write(JSON.stringify([{ ...jwk, kid, alg, created }]) + "\n");
