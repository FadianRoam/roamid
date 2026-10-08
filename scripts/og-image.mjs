#!/usr/bin/env node
// The 1200x630 social preview images (assets/og-en.png, assets/og-zh.png),
// drawn from an HTML template with the page font, the band poster and a
// picker card, and captured with a local headless Chrome:
//   node scripts/og-image.mjs [path-to-chrome]
// The output is committed; run this only when the picture should change.
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { t } from "../src/ui/i18n.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = process.argv[2] || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const asset = (n) => pathToFileURL(join(root, "assets", n)).href;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MARK = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none"><circle cx="12" cy="12" r="8.2" stroke="#38c6ec" stroke-width="2.6"/><circle cx="18.6" cy="6.9" r="3" fill="#38c6ec"/></svg>';
const SEARCH = '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2l4.3 4.3"/></svg>';

const page = (lang) => `<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><style>
@font-face{font-family:Figtree;font-weight:300 900;src:url(${asset("fonts/figtree-latin.woff2")}) format("woff2")}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#fff;color:#000;-webkit-font-smoothing:antialiased}
body{font-family:Figtree,"PingFang SC","Hiragino Sans GB",sans-serif;position:relative}
.brand{position:absolute;top:34px;left:44px;display:flex;align-items:center;gap:10px;font-weight:577;font-size:30px;letter-spacing:-0.03em}
.url{position:absolute;top:42px;right:44px;font-size:20px;color:#6b6b6b;letter-spacing:-0.008em}
h1{position:absolute;top:104px;left:0;right:0;text-align:center;font-weight:577;font-size:${lang === "zh" ? 52 : 54}px;line-height:1.12;letter-spacing:${lang === "zh" ? "-0.01em" : "-0.0572em"}}
h1 span{display:block}
.band{position:absolute;left:0;right:0;top:300px;bottom:0;background:#0db5ed url(${asset("poster.webp")}) center top/cover}
.card{position:absolute;top:262px;left:300px;width:600px;background:#f2f2f2;border-radius:16px;padding:20px;box-shadow:0 0 0 1px rgba(255,255,255,.9),0 24px 60px -12px rgba(0,0,0,.28),0 8px 18px -8px rgba(0,0,0,.18)}
.ctx{display:flex;align-items:baseline;gap:8px;font-size:14px;color:#6b6b6b;margin-bottom:12px}
.ctx b{color:#000;font-weight:511;font-size:16px}.ctx .h{font:12.5px ui-monospace,Menlo,monospace}
.search{display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px #ededed;color:#6b6b6b;font-size:16px}
.rows{margin-top:10px;background:#fff;border-radius:12px;overflow:hidden}
.row{display:flex;align-items:center;gap:12px;min-height:58px;padding:9px 14px;border-top:1px solid #ededed}.row:first-child{border-top:0}
.dot{width:9px;height:9px;border-radius:50%;background:#1fa75a}.dot.u{background:transparent;box-shadow:inset 0 0 0 1.5px #b8b8b8}
.n{font-weight:511;font-size:16px}.hh{display:block;font:12.5px ui-monospace,Menlo,monospace;color:#6b6b6b;margin-top:2px}
.tick{margin-left:auto;width:20px;height:20px;border-radius:50%;background:#000}
.actions{display:flex;justify-content:flex-end;align-items:center;gap:18px;margin-top:14px}
.cancel{font-size:16px;color:#6b6b6b}.pill{height:44px;padding:0 26px;border-radius:22px;background:#000;color:#fff;display:flex;align-items:center;font-weight:511;font-size:16px}
</style></head><body>
<div class="brand">${MARK}<span>RoamID</span></div><div class="url">id.fadianro.am</div>
<h1><span>${esc(t(lang, "hero_l1"))}</span><span>${esc(t(lang, "hero_l2"))}</span></h1>
<div class="band"></div>
<div class="card"><div class="ctx"><span>${esc(t(lang, "pick_to"))}</span><b>${esc(t(lang, "sample_rp"))}</b><span class="h">portal.example.com</span></div>
<div class="search">${SEARCH}<span>${esc(t(lang, "pick_search"))}</span></div>
<div class="rows"><div class="row"><span class="dot"></span><span><span class="n">YunZheng Auth</span><span class="hh">auth.yunzheng.space</span></span><span class="tick"></span></div>
<div class="row"><span class="dot u"></span><span><span class="n">${esc(t(lang, "sample_join"))}</span><span class="hh">${esc(t(lang, "sample_join_h"))}</span></span></div></div>
<div class="actions"><span class="cancel">${esc(t(lang, "pick_cancel_short"))}</span><span class="pill">${esc(t(lang, "pick_continue"))}</span></div></div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), "roamid-og-"));
try {
  for (const lang of ["en", "zh"]) {
    const f = join(dir, `${lang}.html`);
    writeFileSync(f, page(lang));
    const out = join(root, "assets", `og-${lang}.png`);
    execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1200,630", "--virtual-time-budget=3000", `--screenshot=${out}`, pathToFileURL(f).href], { stdio: "ignore" });
    console.log(out, readFileSync(out).length, "bytes");
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
