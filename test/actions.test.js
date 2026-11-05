// Actions against the in-memory Chrome. The point of most tests here is the user editing bookmarks
// or closing tabs between render and click: those paths must end in a quiet Gone or a sensible
// fallback, never a half-done write.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createActions, Gone } from "../extension/chrome/actions.js";
import { colorFor } from "../extension/lib/tabs.js";
import { createFakeChrome } from "./fake-chrome.js";
import { DAY, NOW, sampleTree } from "./fixtures.js";

function setup({ tree = sampleTree(), tabs = [], groups = [], selfTab = true } = {}) {
  const allTabs = selfTab ? [{ id: 1, url: "fake-extension://fake/newtab.html", active: true }, ...tabs] : tabs;
  const chrome = createFakeChrome({ tree, tabs: allTabs, groups, selfTabId: selfTab ? 1 : null, now: NOW });
  const actions = createActions(chrome, { now: () => chrome.now });
  const id = (title) => chrome._findBookmark(title)?.id;
  return { chrome, actions, id, selfTabId: selfTab ? 1 : null };
}

const tabUrls = (chrome) => [...chrome._tabs.values()].map((t) => t.url);

// ---------- open ----------

test("opening a pin that is already open focuses it and closes the new tab page", async () => {
  const { chrome, actions, id, selfTabId } = setup({ tabs: [{ id: 5, url: "https://github.com/" }] });
  const r = await actions.openItem(id("GitHub"), { selfTabId });
  assert.equal(r.focused, true);
  assert.equal(chrome._tabs.get(5).active, true);
  assert.equal(chrome._tabs.has(1), false, "the new tab page closed itself");
});

test("opening a closed pin reuses the new tab page instead of adding a tab", async () => {
  const { chrome, actions, id, selfTabId } = setup();
  await actions.openItem(id("GitHub"), { selfTabId });
  assert.deepEqual(tabUrls(chrome), ["https://github.com/"]);
});

test("task pages land in one tab group named after the task", async () => {
  const { chrome, actions, id } = setup();
  const task = id("Weekly 週報");
  await actions.openItem(id("Dune dashboard"), { taskId: task, background: true });
  await actions.openItem(id("Linear"), { taskId: task, background: true });
  const groups = [...chrome._groups.values()];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "Weekly 週報");
  assert.equal([...chrome._tabs.values()].filter((t) => t.groupId === groups[0].id).length, 2);
});

test("after the user closes the group, the next open creates a fresh one", async () => {
  const { chrome, actions, id } = setup();
  const task = id("Weekly 週報");
  const { tabId } = await actions.openItem(id("Dune dashboard"), { taskId: task, background: true });
  await chrome.tabs.remove(tabId); // user closes the only tab -> Chrome drops the group
  assert.equal(chrome._groups.size, 0);
  await actions.openItem(id("Linear"), { taskId: task, background: true });
  assert.equal(chrome._groups.size, 1);
  assert.equal([...chrome._groups.values()][0].title, "Weekly 週報");
});

test("an existing group with the task's title is reused (e.g. after a Chrome restart)", async () => {
  const { chrome, actions, id } = setup({
    tabs: [{ id: 7, url: "https://dune.com/example/weekly", groupId: 900 }],
    groups: [{ id: 900, windowId: 1, title: "Weekly 週報" }],
  });
  await actions.openItem(id("Linear"), { taskId: id("Weekly 週報"), background: true });
  assert.equal(chrome._groups.size, 1);
  assert.equal([...chrome._tabs.values()].filter((t) => t.groupId === 900).length, 2);
});

test("bookmark deleted between render and click -> Gone, nothing opened", async () => {
  const { chrome, actions, id, selfTabId } = setup();
  const gh = id("GitHub");
  await chrome.bookmarks.remove(gh);
  await assert.rejects(actions.openItem(gh, { selfTabId }), Gone);
  assert.deepEqual(tabUrls(chrome), ["fake-extension://fake/newtab.html"]);
});

test("task folder deleted meanwhile -> the page still opens, just without a group", async () => {
  const { chrome, actions, id } = setup();
  const task = id("Weekly 週報");
  const dune = id("Dune dashboard");
  await chrome.bookmarks.move(dune, { parentId: id("Top") });
  await chrome.bookmarks.removeTree(task);
  await actions.openItem(dune, { taskId: task, background: true });
  assert.ok(tabUrls(chrome).includes("https://dune.com/example/weekly"));
  assert.equal(chrome._groups.size, 0);
});

