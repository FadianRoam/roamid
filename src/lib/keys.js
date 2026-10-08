// Keys from Worker secrets.
//
// SIGNING_KEYS: JSON array of private JWKs (ES256), each with a kid. The first
//   key signs ID tokens; every key is published at /jwks.json.
// CLIENT_KEYS:  the same shape (RS256 or ES256). The first key signs
//   private_key_jwt assertions to upstream identity providers; every key is
//   published at /client-jwks.json.
//
// Rotation: append the new key (published, not yet used) -> wait at least a
// day so caches see it -> move it to the front -> after the old key's last
// token has expired, remove the old key.

import { importPrivate, publicJwk } from "./jwt.js";

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
  const value = { signer: await importPrivate(list[0]), jwks: { keys: list.map(publicJwk) } };
  memo.set(name, { raw, value });
  return value;
}

export const signingKeys = (env) => load(env, "SIGNING_KEYS");
export const clientKeys = (env) => load(env, "CLIENT_KEYS");
