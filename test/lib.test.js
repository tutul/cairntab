import assert from "node:assert/strict";
import { test } from "node:test";

import { ageDays, daysLeft, dueItems, relativeDay } from "../extension/lib/archive.js";
import { buildModel, findRoot } from "../extension/lib/model.js";
import { colorFor, describeTabs, findOpenTab, findTaskGroup, planGroup, untrackedTabs } from "../extension/lib/tabs.js";
import { isOpenable, MATCH, matchScore, sameUrl, urlKey } from "../extension/lib/url.js";
import { createFakeChrome } from "./fake-chrome.js";
import { DAY, NOW, sampleTree } from "./fixtures.js";

const treeOf = async (spec) => createFakeChrome({ tree: spec, now: NOW }).bookmarks.getTree();

// ---------- url ----------

test("urlKey ignores scheme, www, default port, fragment and trailing slash", () => {
  assert.equal(urlKey("https://www.GitHub.com/"), "github.com");
  assert.equal(urlKey("http://github.com:80/a/b/#x"), "github.com/a/b");
  assert.ok(sameUrl("https://mail.google.com/mail/u/0/#inbox", "https://mail.google.com/mail/u/0/"));
  assert.ok(!sameUrl("https://a.com/?q=1", "https://a.com/?q=2"));
  assert.ok(!sameUrl("", ""), "empty URLs never match each other");
});

test("bookmarklets are not openable", () => {
  assert.equal(isOpenable("javascript:alert(1)"), false);
  assert.equal(isOpenable("  "), false);
  assert.equal(isOpenable("chrome://settings"), true);
});

// ---------- model ----------

test("buildModel reads a realistic layout", async () => {
  const m = buildModel(await treeOf(sampleTree()), { rootTitle: "Pin" });
  assert.equal(m.root.title, "Pin");
  assert.equal(m.top.length, 6);
  assert.equal(m.top[4].title, "https://www.notion.so/", "empty title falls back to URL");
  assert.equal(m.top[5].openable, false);
  assert.deepEqual(m.tasks.map((t) => t.title), ["Weekly 週報", "crypto 研究", "空任務", "未分組"]);
  assert.equal(m.tasks[1].items.length, 2, "nested folder inside a task is flattened");
  assert.equal(m.tasks[3].loose, true);
  assert.equal(m.inbox.length, 3, "role names are case-insensitive");
  assert.deepEqual(m.extras.map((e) => e.title), ["舊東西"]);
});

test("missing root gives an empty model, not an error", async () => {
  const m = buildModel(await treeOf(sampleTree()), { rootTitle: "Nope" });
  assert.equal(m.root, null);
  assert.deepEqual(m.tasks, []);
});

test("duplicate role folders: first wins, the rest are reported", async () => {
  const tree = sampleTree();
  tree.children[0].children[2].children.push({ title: "TOP", children: [{ title: "dup", url: "https://dup.example/" }] });
  const m = buildModel(await treeOf(tree));
  assert.equal(m.top.length, 6);
  assert.equal(m.warnings.length, 1);
});

test("root under the bookmarks bar wins over one elsewhere", async () => {
  const tree = sampleTree();
  tree.children[1].children.push({ title: "pin", children: [] });
  const root = findRoot(await treeOf(tree), "Pin");
  assert.equal(root.children.length > 0, true, "the populated bar folder, not the empty one in Other");
});

// ---------- archive ----------

test("dueItems honours the setting, 0 disables", () => {
  const items = [{ dateAdded: NOW - 40 * DAY }, { dateAdded: NOW - 29 * DAY }, { dateAdded: 0 }];
  assert.equal(dueItems(items, 30, NOW).length, 1);
  assert.equal(dueItems(items, 0, NOW).length, 0);
  assert.equal(dueItems(items, "7", NOW).length, 2, "string from an <input> still works");
  assert.equal(daysLeft(NOW - 28 * DAY, 30, NOW), 2);
  assert.equal(daysLeft(NOW, 0, NOW), null);
  assert.equal(ageDays(NOW - DAY - 1, NOW), 1);
  assert.equal(relativeDay(NOW - 3 * DAY, NOW), "3 天前");
});

// ---------- tabs ----------

test("findOpenTab: exact URL first, then the closest match", () => {
  const item = { id: "7", url: "https://www.shop.example/products/blue-mug" };
  const exact = { id: 1, url: "https://shop.example/products/blue-mug/" };
  const elsewhere = { id: 2, url: "https://www.shop.example/account/login?forward=x" };
  const localized = { id: 3, url: "https://www.shop.example/zh-hant/products/blue-mug?tab=depth" };
  assert.equal(findOpenTab(item, [localized, exact]).id, 1, "exact wins");
  assert.equal(findOpenTab(item, [elsewhere, localized]).id, 3, "locale segment and query are ignored");
  assert.equal(findOpenTab(item, [elsewhere]), null, "same site, different page: not open");
});

test("a tab that browsed away is no longer the item's tab (D-014)", () => {
  const item = { id: "7", url: "https://www.shop.example/products/blue-mug" };
  const tab = { id: 2, url: "https://news.ycombinator.com/" };
  assert.equal(findOpenTab(item, [tab]), null);
  assert.deepEqual(untrackedTabs([tab], [item]).map((t) => t.id), [2], "it shows under other tabs");
});