test("bookmarklets are refused with a readable message", async () => {
  const { actions, id } = setup();
  await assert.rejects(actions.openItem(id("點餅乾")), /err\.bookmarklet/);
});

test("openTask opens only the missing pages and groups them", async () => {
  const { chrome, actions, id, selfTabId } = setup({ tabs: [{ id: 8, url: "https://defillama.com/" }] });
  const r = await actions.openTask(id("crypto 研究"), { selfTabId });
  assert.deepEqual(r, { opened: 1, total: 2 });
  const g = [...chrome._groups.values()][0];
  assert.equal(g.title, "crypto 研究");
  assert.equal(chrome._tabs.get(8).groupId, -1, "already-open tab is left where it was");
});

// ---------- close ----------

test("closeTask closes the group's tabs and leaves bookmarks alone", async () => {
  const { chrome, actions, id } = setup();
  const task = id("Weekly 週報");
  await actions.openTask(task);
  const before = chrome._nodes.size;
  const r = await actions.closeTask(task);
  assert.equal(r.closed, 2);
  assert.equal(chrome._nodes.size, before);
  assert.equal(chrome._groups.size, 0);
});

// ---------- park / file ----------

test("parkTab bookmarks into Inbox and closes the tab", async () => {
  const { chrome, actions, id } = setup({ tabs: [{ id: 9, url: "https://blog.example/post", title: "A post" }] });
  await actions.parkTab(9);
  assert.equal(chrome._tabs.has(9), false);
  const inbox = chrome._nodes.get(id("inbox"));
  assert.equal(chrome._nodes.get(inbox.childIds.at(-1)).title, "A post");
});

test("parkTab creates Inbox when the user deleted it", async () => {
  const { chrome, actions } = setup({ tree: sampleTree({ inboxFolder: false }), tabs: [{ id: 9, url: "https://a.example/" }] });
  await actions.parkTab(9);
  assert.ok(chrome._findBookmark("Inbox"));
});

test("parkTab twice for the same URL keeps one bookmark", async () => {
  const { chrome, actions, id } = setup({ tabs: [{ id: 9, url: "https://example.com/fresh/" }] });
  const r = await actions.parkTab(9);
  assert.equal(r.duplicate, true);
  assert.equal(chrome._nodes.get(id("inbox")).childIds.length, 3);
});

test("parkTab on a tab closed meanwhile -> Gone and no bookmark", async () => {
  const { chrome, actions, id } = setup();
  await assert.rejects(actions.parkTab(404), Gone);
  assert.equal(chrome._nodes.get(id("inbox")).childIds.length, 3);
});

test("fileTab bookmarks into the task and moves the tab into its group", async () => {
  const { chrome, actions, id } = setup({ tabs: [{ id: 9, url: "https://dexscreener.com/", title: "Dex" }] });
  const task = id("crypto 研究");
  await actions.fileTab(9, task);
  assert.ok(chrome._nodes.get(task).childIds.some((c) => chrome._nodes.get(c).title === "Dex"));
  assert.equal(chrome._groups.get(chrome._tabs.get(9).groupId).title, "crypto 研究");
});

// ---------- drag and drop ----------

test("pinTab bookmarks into Top and keeps the tab open, once", async () => {
  const { chrome, actions, id } = setup({ tabs: [{ id: 9, url: "https://figma.com/files", title: "Figma" }] });
  assert.equal((await actions.pinTab(9)).duplicate, false);
  assert.equal((await actions.pinTab(9)).duplicate, true);
  assert.equal(chrome._tabs.has(9), true);
  const top = chrome._nodes.get(id("Top"));
  assert.equal(top.childIds.filter((c) => chrome._nodes.get(c).title === "Figma").length, 1);
  const view = await actions.load({ selfTabId: 1 });
  assert.equal(view.untracked.some((t) => t.id === 9), false, "a pinned tab is no longer 'other'");
  assert.equal(chrome._groups.get(chrome._tabs.get(9).groupId).title, "Cairn Pin");
});

// ---------- Cairn Pin group ----------

