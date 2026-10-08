// The automated application review for registry pull requests: the same
// rules as the console (src/apps/checks.js), with data from the live
// instance (console application names, banned domains) and the public block
// lists. Network only; nothing from the pull request is executed.
import { checkApp, proveAppDomain, resolvesPublic, RESERVED } from "../src/apps/checks.js";
import { lookupTxt } from "../src/registry/domains.js";

const LIVE = process.env.ROAMID_URL || "https://id.fadianro.am";
const LISTS = ["https://urlhaus.abuse.ch/downloads/hostfile/", "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt"];

async function blockSet() {
  const set = new Map();
  for (const url of LISTS) {
    try {
      const body = await (await fetch(url, { signal: AbortSignal.timeout(15000) })).text();
      for (const line of body.split("\n")) {
        const l = line.trim();
        if (!l || l.startsWith("#")) continue;
        let h = l.includes("://") ? (() => { try { return new URL(l).hostname; } catch { return ""; } })() : l.split(/\s+/).pop();
        if (h) set.set(h.toLowerCase(), new URL(url).host);
      }
    } catch { /* a list that does not load is skipped */ }
  }
  return set;
}

// entries: changed client entries; doc: the whole registry after the change.
export async function reviewClients(entries, doc) {
  let live = { apps: [], banned_domains: [] };
  try { live = await (await fetch(`${LIVE}/apps.json`, { signal: AbortSignal.timeout(10000) })).json(); } catch { /* offline: registry names only */ }
  const names = [];
  for (const i of doc.idps) for (const n of [i.name.en, i.name.zh]) if (n) names.push({ id: i.id, name: n });
  for (const c of doc.clients) for (const n of [c.name && c.name.en, c.name && c.name.zh]) if (n) names.push({ id: c.client_id, name: n });
  for (const a of live.apps || []) for (const n of [a.name && a.name.en, a.name && a.name.zh]) if (n) names.push({ id: a.client_id, name: n });
  const banned = new Set(live.banned_domains || []);
  const blocks = await blockSet();
  const out = [];
  for (const e of entries) {
    const errors = [];
    if (e.status !== "active") { out.push({ id: e.client_id, errors: [], note: "not active" }); continue; }
    if (!e.domain) errors.push({ code: "domain_missing", field: "domain", message: "a domain is required for automatic review" });
    else {
      const r = await checkApp(e, {
        development: false, names, reserved: RESERVED,
        banned: async (d) => [...banned].some((b) => d === b || d.endsWith(`.${b}`)),
        blocked: async (h) => { const p = h.split("."); for (let i = 0; i < p.length - 1; i++) { const s = blocks.get(p.slice(i).join(".")); if (s) return s; } return null; },
        resolves: (h) => resolvesPublic(h),
      });
      errors.push(...r.errors);
      if (!errors.length) {
        const p = await proveAppDomain(e.domain, e.client_id, { lookupTxt });
        if (!p.ok) errors.push({ code: "domain_unproven", field: "domain", message: p.error });
      }
    }
    out.push({ id: e.client_id, errors });
  }
  return out;
}
