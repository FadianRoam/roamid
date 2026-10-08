// The Orbit Shield origin signature and the visitor address it restores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { clientIp } from "../src/lib/edgesig.js";

const env = { BASE_URL: "https://id.example.test", CDN_KEY: "k".repeat(32) };
const sig = (ip, ts, method = "GET", host = "id.example.test", key = env.CDN_KEY) =>
  `v1;ts=${ts};ip=${ip};mac=${createHmac("sha256", key).update(`v1|${host}|${ip}|${ts}|${method}`).digest("hex")}`;
const req = (h) => new Request("https://origin.example.test/authorize", { headers: { "CF-Connecting-IP": "198.51.100.9", ...h } });

test("a valid signature restores the visitor address", async () => {
  const ts = Math.floor(Date.now() / 1000);
  assert.equal(await clientIp(req({ "X-Orbit-Origin-Sig": sig("203.0.113.5", ts), "X-Forwarded-Host": "id.example.test" }), env), "203.0.113.5");
});

test("a bad, stale or foreign-host signature changes nothing", async () => {
  const ts = Math.floor(Date.now() / 1000);
  assert.equal(await clientIp(req({ "X-Orbit-Origin-Sig": sig("203.0.113.5", ts, "GET", "id.example.test", "wrong"), "X-Forwarded-Host": "id.example.test" }), env), "198.51.100.9");
  assert.equal(await clientIp(req({ "X-Orbit-Origin-Sig": sig("203.0.113.5", ts - 120), "X-Forwarded-Host": "id.example.test" }), env), "198.51.100.9");
  assert.equal(await clientIp(req({ "X-Orbit-Origin-Sig": sig("203.0.113.5", ts, "GET", "other.example.test"), "X-Forwarded-Host": "other.example.test" }), env), "198.51.100.9");
  assert.equal(await clientIp(req({ "X-Orbit-Origin-Sig": sig("203.0.113.5", ts, "POST"), "X-Forwarded-Host": "id.example.test" }), env), "198.51.100.9");
});
