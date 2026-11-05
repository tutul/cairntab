import assert from "node:assert/strict";
import { test } from "node:test";

import { displayUrl, highlight, search, searchEntries, tokenize } from "../extension/lib/search.js";

const item = (id, title, url, extra = {}) => ({ id, title, url, openable: true, ...extra });
const model = {
  top: [item("1", "GitHub", "https://github.com/"), item("2", "Gmail", "https://mail.google.com/mail/u/0/", { openTabId: 11 })],
  tasks: [
    { id: "t1", title: "旅行規劃", loose: false, items: [
      item("3", "東京 住宿比較", "https://www.example.com/hotels/tokyo"),
      item("4", "Wiki 京都", "https://zh.wikipedia.org/wiki/%E4%BA%AC%E9%83%BD%E5%B8%82"),
    ] },
    { id: "__loose__", title: "未分組", loose: true, items: [item("5", "CairnTab repo", "https://github.com/tutul/cairntab")] },
  ],
  inbox: [item("6", "ＲＥＡＤＭＥ 說明", "https://example.org/readme")],
  archive: [item("7", "archived GitHub thing", "https://github.com/old")],
};
const tabs = [
  { id: 11, windowId: 1, title: "Inbox (3) - Gmail", url: "https://mail.google.com/mail/u/0/#inbox", place: { kind: "top" } },
  { id: 12, windowId: 1, title: "Hacker News", url: "https://news.ycombinator.com/", place: null },
  { id: 13, windowId: 1, title: "台北 天氣", url: "https://weather.example/台北", place: null },
];
const entries = searchEntries(model, tabs);
const titles = (q) => search(entries, q).map((r) => r.title);

test("tokenize: whitespace, * and full-width space all separate; full-width letters fold", () => {
  assert.deepEqual(tokenize("  git   Hub "), ["git", "hub"]);
  assert.deepEqual(tokenize("git*hub"), ["git", "hub"]);
  assert.deepEqual(tokenize("ｇｉｔ　東京"), ["git", "东京"], "folded to Simplified for comparison");
  assert.deepEqual(tokenize(""), []);
});

test("displayUrl strips scheme, www and decodes Chinese paths", () => {
  assert.equal(displayUrl("https://www.example.com/a/"), "example.com/a");
  assert.equal(displayUrl("https://zh.wikipedia.org/wiki/%E4%BA%AC%E9%83%BD%E5%B8%82"), "zh.wikipedia.org/wiki/京都市");
  assert.equal(displayUrl("https://x.com/%E4%BA"), "x.com/%E4%BA", "a broken escape is kept as is");
});

test("entries: Top, tasks, Inbox and unfiled tabs; no Archive; filed or covered tabs once", () => {
  const keys = entries.map((e) => `${e.kind}:${e.title}`);
  assert.ok(!keys.some((k) => k.includes("archived")));
  assert.ok(keys.includes("tab:Hacker News"));
  assert.ok(!keys.some((k) => k.startsWith("tab:Inbox (3)")), "Gmail tab is shown as its bookmark");
  assert.equal(entries.find((e) => e.title === "Gmail").openTabId, 11);
  assert.equal(entries.find((e) => e.title === "CairnTab repo").taskId, null, "loose task has no task id");
  assert.equal(entries.find((e) => e.title === "東京 住宿比較").taskId, "t1");
});

test("every token must match title or URL, in any order", () => {
  assert.deepEqual(titles("cairn github"), ["CairnTab repo"]);
  assert.deepEqual(titles("github cairn"), ["CairnTab repo"]);
  assert.deepEqual(titles("cairn nothing"), []);
});

test("Chinese: substring on titles and decoded URLs, mixed with Latin", () => {
  assert.deepEqual(titles("東京"), ["東京 住宿比較"]);
  assert.deepEqual(new Set(titles("京")), new Set(["Wiki 京都", "東京 住宿比較"]));
  assert.ok(titles("京都市").includes("Wiki 京都"), "matched through the decoded URL");
  assert.deepEqual(titles("台北"), ["台北 天氣"]);
  assert.deepEqual(titles("wiki 京都"), ["Wiki 京都"]);
  assert.deepEqual(titles("readme 說明"), ["ＲＥＡＤＭＥ 說明"], "full-width title matches half-width query");
});

test("ranking: title prefix > all in title > URL only; open first on ties", () => {
  const r = search(entries, "g");
  assert.equal(r[0].title, "Gmail", "prefix and open beats prefix alone");
  assert.equal(r[1].title, "GitHub");
  const u = search(entries, "github");
  assert.equal(u[0].title, "GitHub");
  assert.equal(u.at(-1).rank, 1);
});

test("highlight ranges map back onto the original text", () => {
  const [r] = search(entries, "readme");
  assert.deepEqual(highlight(r.title, r.titleRanges), [{ text: "ＲＥＡＤＭＥ", hit: true }, { text: " 說明", hit: false }]);
  const [w] = search(entries, "京都 wiki");
  assert.deepEqual(highlight(w.title, w.titleRanges).filter((p) => p.hit).map((p) => p.text), ["Wiki", "京都"]);
  assert.ok(highlight(w.shownUrl, w.urlRanges).some((p) => p.hit && p.text === "京都"));
});

test("Traditional and Simplified Chinese match each other, both ways (D-031)", () => {
  const es = searchEntries({ top: [], tasks: [], inbox: [
    item("a", "臺灣 後端開發 筆記", "https://notes.example/backend"),
    item("b", "简体：机器学习入门", "https://ml.example/"),
  ] });
  const find = (q) => search(es, q).map((r) => r.id);
  assert.deepEqual(find("台湾 后端"), ["a"], "simplified query finds traditional title");
  assert.deepEqual(find("臺灣"), ["a"]);
  assert.deepEqual(find("機器 學習"), ["b"], "traditional query finds simplified title");
  assert.deepEqual(find("开发"), ["a"]);
  const [r] = search(es, "后端");
  assert.deepEqual(highlight(r.title, r.titleRanges).filter((p) => p.hit).map((p) => p.text), ["後端"], "highlight shows the original characters");
});
