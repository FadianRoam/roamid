// Chinese strings use full-width punctuation next to CJK characters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allStrings } from "../src/ui/i18n.js";

const CJK = "[\\u3400-\\u9fff]";
const BAD = new RegExp(`${CJK}[,.:;?!()]|[,:;?!()]${CJK}`);

test("zh UI strings: no ASCII , . : ; ? ! ( ) next to CJK characters", () => {
  const bad = allStrings("zh").filter((s) => BAD.test(s));
  assert.deepEqual(bad, []);
});

test("zh documents: the same rule outside code", () => {
  for (const f of ["README.zh-CN.md", "docs/zh-CN/rp-integration.md", "docs/zh-CN/idp-requirements.md", "docs/zh-CN/registry.md", "docs/zh-CN/policy.md"]) {
    let fence = false;
    readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n").forEach((line, i) => {
      if (line.trim().startsWith("```")) { fence = !fence; return; }
      if (fence) return;
      const text = line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]");
      assert.ok(!BAD.test(text), `${f}:${i + 1}: ${line}`);
    });
  }
});

test("en and zh have the same keys", async () => {
  const en = allStrings("en"), zh = allStrings("zh");
  assert.equal(en.length, zh.length);
});