test("pins open into one 'Cairn Pin' tab group", async () => {
  const { chrome, actions, id } = setup();
  await actions.openItem(id("GitHub"), { group: "top", background: true });
  await actions.openItem(id("ChatGPT"), { group: "top", background: true });
  const groups = [...chrome._groups.values()];
  assert.deepEqual(groups.map((g) => g.title), ["Cairn Pin"]);
  assert.equal([...chrome._tabs.values()].filter((t) => t.groupId === groups[0].id).length, 2);
  assert.equal((await actions.load()).model.topGroupId, groups[0].id);
});

test("an already-open pin is focused, not pulled into the Cairn Pin group", async () => {
  const { chrome, actions, id, selfTabId } = setup({ tabs: [{ id: 5, url: "https://github.com/", groupId: -1 }] });
  await actions.openItem(id("GitHub"), { selfTabId, group: "top" });
  assert.equal(chrome._tabs.get(5).groupId, -1);
  assert.equal(chrome._groups.size, 0);
});

test("Top folder deleted meanwhile -> the pin still opens, just ungrouped", async () => {
  const { chrome, actions, id } = setup();
  const gh = id("GitHub");
  await chrome.bookmarks.move(gh, { parentId: id("inbox") });
  await chrome.bookmarks.removeTree(id("Top"));
  await actions.openItem(gh, { group: "top", background: true });
  assert.ok(tabUrls(chrome).includes("https://github.com/"));
  assert.equal(chrome._groups.size, 0);
});

test("closeTop closes only the Cairn Pin group's tabs", async () => {
  const { chrome, actions, id } = setup();
  await actions.openItem(id("GitHub"), { group: "top", background: true });
  await actions.openItem(id("Linear"), { taskId: id("Weekly 週報"), background: true });
  assert.deepEqual(await actions.closeTop(), { closed: 1 });
  assert.deepEqual([...chrome._groups.values()].map((g) => g.title), ["Weekly 週報"]);
});

test("load does not write storage when nothing needs garbage-collecting", async () => {
  const { chrome, actions } = setup();
  await actions.load();
  let writes = 0;
  const set = chrome.storage.local.set;
  chrome.storage.local.set = (x) => (writes++, set(x));
  await actions.load();
  await actions.load();
  // Regression: gc used to write all three keys on every render (2026-11-04).
  assert.equal(writes, 0);
});

test("createTask makes a Groups folder and files the dropped tab into it", async () => {
  const { chrome, actions } = setup({ tabs: [{ id: 9, url: "https://shopee.tw/x", title: "Shopee" }] });
  const { taskId, reused } = await actions.createTask("  購物清單 ", { tabId: 9 });
  assert.equal(reused, false);
  assert.equal(chrome._nodes.get(taskId).title, "購物清單");
  assert.equal(chrome._groups.get(chrome._tabs.get(9).groupId).title, "購物清單");
});

test("createTask reuses a task with the same name instead of duplicating it", async () => {
  const { actions, id } = setup();
  const r = await actions.createTask("weekly 週報");
  assert.deepEqual(r, { taskId: id("Weekly 週報"), reused: true });
});

test("createTask with a tab that closed meanwhile creates nothing", async () => {
  const { chrome, actions } = setup();
  const before = chrome._nodes.size;
  await assert.rejects(actions.createTask("新任務", { tabId: 404 }), Gone);
  assert.equal(chrome._nodes.size, before);
});

test("moveItem moves a bookmark between Inbox, Top and tasks", async () => {
  const { chrome, actions, id } = setup();
  const fresh = id("Fresh");
  await actions.moveItem(fresh, { taskId: id("crypto 研究") });
  assert.equal(chrome._nodes.get(fresh).parentId, id("crypto 研究"));
  await actions.moveItem(fresh, { role: "top" });
  assert.equal(chrome._nodes.get(fresh).parentId, id("Top"));
  assert.deepEqual(await actions.moveItem(fresh, { role: "top" }), { moved: false });
});

test("moveItem into a task deleted meanwhile -> Gone, bookmark stays put", async () => {
  const { chrome, actions, id } = setup();
  const fresh = id("Fresh");
  const inbox = chrome._nodes.get(fresh).parentId;
  const task = id("空任務");
  await chrome.bookmarks.removeTree(task);
  await assert.rejects(actions.moveItem(fresh, { taskId: task }), Gone);
  assert.equal(chrome._nodes.get(fresh).parentId, inbox);
});

test("moveItem refuses folders", async () => {
  const { actions, id } = setup();
  await assert.rejects(actions.moveItem(id("子資料夾"), { role: "top" }), /err\.onlyPages/);
});

