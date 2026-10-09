// ID token signing algorithms: RS256 by default (OpenID Connect Core 15.1),
// ES256 for a client that asks for it, both keys at /jwks.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { setup, login, exchange, pkce, clientEntry, SIGNING_RS, SIGNING_EC } from "./_harness.mjs";
import { validateClient, validateRegistry } from "../src/registry/validate.js";
import { verify } from "../src/lib/jwt.js";

const jwksOf = async (h) => (await (await h.request("/jwks.json")).json()).keys;

// Verify with node:crypto (independent of src/lib/jwt.js), using only the
// JWKS key named by the token's kid.
function nodeCheck(token, keys) {
  const [h, p, s] = token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url"));
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { header, ok: false };
  const ok = nodeVerify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  return { header, jwk, ok, payload: JSON.parse(Buffer.from(p, "base64url")) };
}

async function idToken(h, client = "spa") {
  const pk = await pkce();
  const r = await login(h, { client, pk });
  assert.ok(r.code, `code for ${client}`);
  const { res, body } = await exchange(h, { code: r.code, client, verifier: pk.verifier });
  assert.equal(res.status, 200, JSON.stringify(body));
  return body;
}

test("discovery lists RS256 and ES256 for ID tokens", async () => {
  const h = await setup();
  const d = await (await h.request("/.well-known/openid-configuration")).json();
  assert.deepEqual(d.id_token_signing_alg_values_supported, ["RS256", "ES256"]);
});

test("/jwks.json publishes both public keys with kid, alg and use, and no private members", async () => {
  const h = await setup();
  const keys = await jwksOf(h);
  assert.equal(keys.length, 2);
  const rs = keys.find((k) => k.kid === SIGNING_RS.kid), ec = keys.find((k) => k.kid === SIGNING_EC.kid);
  assert.ok(rs && ec, keys.map((k) => k.kid).join(","));
  assert.deepEqual([rs.kty, rs.alg, rs.use], ["RSA", "RS256", "sig"]);
  assert.deepEqual([ec.kty, ec.crv, ec.alg, ec.use], ["EC", "P-256", "ES256", "sig"]);
  for (const k of keys) for (const m of ["d", "p", "q", "dp", "dq", "qi"]) assert.equal(k[m], undefined, `${k.kid} has no ${m}`);
});

test("default: a client without id_token_signed_response_alg gets an RS256 ID token that verifies with the RSA key only", async () => {
  const h = await setup();
  const body = await idToken(h);
  const keys = await jwksOf(h);
  const n = nodeCheck(body.id_token, keys);
  assert.equal(n.header.alg, "RS256");
  assert.equal(n.header.kid, SIGNING_RS.kid);
  assert.equal(n.jwk.alg, "RS256");
  assert.ok(n.ok, "signature verifies (node:crypto) with the key named by kid");
  assert.equal(n.payload.aud, "spa");
  // An RS256-only verifier accepts it; the EC key does not.
  await verify(body.id_token, keys, ["RS256"]);
  await assert.rejects(verify(body.id_token, keys.filter((k) => k.kty === "EC"), ["RS256", "ES256"]));
  await assert.rejects(verify(body.id_token, keys, ["ES256"]), /algorithm not allowed/);
});

test("a client with id_token_signed_response_alg ES256 gets an ES256 ID token; RS256 stays the default for others", async () => {
  const h = await setup({ clients: [clientEntry("spa"), clientEntry("ec-app", { id_token_signed_response_alg: "ES256" }), clientEntry("rs-app", { id_token_signed_response_alg: "RS256" })] });
  const keys = await jwksOf(h);
  const ec = nodeCheck((await idToken(h, "ec-app")).id_token, keys);
  assert.equal(ec.header.alg, "ES256");
  assert.equal(ec.header.kid, SIGNING_EC.kid);
  assert.ok(ec.ok, "ES256 signature verifies with the EC key");
  assert.equal(ec.payload.aud, "ec-app");
  const rs = nodeCheck((await idToken(h, "rs-app")).id_token, keys);
  assert.equal(rs.header.alg, "RS256");
  assert.ok(rs.ok);
  assert.equal(nodeCheck((await idToken(h, "spa")).id_token, keys).header.alg, "RS256");
});

test("an unknown id_token_signed_response_alg in the registry is refused", async () => {
  for (const alg of ["HS256", "none", "PS256", "rs256", 256]) {
    const errs = validateClient(clientEntry("app", { id_token_signed_response_alg: alg }));
    assert.ok(errs.some((e) => /id_token_signed_response_alg/.test(e)), `${alg}: ${errs.join("; ")}`);
  }
  assert.deepEqual(validateClient(clientEntry("app", { id_token_signed_response_alg: "ES256" })), []);
  // At run time the entry is dropped and the client is unknown.
  const reg = validateRegistry({ idps: [], clients: [clientEntry("bad-alg", { id_token_signed_response_alg: "HS256" }), clientEntry("spa")] });
  assert.deepEqual(reg.clients.map((c) => c.client_id), ["spa"]);
  assert.ok(reg.dropped.some((d) => d.id === "bad-alg"));
  const h = await setup({ clients: [clientEntry("bad-alg", { id_token_signed_response_alg: "HS256" }), clientEntry("spa")] });
  const r = await login(h, { client: "bad-alg", pk: await pkce() });
  assert.equal(r.code, undefined, "no code for a dropped entry");
  assert.ok(r.authorize.status >= 400, `authorize answered ${r.authorize.status}`);
});

test("a missing key for the client's algorithm is a server error that does not spend the code", async () => {
  const h = await setup();
  h.env.SIGNING_KEYS = JSON.stringify([SIGNING_EC]);
  const pk = await pkce();
  const r = await login(h, { pk });
  const first = await exchange(h, { code: r.code, verifier: pk.verifier });
  assert.equal(first.res.status, 500);
  assert.equal(first.body.error, "server_error");
  h.env.SIGNING_KEYS = JSON.stringify([SIGNING_EC, SIGNING_RS]);
  const again = await exchange(h, { code: r.code, verifier: pk.verifier });
  assert.equal(again.res.status, 200, JSON.stringify(again.body));
});

test("logout: an RS256 id_token_hint names the client and returns to its post_logout_redirect_uri", async () => {
  const h = await setup({ clients: [clientEntry("spa"), clientEntry("ec-app", { id_token_signed_response_alg: "ES256" })] });
  for (const client of ["spa", "ec-app"]) {
    const { id_token } = await idToken(h, client);
    const bye = `https://rp.example.test/${client}/bye`;
    const r = await h.request(`/logout?${new URLSearchParams({ id_token_hint: id_token, post_logout_redirect_uri: bye, state: "z" })}`);
    assert.equal(r.status, 302, `${client}: ${r.status}`);
    assert.equal(r.headers.get("Location"), `${bye}?state=z`);
  }
});