test("matchScore tiers", () => {
  const s = (b, t) => matchScore(b, t);
  assert.equal(s("https://shop.example/a/b", "https://www.shop.example/a/b/#x"), MATCH.EXACT);
  assert.equal(s("https://shop.example/a/b", "https://shop.example/en-us/a/b?q=1"), MATCH.PAGE);
  assert.equal(s("https://notion.so/team", "https://notion.so/team/page-1"), MATCH.INSIDE);
  assert.equal(s("https://shop.example/", "https://shop.example/zh-hant/account"), MATCH.SITE);
  assert.equal(s("https://shop.example/a", "https://shop.example/b"), MATCH.NONE);
  assert.equal(s("https://app.notion.com/", "https://notion.so/"), MATCH.NONE, "different hosts never match");
  assert.equal(s("https://x.com/go/home", "https://x.com/home"), MATCH.NONE, "'go' is not a locale");
  assert.equal(s("chrome://settings", "chrome://settings/privacy"), MATCH.NONE, "non-web URLs: exact only");
});

test("a front-page pin shows as open on any page of the site, but does not hide those tabs from parking", () => {
  const items = [{ id: "a", url: "https://github.com/" }];
  const tabs = [{ id: 5, url: "https://github.com/example/repo" }];
  assert.equal(findOpenTab(items[0], tabs).id, 5);
  assert.deepEqual(untrackedTabs(tabs, items).map((t) => t.id), [5]);
});

test("untrackedTabs skips our page, chrome:// and tabs already shown as items", () => {
  const tabs = [
    { id: 1, url: "chrome://newtab/" },
    { id: 2, url: "https://github.com/" },
    { id: 3, url: "https://random.example/" },
    { id: 4, url: "fake-extension://fake/newtab.html" },
  ];
  const out = untrackedTabs(tabs, [{ id: "a", url: "https://github.com" }], { selfTabId: 4, extensionOrigin: "fake-extension://fake/" });
  assert.deepEqual(out.map((t) => t.id), [3]);
});

test("planGroup: remembered group, then same title in this window, else create", () => {
  const groups = [
    { id: 10, windowId: 1, title: "Other" },
    { id: 11, windowId: 1, title: "weekly 週報 " },
    { id: 12, windowId: 2, title: "Weekly 週報" },
  ];
  const base = { groups, windowId: 1, taskTitle: "Weekly 週報" };
  assert.deepEqual(planGroup({ ...base, mapEntry: { groupId: 10 } }), { action: "join", groupId: 10 });
  assert.deepEqual(planGroup({ ...base, mapEntry: { groupId: 12 } }), { action: "join", groupId: 11 }, "remembered group in another window is skipped");
  assert.deepEqual(planGroup({ ...base, mapEntry: null, windowId: 3 }), { action: "create" });
  assert.equal(findTaskGroup({ ...base, mapEntry: { groupId: 12 } }).id, 12);
});

test("colorFor is stable and case-insensitive", () => {
  assert.equal(colorFor("Weekly 週報"), colorFor("weekly 週報 "));
});

test("a bookmark's own query must match; extra tab params are fine", () => {
  // Regression: a bookmarked Google search made every Google search tab look already filed.
  assert.equal(matchScore("https://www.google.com/search?q=chatgpt", "https://www.google.com/search?q=%E7%BE%8E%E9%87%91"), MATCH.NONE);
  assert.equal(matchScore("https://shop.example/a?pair=eth", "https://shop.example/zh-hant/a?pair=eth&x=1"), MATCH.PAGE);
  assert.equal(matchScore("https://shop.example/a", "https://shop.example/a?x=1"), MATCH.PAGE, "bookmark without a query ignores the tab's");
});

test("describeTabs lists every tab and says where filed ones live", () => {
  const places = [
    { item: { url: "https://github.com/" }, place: { label: "Top" } },
    { item: { url: "https://dune.com/example/weekly" }, place: { label: "Weekly 週報" } },
  ];
  const tabs = [
    { id: 1, url: "https://dune.com/example/weekly?tab=1" },
    { id: 2, url: "https://github.com/example/repo" },
    { id: 3, url: "chrome://settings" },
  ];
  const out = describeTabs(tabs, places);
  assert.deepEqual(out.map((t) => [t.id, t.place?.label ?? null]), [[1, "Weekly 週報"], [2, null]]);
});

test("sortInbox: expiring (oldest first), newest, manual keeps bookmark order (D-027)", async () => {
  const { sortInbox } = await import("../extension/lib/archive.js");
  const items = [{ id: "a", dateAdded: 30 }, { id: "b", dateAdded: 10 }, { id: "c", dateAdded: 20 }];
  const ids = (l) => l.map((i) => i.id).join("");
  assert.equal(ids(sortInbox(items)), "bca");
  assert.equal(ids(sortInbox(items, "newest")), "acb");
  assert.equal(ids(sortInbox(items, "manual")), "abc");
  assert.equal(ids(items), "abc", "input not mutated");
});
