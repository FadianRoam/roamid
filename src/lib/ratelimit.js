// Fixed-window rate limits in D1, per visitor address and per client.
// The key is a hash of the address, never the address itself.

import { sha256b64url } from "./b64.js";
import { now } from "./http.js";

export const LIMITS = {
  authorize: { n: 60, win: 60 },    // /authorize, /select, /callback, /test
  token: { n: 120, win: 60 },       // /token per address
  client: { n: 600, win: 60 },      // /token per client_id
  userinfo: { n: 300, win: 60 },
  admin: { n: 10, win: 60 },
  console: { n: 30, win: 60 },     // console form posts per person
  report: { n: 5, win: 3600 },     // reports per address per hour
};

// true when the request may proceed.
export async function allow(env, bucket, subject) {
  const lim = LIMITS[bucket];
  if (!lim || !subject) return true;
  const t = now();
  const win = Math.floor(t / lim.win);
  const k = `${bucket}:${(await sha256b64url(`${bucket}|${subject}`)).slice(0, 22)}:${win}`;
  try {
    const row = await env.DB.prepare(
      "INSERT INTO ratelimit (k, n, expires) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n",
    ).bind(k, (win + 1) * lim.win + 5).first();
    return !row || row.n <= lim.n;
  } catch (e) {
    console.error("[ratelimit]", e && e.message);
    return true; // a counter failure must not stop sign-in
  }
}
