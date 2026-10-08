// The automated application review for registry pull requests: the same
// rules as the console (src/apps/checks.js), with data from the live
// instance (console application names, banned domains) and the public block
// lists. Network only; nothing from the pull request is executed.
//
// Fails closed: when the live data or a block list cannot be loaded, the
// verdict is { temporary: true } and nothing is merged in this run.
import { checkApp, proveAppDomain, resolvesPublic, RESERVED } from "../src/apps/checks.js";
import { lookupTxt as dohTxt } from "../src/registry/domains.js";

const LIVE = process.env.ROAMID_URL || "https://id.fadianro.am";
export const LISTS = ["https://urlhaus.abuse.ch/downloads/hostfile/", "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt"];

async function blockSet(fetchFn) {
  const set = new Map();
  for (const url of LISTS) {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const body = await r.text();
    for (const line of body.split("\n")) {
      const l = line.trim();
      if (!l || l.startsWith("#")) continue;
      const h = l.includes("://") ? (() => { try { return new URL(l).hostname; } catch { return ""; } })() : l.split(/\s+/).pop();
      if (h) set.set(h.toLowerCase(), new URL(url).host);
    }
  }
  return set;
}

// entries: changed client entries; doc: the whole registry after the change.
// Returns { temporary, reason } or { results: [{ id, errors }] }.
export async function reviewClients(entries, doc, { fetchFn = fetch, lookupTxt = dohTxt } = {}) {
  let live, blocks;
  try {
    const r = await fetchFn(`${LIVE}/apps.json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    live = await r.json();
    if (!live || !Array.isArray(live.apps) || !Array.isArray(live.banned_domains)) throw new Error("malformed");
  } catch (e) { return { temporary: true, reason: `${LIVE}/apps.json could not be loaded (${e.message})` }; }
  try { blocks = await blockSet(fetchFn); } catch (e) { return { temporary: true, reason: `a block list could not be loaded (${e.message})` }; }
  const names = [];
  for (const i of doc.idps) for (const n of [i.name && i.name.en, i.name && i.name.zh]) if (n) names.push({ id: i.id, name: n });
  for (const c of doc.clients) for (const n of [c.name && c.name.en, c.name && c.name.zh]) if (n) names.push({ id: c.client_id, name: n });
  for (const a of live.apps) for (const n of [a.name && a.name.en, a.name && a.name.zh]) if (n) names.push({ id: a.client_id, name: n });
  const banned = new Set(live.banned_domains);
  const results = [];
  for (const e of entries) {
    const errors = [];
    // Pull requests register active or disabled entries; development mode is console-only.
    if (!["active", "disabled"].includes(e.status)) errors.push({ code: "status", field: "status", message: "a registry entry is active or disabled (development mode exists only in the console)" });
    if (!e.domain) errors.push({ code: "domain_missing", field: "domain", message: "a domain is required for automatic review" });
    else {
      const r = await checkApp(e, {
        development: false, names, reserved: RESERVED,
        banned: async (d) => [...banned].some((b) => d === b || d.endsWith(`.${b}`)),
        blocked: async (h) => { const p = h.split("."); for (let i = 0; i < p.length - 1; i++) { const s = blocks.get(p.slice(i).join(".")); if (s) return s; } return null; },
        resolves: (h) => resolvesPublic(h, { fetchFn }),
      });
      errors.push(...r.errors);
      // A disabled entry is not offered for sign-in: the domain proof may be skipped.
      if (!errors.length && e.status === "active") {
        const p = await proveAppDomain(e.domain, e.client_id, { lookupTxt, fetchFn });
        if (!p.ok) errors.push({ code: "domain_unproven", field: "domain", message: p.error });
      }
    }
    results.push({ id: e.client_id, errors });
  }
  return { results };
}
