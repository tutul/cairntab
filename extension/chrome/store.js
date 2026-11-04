// chrome.storage.local wrapper. Everything here is a convenience: losing it must never lose data
// (bookmarks are the source of truth; see docs/conventions.md).

import { INBOX_SORTS } from "../lib/archive.js";
import { normalizeAppearance } from "../lib/theme.js";

// openMode: what a plain click does — "switch" goes to the page (this tab becomes it), "stay" opens it
// in the background and keeps CairnTab in front (D-024). ⌘/Ctrl-click always does the other one.
// closeOnSwitch: when a click goes to the page, whether the CairnTab tab turns into it / closes (true)
// or stays where it is and the page opens in a new tab (false) (D-025).
// inboxSort: "expiring" (closest to archiving first), "newest" (latest first) or "manual" (bookmark
// order, drag to reorder) (D-027).
export const DEFAULT_SETTINGS = Object.freeze({
  rootTitle: "Pin", archiveDays: 30, openMode: "switch", closeOnSwitch: true, inboxSort: "expiring",
});
const KEYS = ["settings", "lastOpened", "groupMap", "collapsed", "inboxSince", "iconPage"];

export function createStore(chrome) {
  const local = chrome.storage.local;

  async function read() {
    const got = await local.get(KEYS);
    return {
      settings: { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) },
      lastOpened: got.lastOpened ?? {},
      groupMap: got.groupMap ?? {},
      collapsed: got.collapsed ?? {},
      inboxSince: got.inboxSince ?? {},
      iconPage: got.iconPage ?? {},
    };
  }

  async function update(key, fn) {
    const got = await local.get(key);
    const next = fn(got[key] ?? {});
    await local.set({ [key]: next });
    return next;
  }

  return {
    read,

    async saveSettings(patch) {
      return update("settings", (s) => {
        const next = { ...DEFAULT_SETTINGS, ...s, ...patch };
        const days = Math.floor(Number(next.archiveDays));
        next.archiveDays = Number.isFinite(days) && days > 0 ? days : 0;
        next.rootTitle = String(next.rootTitle ?? "").trim() || DEFAULT_SETTINGS.rootTitle;
        if (!["switch", "stay"].includes(next.openMode)) next.openMode = DEFAULT_SETTINGS.openMode;
        next.closeOnSwitch = next.closeOnSwitch !== false;
        if (!INBOX_SORTS.includes(next.inboxSort)) next.inboxSort = DEFAULT_SETTINGS.inboxSort;
        return next;
      });
    },

    /** Appearance (D-022). Always returns a complete, normalized object. */
    async readAppearance() {
      const got = await local.get("appearance");
      return normalizeAppearance(got.appearance);
    },

    async saveAppearance(patch) {
      const got = await local.get("appearance");
      const next = normalizeAppearance({ ...normalizeAppearance(got.appearance), ...patch });
      await local.set({ appearance: next });
      return next;
    },

    async touch(ids, now = Date.now()) {
      return update("lastOpened", (m) => {
        for (const id of ids) if (id != null) m[id] = now;
        return m;
      });
    },

    async setGroup(taskId, groupId, windowId) {
      return update("groupMap", (m) => ({ ...m, [taskId]: { groupId, windowId } }));
    },

    /**
     * When an existing bookmark was moved into Inbox. Chrome's dateAdded cannot be changed, so
     * without this a page restored from Archive (or dragged in from a task) would be archived again
     * by the very next sweep. Losing it only means such items age from their original dateAdded.
     */
    async setInboxSince(bookmarkId, ts) {
      return update("inboxSince", (m) => ({ ...m, [bookmarkId]: ts }));
    },

    /**
     * The page URL to ask Chrome's icon cache about, per bookmark. Chrome only knows an icon for URLs
     * it has loaded; a bookmark URL that redirects (or came from another browser) has none and shows
     * the default globe, while the tab it opened into does. Losing this only brings the globe back.
     */
    async setIconPages(updates) {
      return update("iconPage", (m) => ({ ...m, ...updates }));
    },

    /** Remember whether a task card is folded. Keyed by task folder id ("loose" for 未分組). */
    async setCollapsed(taskId, value) {
      return update("collapsed", (m) => {
        if (value) m[taskId] = true;
        else delete m[taskId];
        return m;
      });
    },

    /**
     * Drop entries whose bookmark is gone. Call only with a complete id set
     * from a successful getTree(): a partial read during sync would otherwise wipe everything.
     */
    async gc(validBookmarkIds) {
      const meta = await read();
      const keep = (obj, ok) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => ok(k, v)));
      const next = {
        lastOpened: keep(meta.lastOpened, (k) => validBookmarkIds.has(k)),
        groupMap: keep(meta.groupMap, (k) => validBookmarkIds.has(k)),
        collapsed: keep(meta.collapsed, (k) => ["loose", "archive"].includes(k) || validBookmarkIds.has(k)),
        inboxSince: keep(meta.inboxSince, (k) => validBookmarkIds.has(k)),
        iconPage: keep(meta.iconPage, (k) => validBookmarkIds.has(k)),
      };
      // Write only what shrank: gc runs on every render, and an unconditional set() was one
      // storage write per render (measured 2026-11-04) for nothing.
      const changed = Object.fromEntries(
        Object.entries(next).filter(([k, v]) => Object.keys(v).length !== Object.keys(meta[k]).length),
      );
      if (Object.keys(changed).length) await local.set(changed);
      return Object.keys(changed);
    },
  };
}
