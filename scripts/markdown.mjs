// A small Markdown renderer for the documents in docs/ (headings, paragraphs,
// lists, fenced code, tables, block quotes, links, code spans, emphasis).
// Every piece of text is escaped: raw HTML in a document is shown as text.
// Used at build time by scripts/build-docs.mjs; the Worker serves the result.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// GitHub's heading anchors: lower case, punctuation dropped, spaces to "-".
export function slugify(text) {
  return text.toLowerCase().trim().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}
const plain = (md) => md.replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");

// Inline markup. `link(href)` maps a Markdown link target to the URL to use.
export function inline(md, link) {
  const out = [];
  let rest = md;
  const re = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])/;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) { out.push(esc(rest)); break; }
    out.push(esc(rest.slice(0, m.index)));
    if (m[1] !== undefined) out.push(`<code>${esc(m[1])}</code>`);
    else if (m[2] !== undefined) out.push(`<a href="${esc(link(m[3]))}">${inline(m[2], link)}</a>`);
    else if (m[4] !== undefined) out.push(`<a href="${esc(m[4])}">${esc(m[4])}</a>`);
    else if (m[5] !== undefined) out.push(`<strong>${inline(m[5], link)}</strong>`);
    else out.push(`<em>${inline(m[6], link)}</em>`);
    rest = rest.slice(m.index + m[0].length);
  }
  return out.join("");
}

const fenceRe = /^(\s*)(```+|~~~+)\s*([\w+-]*)\s*$/;
const listRe = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;

// Renders blocks. `ctx` carries the link mapper, the heading state (one h1,
// no skipped level) and the ids already used.
function blocks(lines, ctx) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const f = fenceRe.exec(line);
    if (f) {
      const body = [];
      const pad = f[1].length;
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${f[2][0]}{${f[2].length},}\\s*$`).test(lines[i])) { body.push(lines[i].slice(Math.min(pad, indentOf(lines[i])))); i++; }
      i++;
      out.push(`<pre><code${f[3] ? ` class="language-${esc(f[3])}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      let level = h[1].length;
      if (level === 1 && ctx.h1) level = 2;
      if (level > ctx.last + 1) level = ctx.last + 1;
      if (level === 1) { ctx.h1 = true; ctx.title = plain(h[2]); }
      ctx.last = level;
      let id = slugify(plain(h[2])) || "section";
      if (ctx.ids.has(id)) { let n = 1; while (ctx.ids.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
      ctx.ids.add(id);
      out.push(level === 1 ? `<h1 class="title" id="${esc(id)}">${inline(h[2], ctx.link)}</h1>` : `<h${level} id="${esc(id)}">${inline(h[2], ctx.link)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${blocks(q, ctx)}</blockquote>`);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : ""));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rows.push(cells(lines[i])); i++; }
      const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inline(c, ctx.link)}</${tag}>`;
      out.push(`<div class="scroll"><table class="tbl"><thead><tr>${head.map((c, k) => td("th", c, k)).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => td("td", r[k] || "", k)).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const lm = listRe.exec(line);
    if (lm) {
      const base = indentOf(line);
      const ordered = /\d/.test(lm[2]);
      const start = ordered ? parseInt(lm[2], 10) : 1;
      const items = [];
      let loose = false;
      while (i < lines.length) {
        const m = listRe.exec(lines[i]);
        if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
        const contentIndent = base + m[2].length + 1;
        const item = [m[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            const next = lines.slice(i + 1).find((x) => x.trim());
            if (next === undefined || indentOf(next) < contentIndent) {
              if (next !== undefined && listRe.test(next) && indentOf(next) === base) loose = true;
              break;
            }
            item.push(""); i++; continue;
          }
          if (indentOf(l) < contentIndent && (listRe.test(l) || fenceRe.test(l) || /^\s*(#|>|\|)/.test(l) || indentOf(l) <= base)) break;
          item.push(l.slice(Math.min(contentIndent, indentOf(l)))); i++;
        }
        items.push(item);
        while (i < lines.length && !lines[i].trim()) i++;
        if (i < lines.length && !(listRe.test(lines[i]) && indentOf(lines[i]) === base)) break;
      }
      const li = items.map((it) => {
        let inner = blocks(it, ctx);
        if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, "$1");
        return `<li>${inner}</li>`;
      }).join("");
      out.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ""}>${li}</ol>` : `<ul>${li}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !fenceRe.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(para.length && listRe.test(lines[i])) && !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) { para.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(para.join(" ").replace(/\s{2,}/g, " "), ctx.link)}</p>`);
  }
  return out.join("\n");
}

// Renders a document. Returns { title, html, description } where the
// description is the first paragraph as plain text.
export function render(md, { link = (h) => h, drop = () => false } = {}) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  // Paragraphs the caller drops (the "English / 中文" line of each document).
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const prevBlank = i === 0 || !lines[i - 1].trim(), nextBlank = i === lines.length - 1 || !lines[i + 1].trim();
    if (prevBlank && nextBlank && lines[i].trim() && drop(lines[i].trim())) continue;
    kept.push(lines[i]);
  }
  const ctx = { link, h1: false, last: 1, ids: new Set(), title: "" };
  const html = blocks(kept, ctx);
  const first = /<p>([\s\S]*?)<\/p>/.exec(html);
  const description = first ? first[1].replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim() : "";
  return { title: ctx.title, html, description };
}
