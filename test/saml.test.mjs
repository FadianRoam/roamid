// SAML 2.0: a SAML identity provider upstream (with the attack fixtures of
// the design), and RoamID as SAML identity provider for service providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, login, exchange, pkce, clientEntry, BASE, sha256b64url } from "./_harness.mjs";
import { FX, samlIdpEntry, samlSpEntry, readRedirect, redirectRequest, buildResponse, readPostPage, IDP_SSO, rawEncrypted } from "./_saml.mjs";
import { decryptStats } from "../src/saml/xmlenc.js";
import { NS } from "../src/saml/xml.js";
import { verifyResponse } from "../src/saml/response.js";
import { parseXml } from "../src/saml/xml.js";

const ACS = `${BASE}/saml/acs/samlidp`;
const SP_ENTITY = `${BASE}/saml/sp`;

async function samlSetup(idpExtra = {}, opts = {}) {
  const h = await setup({ extraIdps: [samlIdpEntry("samlidp", idpExtra)], clients: [clientEntry("spa"), samlSpEntry("sp", { idp_initiated: true }), samlSpEntry("signed", { sign_cert: FX.spCert })], ...opts });
  return h;
}

// Start an OIDC sign-in that picks the SAML IdP; return the AuthnRequest.
async function startSaml(h, pk) {
  const q = new URLSearchParams({ response_type: "code", client_id: "spa", redirect_uri: "https://rp.example.test/spa/cb", scope: "openid email profile", state: "s1", nonce: "n1", idp_hint: "samlidp", code_challenge: pk.challenge, code_challenge_method: "S256" });
  const r = await h.request(`/authorize?${q}`);
  assert.equal(r.status, 303);
  const loc = r.headers.get("Location");
  assert.ok(loc.startsWith(IDP_SSO), loc);
  return readRedirect(loc);
}
const post = (h, path, fields) => h.request(path, { method: "POST", body: new URLSearchParams(fields).toString() });

async function samlLoginOk(h, opts = {}) {
  const pk = await pkce();
  const ar = await startSaml(h, pk);
  const resp = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id, ...opts });
  const r = await post(h, "/saml/acs/samlidp", { SAMLResponse: resp.b64, RelayState: ar.relayState });
  return { r, pk, ar, resp };
}

test("SAML IdP -> OIDC: signed assertion, signed AuthnRequest, claims and email authority", async () => {
  const h = await samlSetup({ email_domains: ["lab.yunzheng.space"] }, { txt: { "_roamid.lab.yunzheng.space": ["roamid-idp=samlidp"] } });
  await h.sync();
  const pk = await pkce();
  const ar = await startSaml(h, pk);
  assert.equal(ar.u.searchParams.get("SigAlg"), "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
  assert.ok(ar.u.searchParams.get("Signature"), "AuthnRequests are signed");
  assert.match(ar.xml, new RegExp(`AssertionConsumerServiceURL="${ACS}"`));
  const resp = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id });
  const r = await post(h, "/saml/acs/samlidp", { SAMLResponse: resp.b64, RelayState: ar.relayState });
  assert.equal(r.status, 302, await r.clone().text());
  const code = new URL(r.headers.get("Location")).searchParams.get("code");
  const x = await exchange(h, { code, verifier: pk.verifier });
  const c = JSON.parse(Buffer.from(x.body.id_token.split(".")[1], "base64url"));
  assert.equal(c.idp, "samlidp");
  assert.equal(c.sub, await sha256b64url("samlidp|user-42"));
  assert.equal(c.email, "lemon@lab.yunzheng.space");
  assert.equal(c.email_authority, "authoritative");
  assert.equal(c.name, "Lemon");
});

test("signed Response with unsigned assertion is accepted; neither signed is refused", async () => {
  const h = await samlSetup();
  assert.equal((await samlLoginOk(h, { signAssertion: false, signResponse: true })).r.status, 302);
  const bad = await samlLoginOk(h, { signAssertion: false });
  assert.equal(bad.r.status, 400);
  assert.match(await bad.r.text(), /saml_unsigned/);
});

