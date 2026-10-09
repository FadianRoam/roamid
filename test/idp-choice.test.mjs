// Which identity providers an application offers (all, only some, all but
// some), the provider's own `domain`, and the same-operator name exemption.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, login, pkce, clientEntry, idpEntry, sha256b64url } from "./_harness.mjs";
import { checkName } from "../src/apps/checks.js";
import { validateClient, validateIdp, validateRegistry } from "../src/registry/validate.js";
import { idpsFor } from "../src/oidc/op.js";

const alice = { sub: "alice-1", email: "alice@example.org", email_verified: true, name: "Alice", preferred_username: "alice" };
const olga = { sub: "olga-1", email: "olga@example.org", email_verified: true, name: "Olga", preferred_username: "olga" };

test("allowed_idps and excluded_idps: schema, never both, unknown ids in CI", () => {
  assert.deepEqual(validateClient(clientEntry("app1", { excluded_idps: ["good"] })), []);
  assert.match(validateClient(clientEntry("app1", { allowed_idps: ["good"], excluded_idps: ["evil"] })).join(" "), /excluded_idps: not together with allowed_idps/);
  assert.match(validateClient(clientEntry("app1", { protocol: "saml2", entity_id: "https://rp.example.test/sp", acs_urls: ["https://rp.example.test/acs"], redirect_uris: undefined, post_logout_redirect_uris: undefined, token_endpoint_auth_method: undefined, allowed_idps: ["good"], excluded_idps: ["evil"] })).join(" "), /not together/);
  const idp = { issuer: "https://idp.example.test", host: "idp.example.test" };
  const strict = validateRegistry({ idps: [idpEntry(idp, "good")], clients: [clientEntry("app1", { excluded_idps: ["nope"] })] }, { strict: true });
  assert.match(strict.dropped[0].errors[0], /^excluded_idps: unknown identity provider nope/);
});

test("idpsFor: all active, only the allowed, or all but the excluded (later additions included)", () => {
  const reg = { idps: new Map(["a", "b", "c", "d"].map((id) => [id, { id, status: id === "d" ? "disabled" : "active" }])) };
  const ids = (c) => idpsFor(reg, c).map((i) => i.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ allowed_idps: ["b", "d"] }), ["b"]);
  assert.deepEqual(ids({ excluded_idps: ["a"] }), ["b", "c"]);
  reg.idps.set("e", { id: "e", status: "active" });
  assert.deepEqual(ids({ excluded_idps: ["a"] }), ["b", "c", "e"], "a provider added later is offered");
  assert.deepEqual(ids({ allowed_idps: ["b"] }), ["b"], "and not to an allow list");
});

test("IdP domain: the issuer (or SAML endpoints) and the homepage must be on it", () => {
  const idp = { issuer: "https://login.example.org/realm", host: "example.org" };
  assert.deepEqual(validateIdp(idpEntry(idp, "xx", { domain: "example.org" })), []);
  assert.match(validateIdp(idpEntry(idp, "xx", { domain: "example.net" })).join(" "), /issuer: the host must be example.net/);
  assert.match(validateIdp(idpEntry(idp, "xx", { domain: "example.org", homepage: "https://elsewhere.test/" })).join(" "), /homepage: the host must be example.org/);
  assert.match(validateIdp(idpEntry(idp, "xx", { domain: "ample.org" })).join(" "), /issuer/, "a suffix that is not a label boundary is not the domain");
});

test("names: a provider's proven domain lets its own applications use its name", () => {
  const names = [{ id: "jyl", name: "JianyueLab Account", owner: "jianyuelab.co" }];
  const codes = (domain, list = names) => checkName("JianyueLab Account", "name.en", { names: list, domain }).map((e) => e.code);
  assert.deepEqual(codes("jianyuelab.co"), []);
  assert.deepEqual(codes("forum.jianyuelab.co"), ["name_taken"], "a subdomain can be someone else's (hosting, user pages)");
  assert.deepEqual(codes("jianyuelab.co.evil.test"), ["name_taken"]);
  assert.deepEqual(codes("notjianyuelab.co"), ["name_taken"]);
  assert.deepEqual(codes("jianyuelab.co", [{ id: "jyl", name: "JianyueLab Account" }]), ["name_taken"], "without a proven domain there is no exemption");
  // An unproven application on that domain cannot hold the name against the operator.
  const squat = [...names, { id: "app-squat", name: "JianyueLab Account", domain: "jianyuelab.co" }];
  assert.deepEqual(codes("jianyuelab.co", squat), []);
  assert.deepEqual(codes("other.example", squat), ["name_taken"]);
  // Two applications on an unrelated domain still block each other.
  assert.deepEqual(checkName("Same Name", "name.en", { names: [{ id: "a1", name: "Same Name", domain: "x.example" }], domain: "x.example" }).map((e) => e.code), ["name_taken"]);
});

