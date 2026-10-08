// The registry rules shared by CI and the Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateIdp, validateClient, validateRegistry, checkFileNames, checkImmutable } from "../src/registry/validate.js";
import { idpEntry, clientEntry } from "./_harness.mjs";

const idp = (id, extra) => idpEntry({ issuer: `https://${id}.example.org`, host: `${id}.example.org` }, id, extra);

test("IdP entries: id format, https issuer, openid scope, unknown fields", () => {
  assert.deepEqual(validateIdp(idp("good")), []);
  assert.ok(validateIdp(idp("Bad_Id")).some((e) => e.startsWith("id:")));
  assert.ok(validateIdp(idp("x")).some((e) => e.startsWith("id:")), "at least 2 characters");
  assert.ok(validateIdp(idp("good", { issuer: "http://good.example.org" })).some((e) => /https/.test(e)));
  assert.ok(validateIdp(idp("good", { issuer: "https://good.example.org#x" })).some((e) => /fragment/.test(e)));
  assert.ok(validateIdp(idp("good", { scopes: ["email"] })).some((e) => /openid/.test(e)));
  assert.ok(validateIdp(idp("good", { extra: 1 })).some((e) => /unknown field/.test(e)));
  assert.ok(validateIdp(idp("good", { protocol: "oauth2" })).some((e) => /protocol/.test(e)));
  assert.ok(validateIdp(idp("good", { email_domains: ["Example.org"] })).length, "domains are lower case");
});

test("client entries: redirect URI rules and authentication methods", () => {
  assert.deepEqual(validateClient(clientEntry("app")), []);
  const ru = (u) => validateClient(clientEntry("app", { redirect_uris: [u] }));
  assert.ok(ru("http://app.example.org/cb").length, "http only for localhost");
  assert.deepEqual(ru("http://localhost:8080/cb"), []);
  assert.deepEqual(ru("http://127.0.0.1/cb"), []);
  assert.ok(ru("https://app.example.org/cb#x").length, "no fragment");
  assert.ok(ru("https://*.example.org/cb").length, "no wildcard");
  assert.ok(ru("https://u:p@app.example.org/cb").length, "no credentials");
  assert.ok(validateClient(clientEntry("app", { token_endpoint_auth_method: "client_secret_basic" })).some((e) => /client_secret_sha256/.test(e)));
  assert.ok(validateClient(clientEntry("app", { token_endpoint_auth_method: "private_key_jwt" })).some((e) => /jwks_uri/.test(e)));
  assert.ok(validateClient(clientEntry("app", { client_secret_sha256: "0".repeat(64) })).some((e) => /public client/.test(e)));
  assert.ok(validateClient(clientEntry("app", { subject_type: "pairwise", redirect_uris: ["https://a.example.org/cb", "https://b.example.org/cb"] })).some((e) => /one host/.test(e)));
});

test("registry: duplicates, a shared issuer and unknown allowed_idps", () => {
  const r = validateRegistry({ idps: [idp("one"), idp("one"), { ...idp("two"), issuer: "https://one.example.org" }], clients: [clientEntry("app", { allowed_idps: ["nope"] })] }, { strict: true });
  assert.deepEqual(r.idps.map((i) => i.id), ["one"]);
  assert.deepEqual(r.dropped.map((d) => d.errors[0].split(":")[0]), ["id", "issuer", "allowed_idps"]);
  const lax = validateRegistry({ idps: [idp("one")], clients: [clientEntry("app", { allowed_idps: ["nope"] })] });
  assert.equal(lax.clients.length, 1, "at run time an unknown allowed_idps entry is only filtered");
});

test("a domain claimed by two IdPs is refused", () => {
  const a = idp("one", { email_domains: ["example.org"] });
  const b = idp("two", { email_domains: ["example.org"] });
  const r = validateRegistry({ idps: [a, b], clients: [] }, { strict: true });
  assert.deepEqual(r.idps.map((i) => i.id), ["one"]);
  assert.match(r.dropped[0].errors[0], /example\.org is already claimed by one/);
  const w = validateRegistry({ idps: [idp("one", { email_domains: ["*.example.org"] }), idp("two", { email_domains: ["lab.example.org"] })], clients: [] }, { strict: true });
  assert.equal(w.dropped.length, 1, "a wildcard covers its subdomains");
  const ok = validateRegistry({ idps: [idp("one", { email_domains: ["example.org"] }), idp("two", { email_domains: ["lab.example.org"] })], clients: [] }, { strict: true });
  assert.equal(ok.dropped.length, 0, "a domain and a subdomain are different domains");
});

test("file names must equal the identifier", () => {
  assert.deepEqual(checkFileNames([{ path: "registry/idps/one.json", json: idp("one") }]), []);
  assert.equal(checkFileNames([{ path: "registry/idps/uno.json", json: idp("one") }]).length, 1);
  assert.equal(checkFileNames([{ path: "registry/other/one.json", json: idp("one") }]).length, 1);
  assert.equal(checkFileNames([{ path: "registry/clients/app.json", json: null }]).length, 1);
});

test("identifiers are permanent: delete and rename are refused", () => {
  const base = { idps: ["one", "two"], clients: ["app"] };
  assert.deepEqual(checkImmutable(base, { idps: ["one", "two", "three"], clients: ["app", "new"] }), []);
  const del = checkImmutable(base, { idps: ["one"], clients: ["app"] });
  assert.equal(del.length, 1);
  assert.match(del[0], /two.*removed or renamed/);
  const ren = checkImmutable(base, { idps: ["one", "deux"], clients: ["application"] });
  assert.equal(ren.length, 2);
});