test("EncryptedAssertion: AES-GCM in an unsigned Response; AES-CBC only in a signed Response", async () => {
  const h = await samlSetup();
  assert.equal((await samlLoginOk(h, { encryptTo: FX.roamidCert, encMode: "gcm" })).r.status, 302);
  // Signed Response + CBC: the signature is verified first, then CBC is allowed.
  assert.equal((await samlLoginOk(h, { encryptTo: FX.roamidCert, encMode: "cbc", signResponse: true })).r.status, 302);
  // Unsigned Response + CBC: refused before anything is decrypted.
  const before = decryptStats.calls;
  const cbc = await samlLoginOk(h, { encryptTo: FX.roamidCert, encMode: "cbc" });
  assert.equal(cbc.r.status, 400);
  assert.match(await cbc.r.text(), /saml_algorithm/);
  assert.equal(decryptStats.calls, before, "decryptAssertion must not run for an unsigned Response with CBC");
  // GCM still decrypts in an unsigned Response (the counter moves).
  await samlLoginOk(h, { encryptTo: FX.roamidCert, encMode: "gcm" });
  assert.equal(decryptStats.calls, before + 1);
  const wrong = await samlLoginOk(h, { encryptTo: FX.otherCert });
  assert.match(await wrong.r.text(), /saml_invalid_response/);
});

// The decryption oracle (Jager and Somorovsky): every way an encrypted
// assertion can fail to decrypt or parse must look the same from outside.
test("oracle: bad padding, bad GCM tag, bad plaintexts, truncated data and a foreign key give identical responses", async () => {
  const h = await samlSetup();
  const variants = {
    // CBC with an invalid last padding byte, inside a signed Response (the only place CBC is decrypted).
    badPadding: { encrypted: () => rawEncrypted({ mode: "cbc", plaintext: Buffer.alloc(32, 0x41), padByte: 0 }), signResponse: true },
    badGcmTag: { encrypted: () => rawEncrypted({ mode: "gcm", plaintext: "<x/>", tamper: (d) => { d[d.length - 1] ^= 1; return d; } }) },
    notXml: { encrypted: () => rawEncrypted({ mode: "gcm", plaintext: "this is not XML at all" }) },
    badUtf8: { encrypted: () => rawEncrypted({ mode: "gcm", plaintext: Buffer.from([0x3c, 0xff, 0xfe, 0x3e]) }) },
    notAssertion: { encrypted: () => rawEncrypted({ mode: "gcm", plaintext: `<saml:Issuer xmlns:saml="${NS.saml}">x</saml:Issuer>` }) },
    nested: { encrypted: () => rawEncrypted({ mode: "gcm", plaintext: `<saml:Assertion xmlns:saml="${NS.saml}" ID="_o"><saml:Advice><saml:Assertion ID="_i"/></saml:Advice></saml:Assertion>` }) },
    truncated: { encrypted: () => rawEncrypted({ mode: "gcm", plaintext: "<x/>", tamper: (d) => d.subarray(0, 20) }) },
    foreignKey: { encrypted: () => rawEncrypted({ mode: "gcm", plaintext: "<x/>", cert: FX.otherCert }) },
    cbcBadPaddingSignedLong: { encrypted: () => rawEncrypted({ mode: "cbc", plaintext: Buffer.alloc(48, 0x42), padByte: 200 }), signResponse: true },
  };
  const seen = [];
  const reasons = {};
  const warn = console.warn;
  for (const [name, v] of Object.entries(variants)) {
    console.warn = (...a) => { if (a[0] === "[saml] encrypted assertion refused:") reasons[name] = a[1]; };
    const pk = await pkce();
    const ar = await startSaml(h, pk);
    const enc = v.encrypted();
    const resp = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id, signAssertion: false, signResponse: !!v.signResponse, mutateAssertion: () => enc });
    const r = await h.request("/saml/acs/samlidp", { method: "POST", body: new URLSearchParams({ SAMLResponse: resp.b64, RelayState: ar.relayState }).toString(), headers: { "CF-Ray": "fixed-ray-id" } });
    const headers = [...r.headers].filter(([k]) => k !== "date").sort().map((x) => x.join(": ")).join("\n");
    seen.push({ name, status: r.status, body: await r.text(), headers });
    console.warn = warn;
  }
  // Each variant failed where it was meant to (server log only).
  assert.deepEqual(reasons, { badPadding: "cbc padding", badGcmTag: "gcm tag", notXml: "plaintext parse", badUtf8: "utf-8", notAssertion: "not an Assertion", nested: "nested assertions", truncated: "gcm length", foreignKey: "key unwrap", cbcBadPaddingSignedLong: "cbc padding" });
  for (const x of seen) {
    assert.equal(x.status, seen[0].status, x.name);
    assert.equal(x.headers, seen[0].headers, x.name);
    assert.equal(x.body, seen[0].body, `${x.name} differs from ${seen[0].name}`);
  }
  assert.equal(seen[0].status, 400);
  assert.match(seen[0].body, /saml_invalid_response/);
  assert.match(seen[0].body, /<p class="mono">the response cannot be processed<\/p>/);
});