async function consoleAs(h, user) {
  h.cookies = new Map();
  let r = await h.request("/console/login");
  r = await h.request(r.headers.get("Location"));
  const tx = new URL("https://x" + r.headers.get("Location")).searchParams.get("tx");
  r = await h.request("/select", { method: "POST", body: new URLSearchParams({ tx, idp: "good" }).toString() });
  r = await h.request(h.idps.good.issue(r.headers.get("Location"), user));
  await h.request(r.headers.get("Location"));
}
async function post(h, path, fields) {
  const page = await (await h.request("/console")).text();
  const b = new URLSearchParams({ csrf: /name="csrf" value="([^"]+)"/.exec(page)[1] });
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) b.append(k, x);
  const r = await h.request(path, { method: "POST", body: b.toString(), headers: { Origin: "null", "Sec-Fetch-Site": "same-origin" } });
  return { r, body: await r.text() };
}
const fields = (o = {}) => ({ name_en: "Example Portal", domain: "example.org", homepage: "https://example.org/", protocol: "oidc", redirect_uris: "https://app.example.org/cb", auth_method: "client_secret_basic", subject_type: "public", ...o });

test("console: offer all, only the selected, or all but the selected; the picker follows", async () => {
  const h = await setup({ idps: { good: "idp.example.test", second: "idp2.example.test", third: "idp3.example.test" } });
  h.env.OPERATOR_SUBS = await sha256b64url(`good|${olga.sub}`);
  await h.sync();
  await consoleAs(h, alice);
  const form = await (await h.request("/console/new")).text();
  assert.match(form, /name="idp_mode" value="all" checked/);
  assert.match(form, /class="idp-q"/);
  const none = await post(h, "/console/new", fields({ idp_mode: "only" }));
  assert.equal(none.r.status, 422); assert.match(none.body, /idps_pick/);
  assert.equal(none.body.match(/<li data-code=/g).length, 1, "one reason, not a schema error as well");
  const all = await post(h, "/console/new", fields({ idp_mode: "except", idp_ids: ["good", "second", "third"] }));
  assert.equal(all.r.status, 422); assert.match(all.body, /no identity provider to offer/);
  const c = await post(h, "/console/new", fields({ idp_mode: "except", idp_ids: "good" }));
  const id = /\/console\/app\/(app-[a-z0-9]+)/.exec(c.body)[1];
  const row = await h.db.prepare("SELECT config FROM apps WHERE client_id = ?").bind(id).first();
  assert.deepEqual(JSON.parse(row.config).excluded_idps, ["good"]);
  assert.equal(JSON.parse(row.config).allowed_idps, undefined);
  const edit = await (await h.request(`/console/app/${id}/edit`)).text();
  assert.match(edit, /name="idp_mode" value="except" checked/);
  assert.match(edit, /name="idp_ids" value="good" checked/);
  h.txt["_roamid-app.example.org"] = [`roamid-app=${id}`];
  await post(h, `/console/app/${id}/check`, {});
  const l = await login(h, { client: id, idp: "second", redirectUri: "https://app.example.org/cb", user: alice, pk: await pkce(), pick: false });
  const picker = await l.picker.text();
  assert.ok(picker.includes('id="opt-second"') && picker.includes('id="opt-third"'));
  assert.ok(!picker.includes('id="opt-good"'), "the excluded provider is not offered");
  // Switch to "only": stored as allowed_idps, the exclude list is gone.
  await post(h, `/console/app/${id}/edit`, fields({ idp_mode: "only", idp_ids: "third" }));
  const cfg = JSON.parse((await h.db.prepare("SELECT config FROM apps WHERE client_id = ?").bind(id).first()).config);
  assert.deepEqual([cfg.allowed_idps, cfg.excluded_idps], [["third"], undefined]);
});

test("console: an application on the provider's proven domain may use the provider's name", async () => {
  const h = await setup({ txt: { "_roamid.example.test": ["roamid-idp=good"] } });
  h.registry.idps[0].domain = "example.test";
  await h.sync();
  await consoleAs(h, alice);
  const own = await post(h, "/console/new", fields({ name_en: "IdP good", domain: "example.test", homepage: "https://example.test/", redirect_uris: "https://app.example.test/cb" }));
  assert.ok(/\/console\/app\/app-/.test(own.body), own.body.slice(0, 600));
  const other = await post(h, "/console/new", fields({ name_en: "IdP good" }));
  assert.equal(other.r.status, 422); assert.match(other.body, /name_taken/);
  // The proof disappears: the exemption ends with it (after the grace period).
  h.txt["_roamid.example.test"] = [];
  await h.db.prepare("UPDATE domain_proofs SET failing_since = 1, checked_at = 1 WHERE idp = 'good'").run();
  const lost = await post(h, "/console/new", fields({ name_en: "IdP good", name_zh: "另一个", domain: "example.test", homepage: "https://example.test/", redirect_uris: "https://app2.example.test/cb" }));
  assert.equal(lost.r.status, 422); assert.match(lost.body, /name_taken/);
});

test("scaffold: an identity provider without domain is refused", async () => {
  const { buildIdp } = await import("../scripts/scaffold.mjs");
  const f = { id: "my-idp", name_en: "My IdP", protocol: "oidc", issuer: "https://login.example.org", homepage: "https://example.org/", client_id: "roamid", client_auth: "private_key_jwt", github: "dev", email: "dev@example.org" };
  assert.match(buildIdp(f).errors.join(" "), /domain: required/);
  assert.deepEqual(buildIdp({ ...f, domain: "example.org" }).errors, []);
});
