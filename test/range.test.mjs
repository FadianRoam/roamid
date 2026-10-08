// Byte ranges over the static assets binding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serveAssetWithRange } from "../src/lib/range.js";

const data = new Uint8Array(100000).map((_, i) => i % 251);
const env = { ASSETS: { fetch: async () => new Response(new Blob([data]).stream(), { headers: { "Content-Length": String(data.length), "Content-Type": "video/mp4" } }) } };
const get = (range, method = "GET") => serveAssetWithRange(new Request("https://x.test/video/a.mp4", { method, headers: range ? { Range: range } : {} }), env);
// The assets binding streams without Content-Length: the size comes from the manifest.
const envNoLen = { ASSETS: { fetch: async () => new Response(new Blob([data]).stream()) } };

test("size from the manifest when the binding sends no Content-Length", async () => {
  const r = await serveAssetWithRange(new Request("https://x.test/video/a.mp4", { headers: { Range: "bytes=5-9" } }), envNoLen, { "/video/a.mp4": data.length });
  assert.equal(r.status, 206);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), data.subarray(5, 10));
});

test("whole file without Range, with Accept-Ranges", async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Accept-Ranges"), "bytes");
  assert.equal((await r.arrayBuffer()).byteLength, data.length);
});

test("206 with the exact bytes for start-end, open end and suffix ranges", async () => {
  for (const [range, s, e] of [["bytes=0-1", 0, 1], ["bytes=70000-70009", 70000, 70009], ["bytes=99990-", 99990, 99999], ["bytes=-5", 99995, 99999], ["bytes=10-999999", 10, 99999]]) {
    const r = await get(range);
    assert.equal(r.status, 206, range);
    assert.equal(r.headers.get("Content-Range"), `bytes ${s}-${e}/${data.length}`, range);
    const got = new Uint8Array(await r.arrayBuffer());
    assert.deepEqual(got, data.subarray(s, e + 1), range);
  }
});

test("416 for an unsatisfiable range", async () => {
  const r = await get("bytes=200000-");
  assert.equal(r.status, 416);
  assert.equal(r.headers.get("Content-Range"), `bytes */${data.length}`);
});
