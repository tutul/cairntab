import assert from "node:assert/strict";
import { test } from "node:test";

import { createT, DICTS, intlLocale, resolveLang, UserError } from "../extension/lib/i18n.js";

test("every dictionary has exactly the same keys (D-033)", () => {
  const [base, ...rest] = Object.entries(DICTS);
  const keys = Object.keys(base[1]).sort();
  for (const [lang, dict] of rest) {
    const mine = Object.keys(dict).sort();
    assert.deepEqual(mine.filter((k) => !keys.includes(k)), [], `${lang} has extra keys`);
    assert.deepEqual(keys.filter((k) => !mine.includes(k)), [], `${lang} is missing keys`);
  }
});

test("function entries and placeholders fill in every language", () => {
  for (const lang of Object.keys(DICTS)) {
    const t = createT(lang);
    for (const [key, v] of Object.entries(DICTS[lang])) {
      const out = typeof v === "function" ? v({ n: 2, label: "L", gone: 1, root: "R", examples: "E" }) : v;
      assert.equal(typeof out, "string", `${lang} ${key}`);
      assert.ok(out.length > 0, `${lang} ${key} is empty`);
    }
    assert.ok(!t("toast.filed", { name: "X" }).includes("{"), "placeholder filled");
  }
});

test("translate: params, plurals, fallbacks", () => {
  const en = createT("en");
  const zh = createT("zh-Hant");
  assert.equal(en("toast.filed", { name: "Trip" }), "Added to “Trip”");
  assert.equal(zh("toast.filed", { name: "Trip" }), "已加入「Trip」");
  assert.equal(en("task.pages", { n: 1 }), "1 page");
  assert.equal(en("task.pages", { n: 3 }), "3 pages");
  assert.equal(zh("task.pages", { n: 3 }), "3 頁");
  assert.equal(en("no.such.key"), "no.such.key");
});

test("resolveLang: explicit setting wins, auto follows the browser", () => {
  assert.equal(resolveLang("en", ["zh-TW"]), "en");
  assert.equal(resolveLang("zh-Hant", ["en-US"]), "zh-Hant");
  assert.equal(resolveLang("auto", ["zh-TW", "en"]), "zh-Hant");
  assert.equal(resolveLang("auto", ["zh-CN"]), "zh-Hant", "Simplified readers get the Chinese UI");
  assert.equal(resolveLang("auto", ["ja", "zh-TW"]), "en", "only the first preference counts");
  assert.equal(resolveLang("bogus", []), "en");
  assert.equal(intlLocale("zh-Hant"), "zh-TW");
});

test("UserError carries its key as the message", () => {
  const e = new UserError("err.badBulk", { op: "x" });
  assert.equal(e.message, "err.badBulk");
  assert.equal(createT("en")(e.key, e.params), "Unsupported batch action: x");
});
