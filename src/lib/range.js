// Byte ranges for media served from the static assets binding, which itself
// answers every request with the whole file. Safari and some players require
// 206 Partial Content for video. The file lives at /media/<name>; the page
// refers to /video/<name>, which has no static file, so the Worker runs.

import { SIZES } from "../ui/manifest.js";

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

export async function serveAssetWithRange(request, env, sizes = SIZES) {
  const u = new URL(request.url);
  u.pathname = u.pathname.replace(/^\/video\//, "/media/");
  u.search = "";
  const res = await env.ASSETS.fetch(new Request(u.toString(), { method: "GET" }));
  const range = request.headers.get("Range");
  const size = Number(res.headers.get("Content-Length") || sizes[new URL(request.url).pathname]);
  const headers = new Headers(res.headers);
  headers.set("Accept-Ranges", "bytes");
  if (!res.ok || !range || !Number.isFinite(size) || size <= 0) {
    return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, headers });
  }
  const m = RANGE_RE.exec(range.trim());
  let start, end;
  if (m && (m[1] !== "" || m[2] !== "")) {
    if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  }
  if (start === undefined || start > end || start >= size) {
    if (res.body) await res.body.cancel();
    headers.set("Content-Range", `bytes */${size}`);
    headers.delete("Content-Length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  if (request.method === "HEAD") { if (res.body) await res.body.cancel(); return new Response(null, { status: 206, headers }); }
  return new Response(slice(res.body, start, end + 1), { status: 206, headers });
}

// The bytes [from, to) of a stream; stops reading once `to` is reached.
function slice(body, from, to) {
  const reader = body.getReader();
  let pos = 0;
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { ctrl.close(); return; }
        const a = pos, b = pos + value.byteLength;
        pos = b;
        if (b <= from) continue;
        const s = Math.max(0, from - a), e = Math.min(value.byteLength, to - a);
        if (e > s) ctrl.enqueue(value.subarray(s, e));
        if (b >= to) { ctrl.close(); await reader.cancel(); }
        return;
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
