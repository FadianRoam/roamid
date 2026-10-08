// /docs and /docs/<slug> (and /zh/...): the Markdown documents of the
// repository, rendered at build time by scripts/build-docs.mjs. The files on
// GitHub stay the source; each page links to its file.

import { DOCS } from "./docs-content.js";
import { contentPage, esc } from "./pages.js";
import { ASSETS } from "./manifest.js";
import { href, docDesc } from "./seo.js";

export const docBySlug = (slug) => DOCS.find((d) => d.slug === slug) || null;

const L = {
  en: { docs: "Documentation", lead: "Specifications and guides for applications, identity providers and operators. The source of each document is in the RoamID repository on GitHub.", updated: "Updated", source: "Source on GitHub", english: "English" },
  zh: { docs: "文档", lead: "面向应用、身份提供方与运营者的规范与指南。每篇文档的源文件都在 GitHub 上的 RoamID 仓库中。", updated: "更新于", source: "在 GitHub 上查看源文件", english: "英文" },
};
const css = `\n<link rel="stylesheet" href="${ASSETS["docs.css"]}">`;

export function docsIndexPage({ lang, theme, path }) {
  const s = L[lang] || L.en;
  const items = DOCS.map((d) => {
    const l = lang === "zh" && d.zh ? "zh" : "en";
    const x = d[l];
    const tag = lang === "zh" && !d.zh ? ` <span class="badge">${esc(s.english)}</span>` : "";
    return `<li><a href="${esc(href(lang, `/docs/${d.slug}`))}"><b>${esc(x.title)}</b>${tag}</a><span>${esc(docDesc(d, l))}</span></li>`;
  }).join("");
  const body = `<h1 class="title">${esc(s.docs)}</h1><p class="lead">${esc(s.lead)}</p><ul class="doclist">${items}</ul>`;
  return contentPage({ lang, theme, path, active: "docs", title: s.docs, body, head: css });
}

export function docPage({ lang, theme, path, doc }) {
  const s = L[lang] || L.en;
  const x = (lang === "zh" && doc.zh) || doc.en;
  const body = `<nav class="crumbs" aria-label="${lang === "zh" ? "位置" : "Breadcrumb"}"><a href="${esc(href(lang, "/docs"))}">${esc(s.docs)}</a></nav>
<article class="prose">${x.html}</article>
<p class="doc-meta">${x.updated ? `${esc(s.updated)} <time datetime="${esc(x.updated)}">${esc(x.updated)}</time> · ` : ""}<a href="${esc(x.source)}">${esc(s.source)}</a></p>`;
  return contentPage({ lang, theme, path, active: "docs", title: x.title, body, head: css });
}
