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

test("layout: registry/idps/<id>/idp.json; the directory name equals the id; logo is not written by hand", async () => {
  const { fileRecord: r } = await import("../scripts/lib.mjs");
  assert.deepEqual(checkFileNames([r("registry/idps/one/idp.json", idp("one"))]), []);
  assert.match(checkFileNames([r("registry/idps/one.json", idp("one"))])[0], /registry\/idps\/<id>\/idp\.json/, "the earlier flat layout is refused on the head");
  assert.equal(checkFileNames([r("registry/idps/uno/idp.json", idp("one"))]).length, 1);
  assert.equal(checkFileNames([r("registry/other/one.json", idp("one"))]).length, 1);
  assert.equal(checkFileNames([r("registry/idps/one/notes.txt", new Uint8Array([1]))]).length, 1);
  assert.equal(checkFileNames([r("registry/clients/app.json", null)]).length, 1);
  assert.match(checkFileNames([r("registry/idps/one/idp.json", { ...idp("one"), logo: { path: "x" } })])[0], /set by the publish step/);
});

test("layout migration keeps identifiers; a real rename or delete is still refused", async () => {
  const { fileRecord: r, idsOf } = await import("../scripts/lib.mjs");
  const base = [r("registry/idps/one.json", idp("one")), r("registry/idps/two.json", idp("two")), r("registry/clients/app.json", {})];
  const moved = [r("registry/idps/one/idp.json", idp("one")), r("registry/idps/two/idp.json", idp("two")), r("registry/clients/app.json", {})];
  assert.deepEqual(checkImmutable(idsOf(base), idsOf(moved)), []);
  const renamed = [r("registry/idps/one/idp.json", idp("one")), r("registry/idps/deux/idp.json", idp("deux")), r("registry/clients/app.json", {})];
  assert.match(checkImmutable(idsOf(base), idsOf(renamed)).join(), /"two" was removed or renamed/);
  assert.match(checkImmutable(idsOf(moved), idsOf(moved.slice(1))).join(), /"one" was removed or renamed/);
});

test("logo validator: type by magic bytes, size, dimensions, animation, trailing data", async () => {
  const { checkLogo } = await import("../src/registry/logo.js");
  const { fileRecord: r } = await import("../scripts/lib.mjs");
  const { readFileSync } = await import("node:fs");
  const fx = (f) => new Uint8Array(readFileSync(new URL(`./fixtures/logos/${f}`, import.meta.url)));
  for (const [f, ext, w, h] of [["valid.png", "png", 128, 128], ["valid.webp", "webp", 128, 128], ["valid.jpg", "jpg", 160, 96]]) {
    const c = checkLogo(fx(f), ext);
    assert.deepEqual([c.errors, c.width, c.height], [[], w, h], f);
  }
  const png = fx("valid.png");
  assert.match(checkLogo(png, "jpg").errors.join(), /PNG but named \.jpg/, "a PNG named .jpg");
  assert.match(checkLogo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "png").errors.join(), /not a PNG, WebP or JPEG/, "SVG");
  // A valid PNG made larger than 100 KB with an extra chunk before IEND.
  const big = new Uint8Array(png.length + 12 + 110 * 1024);
  big.set(png.subarray(0, png.length - 12));
  const at = png.length - 12, len = 110 * 1024;
  new DataView(big.buffer).setUint32(at, len); big.set(new TextEncoder().encode("tEXt"), at + 4);
  big.set(png.subarray(png.length - 12), at + 12 + len);
  assert.deepEqual(checkLogo(big, "png").errors.map((e) => /at most 100 KB/.test(e)), [true], "oversize, otherwise valid");
  assert.match(checkLogo(fx("anim.webp"), "webp").errors.join(), /animated WebP/);
  assert.match(checkLogo(fx("anim.png"), "png").errors.join(), /APNG/);
  for (const f of ["valid.png", "valid.webp", "valid.jpg"]) {
    const v = fx(f), t = new Uint8Array(v.length + 20); t.set(v); t.set(new TextEncoder().encode("<script>x</script>.."), v.length);
    assert.ok(checkLogo(t, f.split(".")[1]).errors.some((e) => /after the|RIFF size/.test(e)), `trailing data after ${f}`);
  }
  assert.match(checkLogo(fx("small.png"), "png").errors.join(), /32×32/, "too small");
  // In CI: an SVG file and a mismatched extension are refused with the path.
  const errs = checkFileNames([r("registry/idps/one/idp.json", idp("one")), r("registry/idps/one/logo.svg", new TextEncoder().encode("<svg/>"))]);
  assert.match(errs.join(), /logo\.png, logo\.webp or logo\.jpg/);
  assert.match(checkFileNames([r("registry/idps/one/idp.json", idp("one")), r("registry/idps/one/logo.jpg", png)]).join(), /registry\/idps\/one\/logo\.jpg: logo: the file is PNG/);
  assert.deepEqual(checkFileNames([r("registry/idps/one/idp.json", idp("one")), r("registry/idps/one/logo.png", png)]), []);
  assert.match(checkFileNames([r("registry/idps/one/idp.json", idp("one")), r("registry/idps/one/logo.png", png), r("registry/idps/one/logo.webp", fx("valid.webp"))]).join(), /at most one logo/);
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

test("docs/errors.md lists every error code", async () => {
  const { readFileSync } = await import("node:fs");
  const { ERROR_CODES } = await import("../src/ui/i18n.js");
  const md = readFileSync(new URL("../docs/errors.md", import.meta.url), "utf8");
  for (const c of ERROR_CODES) assert.ok(md.includes(`\`${c}\``), c);
});