// ---------- archive ----------

test("load sweeps due Inbox items into Archive", async () => {
  const { chrome, actions, id } = setup();
  const view = await actions.load({ selfTabId: 1 });
  assert.equal(view.movedToArchive, 1);
  assert.deepEqual(view.model.inbox.map((i) => i.title), ["Almost due", "Fresh"]);
  assert.equal(chrome._nodes.get(id("Old article")).parentId, id("Archive"));
});

test("archive sweep creates Archive if missing and respects the setting", async () => {
  const { chrome, actions } = setup({ tree: sampleTree({ archiveFolder: false }) });
  await actions.saveSettings({ archiveDays: 0 });
  assert.equal((await actions.load()).movedToArchive, 0);
  assert.equal(chrome._findBookmark("Archive"), undefined, "nothing created when disabled");
  await actions.saveSettings({ archiveDays: "7" });
  assert.equal((await actions.load()).movedToArchive, 2);
  assert.ok(chrome._findBookmark("Archive"));
});

test("an item the user moved out of Inbox is not archived", async () => {
  const { chrome, actions, id } = setup();
  const old = id("Old article");
  const model = (await actions.load()).model; // sweeps once
  await chrome.bookmarks.move(old, { parentId: id("Top") }); // user rescues it
  chrome.now += 60 * DAY;
  await actions.load();
  assert.equal(chrome._nodes.get(old).parentId, id("Top"));
  assert.ok(model);
});

test("archiveItem moves, never deletes", async () => {
  const { chrome, actions, id } = setup();
  const n = chrome._nodes.size;
  await actions.archiveItem(id("Fresh"));
  assert.equal(chrome._nodes.size, n);
  assert.equal(chrome._nodes.get(id("Fresh")).parentId, id("Archive"));
});

// ---------- structure & metadata ----------

test("load tolerates the whole root folder being deleted", async () => {
  const { chrome, actions, id } = setup();
  await chrome.bookmarks.removeTree(id("CairnTab"));
  const view = await actions.load({ selfTabId: 1 });
  assert.equal(view.model.root, null);
});

test("ensureStructure creates only what is missing and is idempotent", async () => {
  const { chrome, actions } = setup({ tree: sampleTree({ archiveFolder: false }) });
  await actions.ensureStructure();
  await actions.ensureStructure();
  const pin = chrome._findBookmark("CairnTab");
  const titles = pin.childIds.map((c) => chrome._nodes.get(c).title);
  assert.deepEqual(titles, ["Top", "Groups", "inbox", "舊東西", "Archive"]);
});

test("ensureStructure builds everything from nothing", async () => {
  const { chrome, actions } = setup({ tree: null });
  await actions.ensureStructure();
  const pin = chrome._findBookmark("CairnTab");
  assert.deepEqual(pin.childIds.map((c) => chrome._nodes.get(c).title), ["Pin", "Groups", "Inbox", "Archive"]);
});

test("metadata for deleted bookmarks and closed tabs is garbage-collected", async () => {
  const { chrome, actions, id } = setup();
  const gh = id("GitHub");
  await actions.openItem(gh, { background: true });
  await chrome.bookmarks.remove(gh);
  await actions.load();
  const meta = await actions.store.read();
  assert.equal(gh in meta.lastOpened, false);
});

test("load marks open items and lists other tabs for parking", async () => {
  const { actions } = setup({ tabs: [{ id: 5, url: "https://github.com" }, { id: 6, url: "https://elsewhere.example/" }] });
  const view = await actions.load({ selfTabId: 1 });
  assert.equal(view.model.top.find((i) => i.title === "GitHub").openTabId, 5);
  assert.deepEqual(view.untracked.map((t) => t.id), [6]);
});

// ---------- folding ----------

test("a folded task stays folded across renders, and the flag is dropped with the task", async () => {
  const { chrome, actions, id } = setup();
  const task = id("crypto 研究");
  await actions.setCollapsed(task, true);
  await actions.setCollapsed("loose", true);
  let view = await actions.load();
  assert.equal(view.model.tasks.find((t) => t.id === task).collapsed, true);
  assert.equal(view.model.tasks.find((t) => t.loose).collapsed, true, "the loose task can fold too");
  await chrome.bookmarks.removeTree(task);
  view = await actions.load();
  const meta = await actions.store.read();
  assert.equal(task in meta.collapsed, false);
  assert.equal(meta.collapsed.loose, true);
});

