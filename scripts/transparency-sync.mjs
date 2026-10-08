#!/usr/bin/env node
// Mirror the public record of the RoamID instance into this repository
// (workflow transparency.yml): transparency/YYYY/MM.json and MM.md from the
// operator decisions, and one GitHub issue (label report-upheld) per report
// the operator published. The JSON is data: every value is escaped before it
// is written into Markdown or an issue; nothing in it is executed.
import { githubApi } from "./automerge.mjs";

const LIVE = process.env.ROAMID_URL || "https://id.fadianro.am";
const REPO = process.env.GITHUB_REPOSITORY || "FadianRoam/roamid";
const MARK = (id) => `<!-- roamid-publication:${id} -->`;

// One line of text for Markdown: no markup, no HTML, no mentions, no table breaks.
export function md(s, max = 300) {
  return String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, (c) => (c === "<" ? "\u2039" : "\u203a")).replace(/[\\`*_[\]|#~]/g, (c) => `\\${c}`).replace(/@/g, "@​").replace(/https?:\/\//gi, (m) => m.replace("http", "hxxp")).slice(0, max);
}

export async function fetchAll(kind, fetchFn = fetch) {
  const out = [];
  let after = 0;
  for (let i = 0; i < 100; i++) {
    const r = await fetchFn(`${LIVE}/transparency.json?kind=${kind}&after=${after}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`transparency.json: HTTP ${r.status}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.items)) throw new Error("transparency.json: malformed");
    out.push(...j.items.filter((x) => x && Number.isInteger(x.id)));
    if (!j.next_after) break;
    after = j.next_after;
  }
  return out;
}

const DECISION = { warn: "Warning", suspend: "Suspended", ban: "Banned", restore: "Restored", idp_disable: "Identity provider disabled by the operator", idp_enable: "Operator override removed" };

export function renderMonth(month, items) {
  const rows = items.map((d) => `| ${md(d.id)} | ${md(d.date.slice(0, 10))} | ${md(d.target_kind)} \`${md(d.target_id, 64)}\` | ${md(d.domain || "-")} | ${md(d.category)} | ${md(DECISION[d.decision] || d.decision)} | ${md(d.reason)}${d.withdrawn ? ` (withdrawn: ${md(d.withdrawn)})` : ""} |`).join("\n");
  return `# Operator decisions, ${month}\n\nPublished from ${LIVE}/transparency.json. No reporter data and no operator identifiers. Appeal: https://github.com/${REPO}/issues/new?template=appeal.yml or from the developer console.\n\n| Record | Date (UTC) | Target | Domain | Category | Decision | Reason |\n|---|---|---|---|---|---|---|\n${rows}\n`;
}

export function issueFor(p, decisions) {
  const d = decisions.find((x) => x.id === p.decision_id);
  return {
    title: `Report: ${String(p.category).replace(/[^\w -]/g, "")} — ${String(p.target_id).replace(/[^a-z0-9-]/g, "")}`.slice(0, 120),
    body: `${MARK(p.id)}\n**Published report** (${md(p.date.slice(0, 10))}, UTC)\n\n- Target: ${md(p.target_kind)} \`${md(p.target_id, 64)}\`\n- Category: ${md(p.category)}\n- Decision: ${d ? `${md(DECISION[d.decision] || d.decision)} (record ${md(d.id)}, transparency/${d.date.slice(0, 4)}/${d.date.slice(5, 7)}.md)` : "-"}\n\n> ${md(p.text, 4000)}\n\nThe reporter's contact details are never published. Appeal: https://github.com/${REPO}/issues/new?template=appeal.yml`,
  };
}

export async function sync({ api, fetchFn = fetch, log = console.log }) {
  const decisions = await fetchAll("decisions", fetchFn);
  const pubs = await fetchAll("publications", fetchFn);
  const byMonth = new Map();
  for (const d of decisions) { const m = String(d.date).slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) (byMonth.get(m) || byMonth.set(m, []).get(m)).push(d); }
  for (const [m, items] of byMonth) {
    const [y, mo] = m.split("-");
    for (const [path, content] of [[`transparency/${y}/${mo}.json`, JSON.stringify(items, null, 2) + "\n"], [`transparency/${y}/${mo}.md`, renderMonth(m, items)]]) {
      const cur = await api(`/contents/${path}?ref=main`).catch(() => null);
      const old = cur ? Buffer.from(cur.content, "base64").toString("utf8") : null;
      if (old === content) continue;
      await api(`/contents/${path}`, { method: "PUT", body: { message: "update", content: Buffer.from(content).toString("base64"), branch: "main", ...(cur ? { sha: cur.sha } : {}) } });
      log(`wrote ${path}`);
    }
  }
  const existing = await api("/issues?labels=report-upheld&state=all&per_page=100");
  for (const p of pubs) {
    const found = existing.find((i) => (i.body || "").includes(MARK(p.id)));
    if (!found && !p.withdrawn) {
      const { title, body } = issueFor(p, decisions);
      const i = await api("/issues", { method: "POST", body: { title, body, labels: ["report-upheld"] } });
      log(`issue #${i.number} for publication ${p.id}`);
    } else if (found && p.withdrawn && found.state === "open") {
      await api(`/issues/${found.number}/comments`, { method: "POST", body: { body: `Withdrawn: ${md(p.withdrawn)}` } });
      await api(`/issues/${found.number}`, { method: "PATCH", body: { state: "closed" } });
      log(`closed #${found.number} (withdrawn)`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await sync({ api: githubApi(REPO, process.env.GITHUB_TOKEN) });
