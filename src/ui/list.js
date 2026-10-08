// The identity provider lists (picker and /idps): search text, order and
// groups. Shared by the pages and the tests; the browser normalises the
// query with the same rules (assets/roamid.js).

import { localName } from "./i18n.js";

// Case-, accent- and width-insensitive: NFKC (full-width to ASCII), NFKD
// without combining marks, lower case, single spaces. Pinyin initials for
// Chinese names are not supported (it needs a dictionary).
export const norm = (s) => String(s ?? "").normalize("NFKC").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };
export const idpHost = (i) => hostOf(i.issuer || i.sso_url || i.metadata_url || i.entity_id);

// Everything a person may type to find a provider.
export const searchText = (i) => norm([i.name && i.name.en, i.name && i.name.zh, i.id, idpHost(i), ...(i.email_domains || [])].filter(Boolean).join(" "));

const DOWN = new Set(["down"]);
const domainMatches = (i, hint) => {
  const d = String(hint || "").split("@")[1];
  if (!d) return false;
  const dom = d.toLowerCase();
  return (i.email_domains || []).some((x) => { const b = x.replace(/^\*\./, ""); return dom === b || (x.startsWith("*.") && dom.endsWith(`.${b}`)); });
};

// Picker order: the last used provider, then providers whose email domains
// match the login_hint, then the rest by name in the page language. Providers
// that are down go to the end (in the same order) and are marked.
export function orderIdps(idps, { lang = "en", last = null, hint = null, health = {} } = {}) {
  const coll = new Intl.Collator(lang === "zh" ? "zh-Hans-CN" : "en", { sensitivity: "base", numeric: true });
  const rank = (i) => (i.id === last ? 0 : domainMatches(i, hint) ? 1 : 2);
  return [...idps].sort((a, b) => (DOWN.has(health[a.id]) - DOWN.has(health[b.id])) || (rank(a) - rank(b)) || coll.compare(localName(a, lang), localName(b, lang)) || (a.id < b.id ? -1 : 1));
}

// How many rows the picker shows before "Show all".
export const PICKER_TOP = 6;
export function pickerSplit(ordered, { last = null, hint = null } = {}) {
  const lead = ordered.filter((i) => i.id === last || domainMatches(i, hint)).length;
  const n = Math.max(PICKER_TOP, Math.min(lead, 12));
  return ordered.length <= n + 1 ? { top: ordered, rest: [] } : { top: ordered.slice(0, n), rest: ordered.slice(n) };
}

// /idps: sections by protocol; inside, sorted by name, recently added or status.
const STATUS_RANK = { up: 0, degraded: 1, unknown: 2, down: 3, disabled: 4 };
export const stateOf = (i, health) => (i.status === "disabled" ? "disabled" : ["up", "degraded", "down"].includes(health[i.id]) ? health[i.id] : "unknown");
export function sortIdps(idps, { by = "name", lang = "en", health = {}, added = {} } = {}) {
  const coll = new Intl.Collator(lang === "zh" ? "zh-Hans-CN" : "en", { sensitivity: "base", numeric: true });
  const name = (a, b) => coll.compare(localName(a, lang), localName(b, lang)) || (a.id < b.id ? -1 : 1);
  if (by === "added") return [...idps].sort((a, b) => (added[b.id] || 0) - (added[a.id] || 0) || name(a, b));
  if (by === "status") return [...idps].sort((a, b) => STATUS_RANK[stateOf(a, health)] - STATUS_RANK[stateOf(b, health)] || name(a, b));
  return [...idps].sort(name);
}
export function groupIdps(idps) {
  const groups = [{ key: "oidc", items: [] }, { key: "saml2", items: [] }];
  for (const i of idps) groups[i.protocol === "saml2" ? 1 : 0].items.push(i);
  return groups.filter((g) => g.items.length);
}