for (const [name, mutate] of [
  // XSW: an unsigned evil assertion before the signed one, the signed one hidden in Extensions
  ["XSW: evil assertion + signed copy in Extensions", (x) => x.replace(/(<saml:Assertion [\s\S]*<\/saml:Assertion>)/, (a) => `<samlp:Extensions>${a}</samlp:Extensions>${a.replace(/ID="[^"]+"/, 'ID="_evil"').replace("user-42", "victim").replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "")}`)],
  // XSW: signed assertion nested inside the evil one
  ["XSW: signed assertion nested in the evil one", (x) => x.replace(/(<saml:Assertion [\s\S]*<\/saml:Assertion>)/, (a) => a.replace(/ID="[^"]+"/, 'ID="_evil"').replace("user-42", "victim").replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "").replace("</saml:Subject>", `</saml:Subject>${a}`))],
  // XSW: duplicate ID, evil copy first
  ["XSW: duplicate ID", (x) => x.replace(/(<saml:Assertion [\s\S]*<\/saml:Assertion>)/, (a) => `${a.replace("user-42", "victim").replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "")}${a}`)],
  // XSW: the signed assertion moved into the Signature's Object
  ["XSW: signed assertion inside ds:Object", (x) => x.replace(/(<saml:Assertion [\s\S]*<\/saml:Assertion>)/, (a) => a.replace(/ID="[^"]+"/, 'ID="_evil"').replace("user-42", "victim").replace("</ds:Signature>", `<ds:Object>${a}</ds:Object></ds:Signature>`))],
]) {
  test(`attack refused: ${name}`, async () => {
    const h = await samlSetup();
    const { r } = await samlLoginOk(h, { mutate });
    assert.equal(r.status, 400, name);
    assert.match(await r.text(), /saml_(invalid|signature_invalid)/, name);
  });
}

test("attack refused: a tampered NameID breaks the signature", async () => {
  const h = await samlSetup();
  const { r } = await samlLoginOk(h, { mutate: (x) => x.replace(">user-42<", ">victim<") });
  assert.match(await r.text(), /saml_signature_invalid/);
});

test("comment injection in NameID: the whole value is the subject", async () => {
  const h = await samlSetup();
  const pk = await pkce();
  const ar = await startSaml(h, pk);
  const resp = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id, nameId: "victim@example.org<!---->.attacker.example" });
  const r = await post(h, "/saml/acs/samlidp", { SAMLResponse: resp.b64, RelayState: ar.relayState });
  assert.equal(r.status, 302);
  const x = await exchange(h, { code: new URL(r.headers.get("Location")).searchParams.get("code"), verifier: pk.verifier });
  const c = JSON.parse(Buffer.from(x.body.id_token.split(".")[1], "base64url"));
  assert.equal(c.sub, await sha256b64url("samlidp|victim@example.org.attacker.example"));
  assert.notEqual(c.sub, await sha256b64url("samlidp|victim@example.org"));
});

test("refused: wrong audience, wrong recipient, wrong InResponseTo, expired", async () => {
  const cases = [
    [{ audience: "https://other.example.test/sp" }, /saml_invalid/],
    [{ recipient: "https://other.example.test/acs" }, /saml_invalid/],
    [{ destination: "https://other.example.test/acs" }, /saml_invalid/],
    [{ inResponseTo: "_other" }, /saml_invalid/],
    [{ notOnOrAfter: Math.floor(Date.now() / 1000) - 600 }, /saml_expired/],
  ];
  for (const [o, re] of cases) {
    const h = await samlSetup();
    const pk = await pkce();
    const ar = await startSaml(h, pk);
    const resp = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id, ...o });
    const r = await post(h, "/saml/acs/samlidp", { SAMLResponse: resp.b64, RelayState: ar.relayState });
    assert.equal(r.status, 400, JSON.stringify(o));
    assert.match(await r.text(), re, JSON.stringify(o));
  }
});