// ---------- archive view ----------

test("restoring from Archive restarts the countdown instead of re-archiving at once", async () => {
  const { chrome, actions, id } = setup();
  await actions.load(); // sweeps "Old article" (40 days) into Archive
  const old = id("Old article");
  assert.equal(chrome._nodes.get(old).parentId, id("Archive"));
  await actions.restoreItem(old);
  const view = await actions.load();
  // Regression guard: dateAdded is 40 days old and cannot be changed through the API.
  assert.equal(chrome._nodes.get(old).parentId, id("inbox"));
  assert.equal(view.model.inbox.find((i) => i.id === old).dateAdded, chrome.now);
});

test("a task page dragged into Inbox ages from the drop, not from when it was bookmarked", async () => {
  const { chrome, actions, id } = setup();
  const dune = id("Dune dashboard");
  chrome._nodes.get(dune).dateAdded = NOW - 90 * DAY;
  await actions.moveItem(dune, { role: "inbox" });
  assert.equal((await actions.load()).movedToArchive, 1, "only Old article");
  assert.equal(chrome._nodes.get(dune).parentId, id("inbox"));
});

test("load lists Archive newest first", async () => {
  const { actions, id } = setup();
  await actions.load(); // sweep archives "Old article" first
  await actions.archiveItem(id("Fresh"));
  const view = await actions.load();
  assert.deepEqual(view.model.archive.map((i) => i.title), ["Fresh", "Old article"]);
});

test("openBookmarkManager opens chrome://bookmarks at the root folder", async () => {
  const { chrome, actions, id, selfTabId } = setup();
  await actions.openBookmarkManager({ selfTabId });
  assert.equal(chrome._tabs.get(selfTabId).url, `chrome://bookmarks/?id=${id("CairnTab")}`);
});

// ---------- reorder & drawer ----------

const childTitles = (chrome, folderId) => chrome._nodes.get(folderId).childIds.map((c) => chrome._nodes.get(c).title);

test("fake move follows Chrome's index rule within one folder", async () => {
  // Chrome treats index as a pre-removal position; tests that reorder depend on matching it.
  const { chrome, id } = setup();
  const top = id("Top");
  await chrome.bookmarks.move(id("Gmail"), { parentId: top, index: 2 });
  assert.deepEqual(childTitles(chrome, top).slice(0, 3), ["Google Calendar", "Gmail", "GitHub"]);
});

test("placeItem reorders within a task, before or after the anchor", async () => {
  const { chrome, actions, id } = setup();
  const task = id("Weekly 週報");
  await actions.placeItem(id("Linear"), id("Dune dashboard"));
  assert.deepEqual(childTitles(chrome, task), ["Linear", "Dune dashboard"]);
  await actions.placeItem(id("Linear"), id("Dune dashboard"), { after: true });
  assert.deepEqual(childTitles(chrome, task), ["Dune dashboard", "Linear"]);
  assert.deepEqual(await actions.placeItem(id("Linear"), id("Dune dashboard"), { after: true }), { moved: false });
});

test("placeItem moves into another folder at the chosen spot", async () => {
  const { chrome, actions, id } = setup();
  await actions.placeItem(id("Fresh"), id("GitHub"));
  const top = childTitles(chrome, id("Top"));
  assert.equal(top.indexOf("Fresh"), top.indexOf("GitHub") - 1);
});

test("placeItem with an anchor deleted meanwhile -> Gone, nothing moved", async () => {
  const { chrome, actions, id } = setup();
  const linear = id("Linear");
  const before = chrome._nodes.get(linear).parentId;
  const dune = id("Dune dashboard");
  await chrome.bookmarks.remove(dune);
  await assert.rejects(actions.placeItem(linear, dune), Gone);
  assert.equal(chrome._nodes.get(linear).parentId, before);
});

test("adoptFolder turns an existing folder into a task", async () => {
  const { chrome, actions, id } = setup();
  const imported = id("匯入的收藏");
  await actions.adoptFolder(imported);
  assert.equal(chrome._nodes.get(imported).parentId, id("Groups"));
  const view = await actions.load();
  assert.ok(view.model.tasks.some((t) => t.title === "匯入的收藏"));
});

