// The only module (with store.js) that calls chrome.*. Each action re-reads what it is about to
// change, because the user may have edited bookmarks since the page rendered.

import { dueItems } from "../lib/archive.js";
import { allIds, buildModel, findCandidateRoots, flatten, normTitle } from "../lib/model.js";
import { colorFor, describeTabs, findOpenTab, findTaskGroup, planGroup } from "../lib/tabs.js";
import { isOpenable, sameUrl } from "../lib/url.js";
import { createStore } from "./store.js";

const ROLE_TITLES = { top: "Top", groups: "Groups", inbox: "Inbox", archive: "Archive" };
export const TOP_GROUP_TITLE = "Top Pin";
const GONE_RE = /can't find|no tab with id|no group with id|no window with id|not found|invalid (bookmark|tab|group)/i;

/** A bookmark, tab or group disappeared between render and click. Expected; not a bug. */
export class Gone extends Error {
  constructor(what) {
    super(`${what}已經不存在，可能剛被移動或刪除`);
    this.name = "Gone";
  }
}

export function isGone(err) {
  return err instanceof Gone || GONE_RE.test(String(err?.message ?? err));
}

export function createActions(chrome, { now = () => Date.now() } = {}) {
  const store = createStore(chrome);

  async function getNode(id, what = "書籤") {
    try {
      const [node] = await chrome.bookmarks.get(String(id));
      if (!node) throw new Gone(what);
      return node;
    } catch (e) {
      if (isGone(e)) throw new Gone(what);
      throw e;
    }
  }

  async function getTab(id) {
    try {
      return await chrome.tabs.get(id);
    } catch (e) {
      if (isGone(e)) throw new Gone("分頁");
      throw e;
    }
  }

  async function readModel() {
    const [tree, meta] = await Promise.all([chrome.bookmarks.getTree(), store.read()]);
    return { tree, meta, model: buildModel(tree, meta.settings) };
  }

  /** Is `id` inside folder `ancestorId` (any depth)? Walks up with fresh reads. */
  async function isInside(id, ancestorId) {
    let cur = await getNode(id);
    for (let depth = 0; depth < 32 && cur.parentId; depth++) {
      if (cur.parentId === ancestorId) return true;
      cur = await getNode(cur.parentId);
    }
    return false;
  }

  /** Id of a role folder, creating it (and the root folder) if missing. */
  async function ensureRole(role, model, settings) {
    const known = model.folders[role];
    if (known) {
      try {
        await getNode(known.id);
        return known.id;
      } catch (e) {
        if (!(e instanceof Gone)) throw e;
      }
    }
    // Re-read: another new tab page may have created it meanwhile.
    const fresh = buildModel(await chrome.bookmarks.getTree(), settings);
    if (fresh.folders[role]) return fresh.folders[role].id;
    let rootId = fresh.root?.id;
    if (!rootId) {
      const root = await chrome.bookmarks.create({ parentId: fresh.barId, title: settings.rootTitle });
      rootId = root.id;
    }
    const folder = await chrome.bookmarks.create({ parentId: rootId, title: ROLE_TITLES[role] });
    return folder.id;
  }

  async function focusTab(tab, selfTabId) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    // Leaving the new tab page behind would pile up empty tabs; close it last (it ends this script).
    if (selfTabId != null && selfTabId !== tab.id) await chrome.tabs.remove(selfTabId);
  }

  async function placeInGroup(tabIds, task, windowId, meta) {
    const groups = await chrome.tabGroups.query({ windowId });
    let plan = planGroup({ mapEntry: meta.groupMap[task.id], groups, windowId, taskTitle: task.title });
    if (plan.action === "join") {
      try {
        await chrome.tabs.group({ groupId: plan.groupId, tabIds });
        await store.setGroup(task.id, plan.groupId, windowId);
        return plan.groupId;
      } catch (e) {
        if (!isGone(e)) throw e;
        plan = { action: "create" }; // group closed between query and group()
      }
    }
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: task.title, color: colorFor(task.title) });
    await store.setGroup(task.id, groupId, windowId);
    return groupId;
  }

  /** Task folder as {id,title}, or null when the item is not in a task (or the task vanished). */
  async function taskFor(taskId) {
    if (!taskId || taskId === "loose") return null;
    try {
      const node = await getNode(taskId, "任務資料夾");
      return node.url ? null : { id: node.id, title: (node.title ?? "").trim() || "（未命名）" };
    } catch (e) {
      if (e instanceof Gone) return null;
      throw e;
    }
  }

  /**
   * Pins open into one tab group, "Top Pin", handled like a task keyed by the Top folder's id.
   * Null when Top does not exist (then pins open ungrouped rather than failing).
   */
  async function topTarget() {
    const { model } = await readModel();
    return model.folders.top ? { id: model.folders.top.id, title: TOP_GROUP_TITLE } : null;
  }

  /** Inbox age counts from when the item entered Inbox, not from its original dateAdded. */
  const inboxDate = (it, meta) => Math.max(it.dateAdded || 0, meta.inboxSince[it.id] ?? 0);

  async function sweepArchive({ model, meta }) {
    const aged = model.inbox.map((it) => ({ ...it, dateAdded: inboxDate(it, meta) }));
    const due = dueItems(aged, meta.settings.archiveDays, now());
    if (!due.length || !model.folders.inbox) return 0;
    const inboxId = model.folders.inbox.id;
    const archiveId = await ensureRole("archive", model, meta.settings);
    let moved = 0;
    for (const it of due) {
      try {
        // Another page or the user may have moved it already.
        if (!(await isInside(it.id, inboxId))) continue;
        await chrome.bookmarks.move(it.id, { parentId: archiveId });
        moved++;
      } catch (e) {
        if (!isGone(e)) throw e;
      }
    }
    return moved;
  }

  return {
    store,

    /** Everything the page renders. Also runs the archive sweep and metadata GC. */
    async load({ selfTabId = null } = {}) {
      let { tree, meta, model } = await readModel();
      const movedToArchive = await sweepArchive({ model, meta });
      if (movedToArchive) ({ tree, meta, model } = await readModel());

      const [tabs, groups, win] = await Promise.all([
        chrome.tabs.query({}),
        chrome.tabGroups.query({}),
        chrome.windows.getCurrent(),
      ]);
      await store.gc(allIds(tree));
      meta = await store.read();

      const iconUpdates = {};
      const decorate = (it) => {
        const tab = findOpenTab(it, tabs);
        const live = tab && /^https?:/i.test(tab.url ?? "") ? tab.url : null;
        if (live && !sameUrl(live, it.url) && meta.iconPage[it.id] !== live) iconUpdates[it.id] = live;
        return {
          ...it,
          openTabId: tab?.id ?? null,
          iconPage: live ?? meta.iconPage[it.id] ?? it.url,
          lastOpened: meta.lastOpened[it.id] ?? null,
        };
      };
      model.top = model.top.map(decorate);
      model.inbox = model.inbox.map((it) => ({ ...decorate(it), dateAdded: inboxDate(it, meta) }));
      model.archive = model.archive.map(decorate);
      if (Object.keys(iconUpdates).length) await store.setIconPages(iconUpdates);
      model.tasks = model.tasks.map((t) => {
        const items = t.items.map(decorate);
        const group = t.loose ? null : findTaskGroup({ mapEntry: meta.groupMap[t.id], groups, taskTitle: t.title });
        const last = Math.max(meta.lastOpened[t.id] ?? 0, ...items.map((i) => i.lastOpened ?? 0));
        return {
          ...t,
          items,
          collapsed: !!meta.collapsed[t.id],
          groupId: group?.id ?? null,
          openCount: items.filter((i) => i.openTabId != null).length,
          lastOpened: last || null,
        };
      });
      // Where each open tab is filed, for the "open tabs" list (D-016).
      const places = [
        ...model.top.map((item) => ({ item, place: { kind: "top", label: "Top" } })),
        ...model.tasks.flatMap((task) => task.items.map((item) => ({
          item,
          place: { kind: "task", label: task.title, taskId: task.loose ? null : task.id },
        }))),
        ...model.inbox.map((item) => ({ item, place: { kind: "inbox", label: "Inbox" } })),
      ];
      const openTabs = describeTabs(tabs, places, { selfTabId, extensionOrigin: chrome.runtime.getURL("") });
      const untracked = openTabs.filter((t) => !t.place);
      const topId = model.folders.top?.id;
      const topGroup = topId ? findTaskGroup({ mapEntry: meta.groupMap[topId], groups, taskTitle: TOP_GROUP_TITLE }) : null;
      model.topGroupId = topGroup?.id ?? null;
      // The "archive" key in `collapsed` means the Archive list is unfolded (it starts folded).
      model.archiveOpen = !!meta.collapsed.archive;
      // Whole tree for the bookmark drawer: bookmarks bar, other bookmarks, mobile.
      const bookmarkRoots = (tree[0]?.children ?? []).filter((n) => !n.url);
      // No root yet: offer folders that already look like one (welcome screen, D-029).
      const candidates = model.root ? [] : findCandidateRoots(tree, { exclude: meta.settings.rootTitle });
      return { model, settings: meta.settings, openTabs, untracked, bookmarkRoots, windowId: win.id, movedToArchive, candidates, now: now() };
    },

    /**
     * Focus the item's tab if open; otherwise open it into a group: the task's group when taskId
     * is given, the "Top Pin" group when group === "top".
     */
    async openItem(itemId, { selfTabId = null, taskId = null, group = null, background = false } = {}) {
      const node = await getNode(itemId);
      if (!isOpenable(node.url)) throw new Error("這個書籤無法從擴充開啟（例如 bookmarklet）");
      const meta = await store.read();
      const tabs = await chrome.tabs.query({});
      const existing = findOpenTab({ id: node.id, url: node.url }, tabs);
      await store.touch([node.id, taskId], now());
      if (existing) {
        if (!background) await focusTab(existing, selfTabId);
        return { focused: true, tabId: existing.id };
      }
      const task = group === "top" ? await topTarget() : await taskFor(taskId);
      const win = await chrome.windows.getCurrent();
      const reuseSelf = !background && selfTabId != null;
      const tabId = reuseSelf
        ? selfTabId
        : (await chrome.tabs.create({ url: node.url, windowId: win.id, active: !background })).id;
      if (task) await placeInGroup([tabId], task, win.id, meta);
      // Navigating our own tab unloads this page, so it goes last.
      if (reuseSelf) await chrome.tabs.update(selfTabId, { url: node.url });
      return { focused: false, tabId };
    },

    /** Open every page of a task that is not open yet, all in the task's group. */
    async openTask(taskId, { selfTabId = null, background = false } = {}) {
      const task = await taskFor(taskId);
      if (!task) throw new Gone("任務資料夾");
      const [sub] = await chrome.bookmarks.getSubTree(task.id);
      const items = flatten(sub).filter((i) => i.openable);
      const meta = await store.read();
      const tabs = await chrome.tabs.query({});
      const win = await chrome.windows.getCurrent();
      const created = [];
      let first = null;
      for (const it of items) {
        const open = findOpenTab(it, tabs);
        if (open) {
          first ??= open.id;
          continue;
        }
        const tab = await chrome.tabs.create({ url: it.url, windowId: win.id, active: false });
        created.push(tab.id);
        first ??= tab.id;
      }
      await store.touch([task.id, ...items.map((i) => i.id)], now());
      if (created.length) await placeInGroup(created, task, win.id, meta);
      if (first != null && !background) await focusTab(await getTab(first), selfTabId);
      return { opened: created.length, total: items.length };
    },

    /** Close the task's tabs. Bookmarks are untouched (tabs are disposable views). */
    async closeTask(taskId) {
      const task = await taskFor(taskId);
      if (!task) throw new Gone("任務資料夾");
      const meta = await store.read();
      const groups = await chrome.tabGroups.query({});
      const group = findTaskGroup({ mapEntry: meta.groupMap[task.id], groups, taskTitle: task.title });
      if (!group) return { closed: 0 };
      const tabs = await chrome.tabs.query({ groupId: group.id });
      if (tabs.length) await chrome.tabs.remove(tabs.map((t) => t.id));
      return { closed: tabs.length };
    },

    /** Bookmark an open tab into Inbox, then close it. If the bookmark fails, the tab stays. */
    async parkTab(tabId) {
      const tab = await getTab(tabId);
      const { model, meta } = await readModel();
      const inboxId = await ensureRole("inbox", model, meta.settings);
      const [inbox] = await chrome.bookmarks.getSubTree(inboxId);
      const duplicate = flatten(inbox).some((i) => sameUrl(i.url, tab.url));
      if (!duplicate) await chrome.bookmarks.create({ parentId: inboxId, title: tab.title || tab.url, url: tab.url });
      await chrome.tabs.remove(tab.id);
      return { duplicate };
    },

    /** Add an open tab to a task (bookmark it there) and move the tab into the task's group. */
    async fileTab(tabId, taskId) {
      const tab = await getTab(tabId);
      const task = await taskFor(taskId);
      if (!task) throw new Gone("任務資料夾");
      const [sub] = await chrome.bookmarks.getSubTree(task.id);
      let bookmark = flatten(sub).find((i) => sameUrl(i.url, tab.url));
      bookmark ??= await chrome.bookmarks.create({ parentId: task.id, title: tab.title || tab.url, url: tab.url });
      const meta = await store.read();
      await placeInGroup([tab.id], task, tab.windowId, meta);
      return { bookmarkId: bookmark.id };
    },

    /** Bookmark an open tab into Top. The tab stays open (it is now a pin that happens to be open). */
    async pinTab(tabId) {
      const tab = await getTab(tabId);
      const { model, meta } = await readModel();
      const topId = await ensureRole("top", model, meta.settings);
      const [top] = await chrome.bookmarks.getSubTree(topId);
      let bookmark = flatten(top).find((i) => sameUrl(i.url, tab.url));
      const duplicate = !!bookmark;
      bookmark ??= await chrome.bookmarks.create({ parentId: topId, title: tab.title || tab.url, url: tab.url });
      await placeInGroup([tab.id], { id: topId, title: TOP_GROUP_TITLE }, tab.windowId, await store.read());
      return { duplicate };
    },

    /**
     * Apply one action to several open tabs ("other open tabs" multi-select).
     * op: "inbox" | "top" | "task" (needs taskId) | "close". One tab closing meanwhile does not stop
     * the rest; the result says how many went through.
     */
    async bulkTabs(tabIds, op, { taskId = null } = {}) {
      const one = {
        inbox: (id) => this.parkTab(id),
        top: (id) => this.pinTab(id),
        task: (id) => this.fileTab(id, taskId),
        close: async (id) => {
          await getTab(id);
          await chrome.tabs.remove(id);
        },
      }[op];
      if (!one) throw new Error(`不支援的批次動作：${op}`);
      if (op === "task" && !(await taskFor(taskId))) throw new Gone("任務資料夾");
      let done = 0;
      let gone = 0;
      for (const id of tabIds) {
        try {
          await one(id);
          done++;
        } catch (e) {
          if (!isGone(e)) throw e;
          gone++;
        }
      }
      return { done, gone };
    },

    /** Close the tabs in the "Top Pin" group. Bookmarks are untouched. */
    async closeTop() {
      const target = await topTarget();
      if (!target) return { closed: 0 };
      const meta = await store.read();
      const groups = await chrome.tabGroups.query({});
      const group = findTaskGroup({ mapEntry: meta.groupMap[target.id], groups, taskTitle: target.title });
      if (!group) return { closed: 0 };
      const tabs = await chrome.tabs.query({ groupId: group.id });
      if (tabs.length) await chrome.tabs.remove(tabs.map((t) => t.id));
      return { closed: tabs.length };
    },

    /**
     * Create a task folder under Groups (or reuse one with the same name), optionally filing a tab
     * into it. Reusing avoids two "Weekly report" folders when the user drops twice.
     */
    async createTask(title, { tabId = null } = {}) {
      const name = String(title ?? "").trim();
      if (!name) throw new Error("任務名稱不能是空的");
      if (tabId != null) await getTab(tabId); // fail before creating anything
      const { model, meta } = await readModel();
      const groupsId = await ensureRole("groups", model, meta.settings);
      const existing = (await chrome.bookmarks.getChildren(groupsId))
        .find((c) => !c.url && normTitle(c.title) === normTitle(name));
      const folder = existing ?? (await chrome.bookmarks.create({ parentId: groupsId, title: name }));
      if (tabId != null) await this.fileTab(tabId, folder.id);
      return { taskId: folder.id, reused: !!existing };
    },

    /**
     * Move a URL bookmark into Top, Inbox or a task (drag and drop between sections).
     * target: { role: "top" | "inbox" } or { taskId }.
     */
    async moveItem(itemId, target) {
      const node = await getNode(itemId);
      if (!node.url) throw new Error("只能移動網頁書籤，資料夾請在書籤管理員裡整理");
      let folderId;
      if (target?.taskId) {
        const task = await taskFor(target.taskId);
        if (!task) throw new Gone("任務資料夾");
        folderId = task.id;
      } else if (target?.role === "top" || target?.role === "inbox") {
        const { model, meta } = await readModel();
        folderId = await ensureRole(target.role, model, meta.settings);
      } else {
        throw new Error(`不支援的目的地：${JSON.stringify(target)}`);
      }
      if (node.parentId === folderId) return { moved: false };
      await chrome.bookmarks.move(node.id, { parentId: folderId });
      if (target.role === "inbox") await store.setInboxSince(node.id, now());
      return { moved: true };
    },

    /**
     * Put a URL bookmark right before (or after) another one: reordering inside a task or Top, or
     * moving into another folder at a chosen spot. Both nodes are re-read; the anchor's current
     * folder and index decide the spot.
     */
    async placeItem(itemId, anchorId, { after = false } = {}) {
      const node = await getNode(itemId);
      if (!node.url) throw new Error("只能移動網頁書籤，資料夾請在書籤管理員裡整理");
      const anchor = await getNode(anchorId, "目標位置的書籤");
      if (anchor.id === node.id) return { moved: false };
      // Chrome reads index as a position before removal, so "after the anchor" is anchor.index + 1.
      const index = anchor.index + (after ? 1 : 0);
      const sameFolder = node.parentId === anchor.parentId;
      if (sameFolder && (index === node.index || index === node.index + 1)) return { moved: false };
      await chrome.bookmarks.move(node.id, { parentId: anchor.parentId, index });
      const { model } = await readModel();
      if (!sameFolder && model.folders.inbox && anchor.parentId === model.folders.inbox.id) {
        await store.setInboxSince(node.id, now());
      }
      return { moved: true };
    },

    /**
     * Make an existing bookmark folder a task by moving it under Groups (bookmark drawer → ＋ 新任務).
     * Refuses the browser's top-level folders, the root folder, its role folders, and any folder that
     * contains Groups — moving those would tear the structure apart.
     */
    async adoptFolder(folderId) {
      const node = await getNode(folderId, "資料夾");
      if (node.url) throw new Error("這不是資料夾");
      const { model, meta } = await readModel();
      const protectedIds = new Set([model.root?.id, ...Object.values(model.folders).map((f) => f?.id)]);
      const parent = node.parentId ? await getNode(node.parentId, "上層資料夾") : null;
      if (!parent?.parentId || protectedIds.has(node.id)) throw new Error("這個資料夾不能變成任務");
      const groupsId = await ensureRole("groups", model, meta.settings);
      if (await isInside(groupsId, node.id)) throw new Error("這個資料夾包含 Groups，不能變成任務");
      if (node.parentId === groupsId) return { moved: false };
      await chrome.bookmarks.move(node.id, { parentId: groupsId });
      return { moved: true };
    },

    /** Move an archived bookmark back into Inbox; its archive countdown starts over. */
    async restoreItem(itemId) {
      return this.moveItem(itemId, { role: "inbox" });
    },

    /** chrome://bookmarks opened at the root folder (or the whole tree when there is none). */
    async openBookmarkManager({ selfTabId = null } = {}) {
      const { model } = await readModel();
      const url = model.root ? `chrome://bookmarks/?id=${model.root.id}` : "chrome://bookmarks/";
      if (selfTabId != null) await chrome.tabs.update(selfTabId, { url });
      else await chrome.tabs.create({ url });
    },

    /** Rename a URL bookmark (what the page shows as its title). Empty names are refused. */
    async renameItem(itemId, title) {
      const name = String(title ?? "").trim();
      if (!name) throw new Error("名稱不能是空的");
      const node = await getNode(itemId);
      if (node.title === name) return { changed: false };
      await chrome.bookmarks.update(node.id, { title: name });
      return { changed: true };
    },

    /**
     * Rename a task folder, and its open tab group with it so the two keep matching (groups are found
     * by title after a restart; a stale group title would orphan the group).
     */
    async renameTask(taskId, title) {
      const name = String(title ?? "").trim();
      if (!name) throw new Error("任務名稱不能是空的");
      const node = await getNode(taskId, "任務資料夾");
      if (node.url) throw new Error("這不是任務資料夾");
      if (node.title === name) return { changed: false };
      const meta = await store.read();
      const group = findTaskGroup({
        mapEntry: meta.groupMap[node.id],
        groups: await chrome.tabGroups.query({}),
        taskTitle: node.title,
      });
      await chrome.bookmarks.update(node.id, { title: name });
      if (group) {
        try {
          // Colour follows the title (colorFor), so the card and the tab group stay the same colour.
          await chrome.tabGroups.update(group.id, { title: name, color: colorFor(name) });
        } catch (e) {
          if (!isGone(e)) throw e; // group closed meanwhile: the bookmark rename is what matters
        }
      }
      return { changed: true, groupRenamed: !!group };
    },

    /** Move a bookmark to Archive ("done"). Never deletes. */
    async archiveItem(itemId) {
      await getNode(itemId);
      const { model, meta } = await readModel();
      const archiveId = await ensureRole("archive", model, meta.settings);
      const node = await getNode(itemId);
      if (node.parentId !== archiveId) await chrome.bookmarks.move(itemId, { parentId: archiveId });
    },

    /** Create the root folder and any missing role folder. Leaves everything else alone. */
    async ensureStructure() {
      const { model, meta } = await readModel();
      for (const role of Object.keys(ROLE_TITLES)) {
        await ensureRole(role, buildModel(await chrome.bookmarks.getTree(), meta.settings), meta.settings);
      }
      return model.root == null;
    },

    async setCollapsed(taskId, value) {
      return store.setCollapsed(taskId, value);
    },

    async saveSettings(patch) {
      return store.saveSettings(patch);
    },

    readAppearance: () => store.readAppearance(),
    saveAppearance: (patch) => store.saveAppearance(patch),

    /** Archive sweep alone, for the service worker. */
    async sweep() {
      return sweepArchive(await readModel());
    },
  };
}