test("refused: a certificate that is not the provider's, SHA-1, DOCTYPE, transient NameID", async () => {
  let h = await samlSetup();
  assert.match(await (await samlLoginOk(h, { key: FX.otherKey, cert: FX.otherCert })).r.text(), /saml_signature_invalid/);
  h = await samlSetup();
  assert.match(await (await samlLoginOk(h, { sha1: true })).r.text(), /saml_algorithm/);
  h = await samlSetup();
  assert.match(await (await samlLoginOk(h, { mutate: (x) => `<!DOCTYPE r [<!ENTITY e "x">]>${x}` })).r.text(), /saml_bad_xml/);
  h = await samlSetup();
  assert.match(await (await samlLoginOk(h, { nameIdFormat: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient" })).r.text(), /saml_subject/);
});

test("replay: an assertion ID is accepted once", async () => {
  const h = await samlSetup();
  const ar = { id: "_req1" };
  const resp = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id });
  const { samlLogin } = await import("../src/saml/sp.js");
  const idp = samlIdpEntry("samlidp");
  const tx = { up_req_id: "_req1" };
  await h.sync();
  assert.equal((await samlLogin(h.env, idp, tx, resp.b64)).sub, "user-42");
  await assert.rejects(samlLogin(h.env, idp, tx, resp.b64), (e) => e.code === "saml_replay");
});

test("attribute subject: sub_source names a stable attribute", async () => {
  const h = await samlSetup({ sub_source: "urn:oasis:names:tc:SAML:attribute:subject-id" });
  const { r } = await samlLoginOk(h, { nameIdFormat: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient", attrs: { "urn:oasis:names:tc:SAML:attribute:subject-id": "u-77@example.org", mail: "a@example.org" } });
  assert.equal(r.status, 302);
});

// ---- RoamID as SAML IdP ------------------------------------------------------

function spAuthnRequest(sp, { id = "_sp1", acs } = {}) {
  const t = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${t}"${acs ? ` AssertionConsumerServiceURL="${acs}"` : ""}><saml:Issuer>https://sp.example.test/${sp}</saml:Issuer></samlp:AuthnRequest>`;
}

async function idpCerts() { return [FX.roamidCert]; }

test("OIDC IdP -> SAML SP: SP-initiated, signed Response, persistent NameID, attributes", async () => {
  const h = await samlSetup();
  const r1 = await h.request(`/saml/idp/sso?SAMLRequest=${redirectRequest(spAuthnRequest("sp"))}&RelayState=rs1`);
  assert.equal(r1.status, 303);
  const sel = r1.headers.get("Location");
  const picker = await h.request(sel);
  assert.match(await picker.text(), /sp\.example\.test/, "the picker shows the service's ACS host");
  const tx = new URL(BASE + sel).searchParams.get("tx");
  const up = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp: "good" }).toString() });
  const cb = h.idps.good.issue(up.headers.get("Location"));
  const done = await h.request(cb);
  assert.equal(done.status, 200);
  const page = readPostPage(await done.text());
  assert.equal(page.action, "https://sp.example.test/sp/acs");
  assert.equal(page.relayState, "rs1");
  const v = await verifyResponse(Buffer.from(page.response, "base64").toString("utf8"), { acs: "https://sp.example.test/sp/acs", spEntityId: "https://sp.example.test/sp", idpEntityId: `${BASE}/saml/idp`, requestId: "_sp1", certs: await idpCerts(), keys: [] });
  assert.equal(v.nameIdFormat, "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent");
  assert.equal(v.nameId, await sha256b64url("good|user-1"));
  const a = Object.fromEntries(v.attributes.map((x) => [x.friendly, x.values[0]]));
  assert.equal(a.mail, "lemon@lab.example.org");
  assert.equal(a.idp, "good");
  assert.equal(a.email_authority, "asserted");
  assert.equal(a.email_verified, "false");
});