test("adoptFolder refuses folders that hold the structure together", async () => {
  const { actions, id } = setup();
  for (const title of ["CairnTab", "Groups", "Top", "Bookmarks bar"]) {
    await assert.rejects(actions.adoptFolder(id(title)), /err\.(cantAdopt|containsGroups)/, title);
  }
});

test("load returns the whole bookmark tree for the drawer", async () => {
  const { actions } = setup();
  const { bookmarkRoots } = await actions.load();
  assert.deepEqual(bookmarkRoots.map((n) => n.title), ["Bookmarks bar", "Other bookmarks", "Mobile bookmarks"]);
});

// ---------- bulk ----------

test("bulkTabs applies one action to many tabs and skips ones closed meanwhile", async () => {
  const tabs = [
    { id: 21, url: "https://wantgoo.com/a", title: "A" },
    { id: 22, url: "https://wantgoo.com/b", title: "B" },
    { id: 23, url: "https://etherscan.io/gastracker", title: "C" },
  ];
  const { chrome, actions, id } = setup({ tabs });
  assert.deepEqual(await actions.bulkTabs([21, 22, 404], "inbox"), { done: 2, gone: 1 });
  assert.equal(chrome._tabs.has(21) || chrome._tabs.has(22), false);
  assert.deepEqual(childTitles(chrome, id("inbox")).slice(-2), ["A", "B"]);
  assert.deepEqual(await actions.bulkTabs([23], "task", { taskId: id("crypto 研究") }), { done: 1, gone: 0 });
  assert.equal(chrome._groups.get(chrome._tabs.get(23).groupId).title, "crypto 研究");
});

test("bulk close only closes tabs, bookmarks untouched", async () => {
  const { chrome, actions } = setup({ tabs: [{ id: 31, url: "https://x.example/" }] });
  const n = chrome._nodes.size;
  assert.deepEqual(await actions.bulkTabs([31], "close"), { done: 1, gone: 0 });
  assert.equal(chrome._tabs.has(31), false);
  assert.equal(chrome._nodes.size, n);
});

test("bulk into a task deleted meanwhile -> Gone before touching any tab", async () => {
  const { chrome, actions, id } = setup({ tabs: [{ id: 41, url: "https://y.example/" }] });
  const task = id("空任務");
  await chrome.bookmarks.removeTree(task);
  await assert.rejects(actions.bulkTabs([41], "task", { taskId: task }), Gone);
  assert.equal(chrome._tabs.get(41).groupId, -1);
});

// ---------- rename ----------

test("renameItem changes the bookmark title, trims it, refuses empty names", async () => {
  const { chrome, actions, id } = setup();
  const gh = id("GitHub");
  assert.deepEqual(await actions.renameItem(gh, "  GH  "), { changed: true });
  assert.equal(chrome._nodes.get(gh).title, "GH");
  await assert.rejects(actions.renameItem(gh, "   "), /err\.nameEmpty/);
  assert.equal(chrome._nodes.get(gh).title, "GH");
});

test("renameItem on a bookmark deleted meanwhile -> Gone", async () => {
  const { chrome, actions, id } = setup();
  const gh = id("GitHub");
  await chrome.bookmarks.remove(gh);
  await assert.rejects(actions.renameItem(gh, "x"), Gone);
});

test("renameTask renames the folder and its open tab group together", async () => {
  const { chrome, actions, id } = setup();
  const task = id("Weekly 週報");
  await actions.openItem(id("Linear"), { taskId: task, background: true });
  const r = await actions.renameTask(task, "週報 Q4");
  assert.deepEqual(r, { changed: true, groupRenamed: true });
  assert.equal(chrome._nodes.get(task).title, "週報 Q4");
  assert.deepEqual([...chrome._groups.values()].map((g) => g.title), ["週報 Q4"]);
  assert.equal([...chrome._groups.values()][0].color, colorFor("週報 Q4"), "card and group keep one colour");
  // The next page opened joins the same (renamed) group rather than creating a new one.
  await actions.openItem(id("Dune dashboard"), { taskId: task, background: true });
  assert.equal(chrome._groups.size, 1);
});

test("renameTask without an open group only renames the folder", async () => {
  const { chrome, actions, id } = setup();
  const task = id("空任務");
  assert.deepEqual(await actions.renameTask(task, "新名字"), { changed: true, groupRenamed: false });
  assert.equal(chrome._nodes.get(task).title, "新名字");
});

