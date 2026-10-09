// Keys from Worker secrets.
//
// SIGNING_KEYS: JSON array of private JWKs (RS256 and ES256), each with a kid.
//   The first key of each algorithm signs the ID tokens of that algorithm
//   (RS256 by default, ES256 for clients that ask for it); every key is
//   published at /jwks.json.
// CLIENT_KEYS:  the same shape (RS256 or ES256). The first key signs
//   private_key_jwt assertions to upstream identity providers; every key is
//   published at /client-jwks.json.
//
// Rotation (per algorithm): append the new key (published, not yet used) ->
// wait at least a day so caches see it -> move it before the old key of the
// same algorithm -> after the old key's last token has expired, remove it.

import { importPrivate, publicJwk, algOf } from "./jwt.js";

const memo = new Map();

function parseKeys(raw, name) {
  let list;
  try { list = JSON.parse(raw || "[]"); } catch { throw new Error(`${name} is not valid JSON`); }
  if (!Array.isArray(list) || !list.length) throw new Error(`${name} is empty`);
  for (const k of list) if (!k || !k.kid || !k.d) throw new Error(`${name}: every key needs kid and private members`);
  return list;
}

async function load(env, name) {
  const raw = env[name];
  const hit = memo.get(name);
  if (hit && hit.raw === raw) return hit.value;
  const list = parseKeys(raw, name);
  // The first key of each algorithm; `signer` (the first key overall) is used
  // where any algorithm will do (private_key_jwt assertions).
  const signers = {};
  for (const k of list) { const a = algOf(k); if (!signers[a]) signers[a] = await importPrivate(k); }
  const value = { signer: signers[algOf(list[0])], signers, jwks: { keys: list.map(publicJwk) } };
  memo.set(name, { raw, value });
  return value;
}

export const signingKeys = (env) => load(env, "SIGNING_KEYS");

// ID token algorithms: RS256 is the default (OpenID Connect Core 15.1);
// a client may ask for ES256 with id_token_signed_response_alg.
export const ID_TOKEN_ALGS = ["RS256", "ES256"];
export const DEFAULT_ID_TOKEN_ALG = "RS256";

// The key that signs a client's ID tokens. Throws when the client asks for an
// algorithm RoamID does not offer or SIGNING_KEYS has no key for it.
export async function idTokenSigner(env, client) {
  const alg = (client && client.id_token_signed_response_alg) || DEFAULT_ID_TOKEN_ALG;
  if (!ID_TOKEN_ALGS.includes(alg)) throw new Error(`unsupported id_token_signed_response_alg ${alg}`);
  const s = (await signingKeys(env)).signers[alg];
  if (!s) throw new Error(`SIGNING_KEYS has no ${alg} key`);
  return s;
}
export const clientKeys = (env) => load(env, "CLIENT_KEYS");