test("SAML SP: unregistered ACS is refused without posting; unsigned request refused when a cert is registered", async () => {
  const h = await samlSetup();
  const bad = await h.request(`/saml/idp/sso?SAMLRequest=${redirectRequest(spAuthnRequest("sp", { acs: "https://evil.example.test/acs" }))}`);
  assert.equal(bad.status, 400);
  const body = await bad.text();
  assert.match(body, /invalid_redirect_uri/);
  assert.doesNotMatch(body, /evil\.example\.test\/acs" /);
  const unsigned = await h.request(`/saml/idp/sso?SAMLRequest=${redirectRequest(spAuthnRequest("signed"))}`);
  const page = await unsigned.text();
  assert.match(page, /saml_request/);
  const form = readPostPage(page);
  assert.equal(form.action, "https://sp.example.test/signed/acs");
  assert.match(Buffer.from(form.response, "base64").toString(), /RequestDenied/);
});

test("SAML SP: signed Redirect request accepted; IdP-initiated; cancel posts AuthnFailed", async () => {
  const h = await samlSetup();
  const { sign } = await import("node:crypto");
  const q = `SAMLRequest=${redirectRequest(spAuthnRequest("signed"))}&RelayState=x&SigAlg=${encodeURIComponent("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256")}`;
  const sig = sign("sha256", Buffer.from(q), FX.spKey).toString("base64");
  const ok = await h.request(`/saml/idp/sso?${q}&Signature=${encodeURIComponent(sig)}`);
  assert.equal(ok.status, 303);
  const refused = await h.request("/saml/idp/sso?sp=signed");
  assert.equal(refused.status, 400, "IdP-initiated sign-in only for an application that opted in");
  assert.match(await refused.text(), /IdP-initiated sign-in is not enabled/);
  const idpInit = await h.request("/saml/idp/sso?sp=sp&RelayState=deep");
  assert.equal(idpInit.status, 303);
  const tx = new URL(BASE + idpInit.headers.get("Location")).searchParams.get("tx");
  const cancel = await h.request(`/saml/idp/cancel?tx=${tx}`);
  // The page may post to the service provider's ACS origin (also http://localhost in development).
  assert.match(cancel.headers.get("Content-Security-Policy"), /form-action 'self' https: https:\/\/sp\.example\.test;/);
  const f = readPostPage(await cancel.text());
  assert.match(Buffer.from(f.response, "base64").toString(), /AuthnFailed/);
});

test("metadata documents", async () => {
  const h = await samlSetup();
  const idp = await (await h.request("/saml/idp/metadata.xml")).text();
  assert.match(idp, /entityID="https:\/\/id\.example\.test\/saml\/idp"/);
  assert.ok(parseXml(idp));
  const sp = await (await h.request("/saml/sp/metadata.xml")).text();
  assert.match(sp, /\/saml\/acs\/samlidp/);
  assert.match(sp, /use="encryption"/);
});

test("layer: exactly one assertion in the whole document, even inside a signed Response", async () => {
  const h = await samlSetup();
  const { r } = await samlLoginOk(h, { signResponse: true, signAssertion: false, mutateAssertion: (a) => `<samlp:Extensions>${a.replace(/ID="[^"]+"/, 'ID="_second"')}</samlp:Extensions>${a}` });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /exactly one assertion/);
});