// ---------- icons ----------

test("an item's icon comes from the page its tab actually loaded, and is remembered", async () => {
  // Seen in use: a bookmark whose URL redirects showed Chrome's default globe even while open,
  // because Chrome's icon cache only knows the URL the tab ended up on.
  const { chrome, actions, id } = setup({ tabs: [{ id: 51, url: "https://www.shop.example/zh-hant/products/blue-mug" }] });
  const top = id("Top");
  const shop = (await chrome.bookmarks.create({ parentId: top, title: "Shop", url: "https://shop.example/products/blue-mug" })).id;
  let view = await actions.load();
  assert.equal(view.model.top.find((i) => i.id === shop).iconPage, "https://www.shop.example/zh-hant/products/blue-mug");
  await chrome.tabs.remove(51);
  view = await actions.load();
  assert.equal(view.model.top.find((i) => i.id === shop).iconPage, "https://www.shop.example/zh-hant/products/blue-mug", "kept after the tab closes");
  assert.equal(view.model.top.find((i) => i.title === "GitHub").iconPage, "https://github.com/", "never-opened items use their own URL");
});

test("appearance is stored normalized and merges patches", async () => {
  const chrome = createFakeChrome({ tree: sampleTree(), now: NOW });
  const actions = createActions(chrome, { now: () => NOW });
  assert.equal((await actions.readAppearance()).theme, "system");
  await actions.saveAppearance({ theme: "dark", radius: 400 });
  const a = await actions.saveAppearance({ accent: "teal" });
  assert.equal(a.theme, "dark", "earlier patch kept");
  assert.equal(a.radius, 20, "clamped");
  assert.equal(a.accent, "teal");
  assert.deepEqual(await actions.readAppearance(), a);
});

test("openMode is stored and junk falls back to switch (D-024)", async () => {
  const { actions } = setup();
  assert.equal((await actions.saveSettings({ openMode: "stay" })).openMode, "stay");
  assert.equal((await actions.saveSettings({ rootTitle: "CairnTab" })).openMode, "stay", "other saves keep it");
  assert.equal((await actions.saveSettings({ openMode: "nope" })).openMode, "switch");
});

test("background open keeps this tab: openItem creates an inactive tab, openTask focuses nothing", async () => {
  const { chrome, actions, id, selfTabId } = setup();
  const before = [...chrome._tabs.values()].find((t) => t.active)?.id;
  const items = (await chrome.bookmarks.getChildren(id("crypto 研究")));
  const r = await actions.openItem(items[0].id, { selfTabId, taskId: id("crypto 研究"), background: true });
  assert.equal(chrome._tabs.get(r.tabId).active, false);
  assert.ok(chrome._tabs.has(selfTabId), "CairnTab tab still exists");
  await actions.openTask(id("Weekly 週報"), { selfTabId, background: true });
  assert.equal([...chrome._tabs.values()].find((t) => t.active)?.id, before, "focus did not move");
});

test("closeOnSwitch defaults on and persists off (D-025)", async () => {
  const { actions } = setup();
  assert.equal((await actions.saveSettings({})).closeOnSwitch, true);
  assert.equal((await actions.saveSettings({ closeOnSwitch: false })).closeOnSwitch, false);
  assert.equal((await actions.saveSettings({ openMode: "stay" })).closeOnSwitch, false, "other saves keep it");
});

test("switching without giving up this tab opens a new active tab and keeps CairnTab", async () => {
  const { chrome, actions, id, selfTabId } = setup({ tabs: [{ id: 8, url: "https://defillama.com/" }] });
  const r = await actions.openItem(id("Etherscan"), { selfTabId: null, taskId: id("crypto 研究") });
  assert.notEqual(r.tabId, selfTabId);
  assert.equal(chrome._tabs.get(r.tabId).active, true);
  assert.ok(chrome._tabs.has(selfTabId), "CairnTab tab kept");
  await actions.openItem(id("DefiLlama"), { selfTabId: null });
  assert.equal(chrome._tabs.get(8).active, true, "already-open page focused");
  assert.ok(chrome._tabs.has(selfTabId), "and CairnTab still kept");
});

