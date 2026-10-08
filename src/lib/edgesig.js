// Signed origin header from the Orbit Shield edge in front of this Worker.
//
// The public name is served by Orbit Shield, which pulls from the Worker's
// own origin name. Cloudflare therefore reports the edge node as the client.
// The edge adds
//
//   X-Orbit-Origin-Sig: v1;ts=<unix>;ip=<visitor>;mac=<hex>
//   mac = HMAC-SHA256(key, "v1|" + public host + "|" + ip + "|" + ts + "|" + METHOD)
//
// (v2 adds country, ASN, region, city and organisation after METHOD; only the
// address is used here). When the signature verifies within 60 seconds and
// X-Forwarded-Host is the public host, CF-Connecting-IP is replaced by the
// visitor's address. Otherwise the request is left unchanged. The key is the
// Worker secret CDN_KEY.

export const SIG_HEADER = "X-Orbit-Origin-Sig";
export const MAX_SKEW = 60;
const enc = new TextEncoder();

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function eqConst(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifiedVisitor(header, { key, host, method, now = Date.now() }) {
  if (!key || !header) return "";
  const parts = String(header).split(";");
  const v = parts[0];
  if (!((v === "v1" && parts.length === 4) || (v === "v2" && parts.length === 9))) return "";
  const f = {};
  for (const p of parts.slice(1)) { const i = p.indexOf("="); if (i > 0) f[p.slice(0, i)] = p.slice(i + 1); }
  if (!/^\d{1,12}$/.test(f.ts || "") || !/^[0-9a-f]{64}$/.test(f.mac || "")) return "";
  if (!/^[0-9a-fA-F.:]{2,45}$/.test(f.ip || "")) return "";
  if (Math.abs(Math.floor(now / 1000) - Number(f.ts)) > MAX_SKEW) return "";
  let msg = `v1|${host}|${f.ip}|${f.ts}|${String(method).toUpperCase()}`;
  if (v === "v2") {
    for (const k of ["cc", "asn", "rg", "city", "org"]) if (typeof f[k] !== "string") return "";
    msg = `v2|${host}|${f.ip}|${f.ts}|${String(method).toUpperCase()}|${f.cc}|${f.asn}|${f.rg}|${f.city}|${f.org}`;
  }
  return eqConst(await hmacHex(key, msg), f.mac) ? f.ip : "";
}

// The visitor's address for rate limiting.
export async function clientIp(request, env, { now } = {}) {
  const direct = request.headers.get("CF-Connecting-IP") || "";
  const sig = request.headers.get(SIG_HEADER);
  if (!sig) return direct;
  const host = new URL(env.BASE_URL).host;
  const fwd = String(request.headers.get("X-Forwarded-Host") || "").trim().toLowerCase();
  if (fwd !== host) return direct;
  const ip = await verifiedVisitor(sig, { key: env.CDN_KEY, host, method: request.method, now: now ?? Date.now() });
  return ip || direct;
}