test("layer: duplicate IDs are refused before any signature check", async () => {
  const { assertUniqueIds } = await import("../src/saml/dsig.js");
  assert.throws(() => assertUniqueIds(parseXml('<r><a ID="_1"/><b ID="_1"/></r>')), (e) => e.code === "saml_signature_invalid");
  assert.doesNotThrow(() => assertUniqueIds(parseXml('<r><a ID="_1"/><b ID="_2"/></r>')));
});

test("layer: the signature's Reference must point at the element itself", async () => {
  const { verifyElement, signElement } = await import("../src/saml/dsig.js");
  const signed = signElement('<x:A xmlns:x="urn:x" ID="_a"><x:Issuer>i</x:Issuer><x:B>v</x:B></x:A>', "_a", { key: FX.idpKey, cert: FX.idpCert });
  const moved = signed.replace('URI="#_a"', 'URI="#_b"');
  const doc = parseXml(moved);
  assert.throws(() => verifyElement(doc.documentElement, moved, [FX.idpCert]), /one Reference to the element itself/);
  const doc2 = parseXml(signed);
  assert.match(verifyElement(doc2.documentElement, signed, [FX.idpCert]), /<x:B>v<\/x:B>/);
});

// HTTP-Redirect binding: the signed octets and the processed values come
// from the same single occurrence of each parameter.
test("Redirect binding: repeated SAML parameters are refused (parser differential)", async () => {
  const h = await samlSetup();
  const { sign } = await import("node:crypto");
  const RSA256 = encodeURIComponent("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
  const signedQuery = (xml, relay = "x", alg = RSA256, hash = "sha256") => {
    const q = `SAMLRequest=${redirectRequest(xml)}&RelayState=${relay}&SigAlg=${alg}`;
    return `${q}&Signature=${encodeURIComponent(sign(hash, Buffer.from(q), FX.spKey).toString("base64"))}`;
  };
  const good = signedQuery(spAuthnRequest("signed", { id: "_good" }));
  const forged = redirectRequest(spAuthnRequest("signed", { id: "_forged" }));
  // Control: the signed request alone is accepted.
  assert.equal((await h.request(`/saml/idp/sso?${good}`)).status, 303);
  const refused = async (q, why) => {
    const r = await h.request(`/saml/idp/sso?${q}`);
    const body = await r.text();
    assert.notEqual(r.status, 303, why);
    assert.equal(r.status, 400, why);
    assert.match(body, /saml_request/, why);
    return body;
  };
  assert.match(await refused(`SAMLRequest=${forged}&${good}`, "forged first, signed last"), /SAMLRequest appears more than once/);
  assert.match(await refused(`${good}&SAMLRequest=${forged}`, "signed first, forged last"), /SAMLRequest appears more than once/);
  assert.match(await refused(`SAML%52equest=${forged}&${good}`, "percent-encoded name"), /SAMLRequest appears more than once/);
  assert.match(await refused(`${good}&SAMLRequest%3D=${forged}`.replace("SAMLRequest%3D", "SAMLR%65quest"), "encoded name after"), /SAMLRequest appears more than once/);
  assert.match(await refused(`RelayState=evil&${good}`, "RelayState repeated"), /RelayState appears more than once/);
  assert.match(await refused(`${good}&SigAlg=${RSA256}`, "SigAlg repeated"), /SigAlg appears more than once/);
  assert.match(await refused(`${good}&Signature=AAAA`, "Signature repeated"), /Signature appears more than once/);
  // SHA-1 is not an allowed signature algorithm.
  const sha1 = signedQuery(spAuthnRequest("signed", { id: "_sha1" }), "x", encodeURIComponent("http://www.w3.org/2000/09/xmldsig#rsa-sha1"), "sha1");
  assert.match(await refused(sha1, "rsa-sha1"), /signature algorithm not allowed/);
  // A signature without SigAlg is refused.
  assert.match(await refused(good.replace(/&SigAlg=[^&]+/, ""), "no SigAlg"), /signature is missing or invalid/);
});

test("HTTP-POST binding: repeated SAML fields are refused", async () => {
  const h = await samlSetup();
  const pk = await pkce();
  const ar = await startSaml(h, pk);
  const resp = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id });
  const evil = buildResponse({ acs: ACS, audience: SP_ENTITY, inResponseTo: ar.id, nameId: "victim" });
  const body = `SAMLResponse=${encodeURIComponent(evil.b64)}&SAMLResponse=${encodeURIComponent(resp.b64)}&RelayState=${encodeURIComponent(ar.relayState)}`;
  const r = await h.request("/saml/acs/samlidp", { method: "POST", body });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /SAMLResponse appears more than once/);
  const req = Buffer.from(spAuthnRequest("sp")).toString("base64");
  const r2 = await h.request("/saml/idp/sso", { method: "POST", body: `SAMLRequest=${encodeURIComponent(req)}&RelayState=a&RelayState=b` });
  assert.equal(r2.status, 400);
  assert.match(await r2.text(), /RelayState appears more than once/);
});