test("inboxSort is stored and junk falls back to expiring (D-027)", async () => {
  const { actions } = setup();
  assert.equal((await actions.saveSettings({})).inboxSort, "expiring");
  assert.equal((await actions.saveSettings({ inboxSort: "manual" })).inboxSort, "manual");
  assert.equal((await actions.saveSettings({ archiveDays: 7 })).inboxSort, "manual", "other saves keep it");
  assert.equal((await actions.saveSettings({ inboxSort: "random" })).inboxSort, "expiring");
});

test("manual Inbox order: placeItem reorders inside Inbox and keeps its age", async () => {
  const { chrome, actions } = setup();
  const view = await actions.load({});
  const first = view.model.inbox[0];
  const last = view.model.inbox.at(-1); // the 40-day-old sample item was swept on load
  assert.notEqual(first.id, last.id);
  await actions.placeItem(last.id, first.id, { after: false });
  const again = await actions.load({});
  assert.equal(again.model.inbox[0].id, last.id, "moved to the top of the folder");
  assert.equal(again.model.inbox[0].dateAdded, last.dateAdded, "reordering within Inbox does not reset the countdown");
});

test("missing root: load offers an older folder, and adopting it is just a rename of the setting (D-029)", async () => {
  const { actions } = setup({ tree: sampleTree({ rootTitle: "Pin" }) });
  const view = await actions.load({});
  assert.equal(view.model.root, null);
  assert.deepEqual(view.candidates.map((c) => c.title), ["Pin"]);
  await actions.saveSettings({ rootTitle: "Pin" });
  const after = await actions.load({});
  assert.equal(after.model.root.title, "Pin");
  assert.deepEqual(after.candidates, []);
});

test("default root folder is called CairnTab and ensureStructure creates it", async () => {
  const { chrome, actions } = setup({ tree: { id: "0", title: "", children: [
    { title: "Bookmarks bar", folderType: "bookmarks-bar", children: [] },
    { title: "Other bookmarks", folderType: "other", children: [] },
  ] } });
  assert.equal((await actions.load({})).settings.rootTitle, "CairnTab");
  await actions.ensureStructure();
  const view = await actions.load({});
  assert.equal(view.model.root.title, "CairnTab");
  assert.ok(chrome._findBookmark("Inbox"));
});

// ---------- search opens (D-030) ----------

test("duplicate opens a second copy even when the page is already open", async () => {
  const { chrome, actions, id } = setup({ tabs: [{ id: 5, url: "https://github.com/" }] });
  const r = await actions.openItem(id("GitHub"), { selfTabId: null, background: true, duplicate: true });
  assert.equal(r.focused, false);
  assert.equal(tabUrls(chrome).filter((u) => u === "https://github.com/").length, 2);
});

test("switchToTab focuses the tab and gives up the new tab page", async () => {
  const { chrome, actions, selfTabId } = setup({ tabs: [{ id: 5, url: "https://news.example/" }] });
  await actions.switchToTab(5, { selfTabId });
  assert.equal(chrome._tabs.get(5).active, true);
  assert.equal(chrome._tabs.has(1), false);
});

test("duplicateTab opens the same URL in a new tab; a closed tab is Gone", async () => {
  const { chrome, actions } = setup({ tabs: [{ id: 5, url: "https://news.example/" }] });
  await actions.duplicateTab(5, { background: true });
  assert.equal(tabUrls(chrome).filter((u) => u === "https://news.example/").length, 2);
  await assert.rejects(actions.duplicateTab(99), Gone);
});

test("a pins group still called 'Top Pin' (before D-033) is found and renamed", async () => {
  const { chrome, actions, id } = setup({
    tabs: [{ id: 9, url: "https://github.com/", groupId: 70 }],
    groups: [{ id: 70, title: "Top Pin", color: "grey", windowId: 1 }],
  });
  const view = await actions.load({ selfTabId: 1 });
  assert.equal(view.model.topGroupId, 70);
  assert.equal(chrome._groups.get(70).title, "Cairn Pin");
  assert.ok(id("GitHub"));
});

test("drawer sides: defaults, partial updates and junk values (D-036)", async () => {
  const { actions } = setup();
  assert.deepEqual((await actions.load()).settings.drawers, { tabs: "left", bookmarks: "right", settings: "right" });
  await actions.saveSettings({ drawers: { settings: "left" } });
  await actions.saveSettings({ drawers: { bookmarks: "up" } });
  assert.deepEqual((await actions.load()).settings.drawers, { tabs: "left", bookmarks: "right", settings: "left" });
});
