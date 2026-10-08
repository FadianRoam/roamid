// The public record: operator decisions and published reports.
//   GET /transparency.json?after=<n>   (decisions and publications with id > n, 200 at a time)
// Never contains reporter data (contact, address hash, sign-in context) or
// operator identifiers.

import { json, now } from "../lib/http.js";

// Text from a report made safe to publish: email addresses and phone
// numbers removed; URLs, domain names and IP addresses defanged.
export function redactReportText(s) {
  let t = String(s || "").replace(/\r/g, "");
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email removed]");
  t = t.replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, (u) => u.replace(/^http/i, "hxxp").replace(/\./g, "[.]"));
  t = t.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, "$1[.]$2[.]$3[.]$4");
  t = t.replace(/(?<![\w.[\]])\+?\d[\d\s()-]{6,}\d(?!\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone removed]" : m));
  t = t.replace(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi, (d) => (d.includes("[.]") ? d : d.replace(/\./g, "[.]")));
  return t.slice(0, 4000);
}

export const PUBLIC_DECISIONS = new Set(["warn", "suspend", "ban", "restore", "idp_disable", "idp_enable"]);

export async function recordDecision(env, { kind, id, domain, decision, reason }) {
  if (!PUBLIC_DECISIONS.has(decision)) return null;
  const cat = await env.DB.prepare("SELECT category, COUNT(*) AS n FROM reports WHERE target_kind = ? AND target_id = ? AND kind = 'report' AND created_at > ? GROUP BY category ORDER BY n DESC LIMIT 1")
    .bind(kind, id, now() - 30 * 86400).first();
  const r = await env.DB.prepare("INSERT INTO decisions (at, target_kind, target_id, domain, category, decision, reason) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(now(), kind, id, domain || null, cat ? cat.category : "none", decision, String(reason || "").replace(/[\r\n]+/g, " ").slice(0, 300)).run();
  return r.meta && r.meta.last_row_id;
}

export async function transparencyJson(env, url) {
  const after = Math.max(0, Number(url.searchParams.get("after") || 0) | 0);
  const kind = url.searchParams.get("kind") === "publications" ? "publications" : "decisions";
  const iso = (s) => new Date(s * 1000).toISOString();
  let items;
  if (kind === "decisions") {
    const { results } = await env.DB.prepare("SELECT id, at, target_kind, target_id, domain, category, decision, reason, withdrawn FROM decisions WHERE id > ? ORDER BY id LIMIT 200").bind(after).all();
    items = (results || []).map((r) => ({ id: r.id, date: iso(r.at), target_kind: r.target_kind, target_id: r.target_id, domain: r.domain, category: r.category, decision: r.decision, reason: r.reason, ...(r.withdrawn ? { withdrawn: r.withdrawn } : {}) }));
  } else {
    const { results } = await env.DB.prepare("SELECT id, at, decision_id, target_kind, target_id, category, text, withdrawn FROM publications WHERE id > ? ORDER BY id LIMIT 200").bind(after).all();
    items = (results || []).map((r) => ({ id: r.id, date: iso(r.at), decision_id: r.decision_id, target_kind: r.target_kind, target_id: r.target_id, category: r.category, text: r.text, ...(r.withdrawn ? { withdrawn: r.withdrawn } : {}) }));
  }
  const next = items.length === 200 ? items[items.length - 1].id : null;
  return json({ kind, items, next_after: next }, { cache: "public, max-age=60", cors: true });
}