test("dsig: only exclusive canonicalization, without comments, is accepted", async () => {
  const h = await samlSetup();
  for (const alg of ["http://www.w3.org/TR/2001/REC-xml-c14n-20010315", "http://www.w3.org/2001/10/xml-exc-c14n#WithComments"]) {
    const { r } = await samlLoginOk(h, { mutateAssertion: (a) => a.replace(/(<ds:CanonicalizationMethod Algorithm=")[^"]+/, `$1${alg}`) });
    assert.equal(r.status, 400, alg);
    assert.match(await r.text(), /saml_algorithm/, alg);
    const t = await samlLoginOk(h, { mutateAssertion: (a) => a.replace(/<ds:Transform Algorithm="http:\/\/www\.w3\.org\/2001\/10\/xml-exc-c14n#"\/>/, `<ds:Transform Algorithm="${alg}"/>`) });
    assert.equal(t.r.status, 400, `transform ${alg}`);
    assert.match(await t.r.text(), /saml_algorithm/, `transform ${alg}`);
  }
});

test("decryptAssertion itself refuses AES-CBC unless a signature was verified", async () => {
  const { decryptAssertion, DecryptFailure } = await import("../src/saml/xmlenc.js");
  const { samlKeys } = await import("../src/saml/certs.js");
  const { SAML_KEYS } = await import("./_saml.mjs");
  const el = parseXml(rawEncrypted({ mode: "cbc", plaintext: "<a/>" })).documentElement;
  await assert.rejects(decryptAssertion(el, samlKeys({ SAML_KEYS })), (e) => e instanceof DecryptFailure && e.reason === "cbc without a verified signature");
  assert.equal(new TextDecoder().decode(await decryptAssertion(el, samlKeys({ SAML_KEYS }), { allowCbc: true })), "<a/>");
});
