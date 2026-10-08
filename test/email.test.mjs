// The email trust model: email_verified and email_authority.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, login, exchange, pkce } from "./_harness.mjs";
import { GRACE } from "../src/registry/domains.js";

async function claimsFor(h, idp, user) {
  const pk = await pkce();
  const r = await login(h, { pk, idp, user, params: { idp_hint: idp } });
  const x = await exchange(h, { code: r.code, verifier: pk.verifier });
  return JSON.parse(Buffer.from(x.body.id_token.split(".")[1], "base64url"));
}

async function trustSetup() {
  const h = await setup({ idps: { good: "idp.example.test", evil: "evil.example.test" }, txt: { "_roamid.lab.yunzheng.space": ["roamid-idp=good"], "_roamid.yunzheng.space": ["v=spf1 -all", "roamid-idp=good"] } });
  h.registry.idps[0].email_domains = ["lab.yunzheng.space", "yunzheng.space"];
  await h.sync();
  return h;
}

test("authoritative domain and upstream verified: email_verified true", async () => {
  const h = await trustSetup();
  const c = await claimsFor(h, "good", { sub: "u1", email: "lemon@lab.yunzheng.space", email_verified: true, name: "Lemon" });
  assert.equal(c.email, "lemon@lab.yunzheng.space");
  assert.equal(c.email_authority, "authoritative");
  assert.equal(c.email_verified, true);
  assert.equal(c.idp, "good");
  const s = await (await h.request("/status.json")).json();
  assert.deepEqual(s.domains.map((d) => `${d.domain}:${d.state}`).sort(), ["lab.yunzheng.space:verified", "yunzheng.space:verified"]);
});

test("a foreign domain is passed through as asserted, not verified", async () => {
  const h = await trustSetup();
  const c = await claimsFor(h, "good", { sub: "u2", email: "someone@gmail.com", email_verified: true });
  assert.equal(c.email, "someone@gmail.com");
  assert.equal(c.email_authority, "asserted");
  assert.equal(c.email_verified, false);
  const sub = await claimsFor(h, "good", { sub: "u3", email: "x@sub.lab.yunzheng.space", email_verified: true });
  assert.equal(sub.email_authority, "asserted", "a subdomain needs a *. declaration");
});

test("upstream unverified: email_verified false even on an authoritative domain", async () => {
  const h = await trustSetup();
  const c = await claimsFor(h, "good", { sub: "u4", email: "lemon@lab.yunzheng.space", email_verified: false });
  assert.equal(c.email_authority, "asserted");
  assert.equal(c.email_verified, false);
});

test("an attacker IdP asserting someone else's address gets asserted", async () => {
  const h = await trustSetup();
  const c = await claimsFor(h, "evil", { sub: "attacker", email: "lemon@lab.yunzheng.space", email_verified: true });
  assert.equal(c.email, "lemon@lab.yunzheng.space");
  assert.equal(c.email_authority, "asserted");
  assert.equal(c.email_verified, false);
  assert.equal(c.idp, "evil");
});

test("a declared domain without its TXT record is not authoritative", async () => {
  const h = await trustSetup();
  h.registry.idps[1].email_domains = ["evil.example.org"];
  h.registry.commit = "b".repeat(40);
  await h.sync();
  const c = await claimsFor(h, "evil", { sub: "e1", email: "a@evil.example.org", email_verified: true });
  assert.equal(c.email_authority, "asserted");
});

test("TXT removed: authority is kept for the grace period, then lost", async () => {
  const h = await trustSetup();
  delete h.txt["_roamid.lab.yunzheng.space"];
  // the daily re-check comes round
  await h.db.prepare("UPDATE domain_proofs SET checked_at = checked_at - 90000").run();
  await h.sync();
  let s = await (await h.request("/status.json")).json();
  assert.equal(s.domains.find((d) => d.domain === "lab.yunzheng.space").state, "grace");
  let c = await claimsFor(h, "good", { sub: "u5", email: "lemon@lab.yunzheng.space", email_verified: true });
  assert.equal(c.email_authority, "authoritative", "still inside the grace period");
  await h.db.prepare("UPDATE domain_proofs SET failing_since = failing_since - ? WHERE domain = 'lab.yunzheng.space'").bind(GRACE + 1).run();
  s = await (await h.request("/status.json")).json();
  assert.equal(s.domains.find((d) => d.domain === "lab.yunzheng.space").state, "lost");
  c = await claimsFor(h, "good", { sub: "u5", email: "lemon@lab.yunzheng.space", email_verified: true });
  assert.equal(c.email_authority, "asserted");
  assert.equal(c.email_verified, false);
  // the record comes back: authority returns on the next check
  h.txt["_roamid.lab.yunzheng.space"] = ["roamid-idp=good"];
  await h.db.prepare("UPDATE domain_proofs SET checked_at = checked_at - 1000").run();
  await h.sync();
  c = await claimsFor(h, "good", { sub: "u5", email: "lemon@lab.yunzheng.space", email_verified: true });
  assert.equal(c.email_authority, "authoritative");
});
