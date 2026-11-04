// Matching bookmarks to open tabs and planning tab-group placement. Pure.

import { normTitle } from "./model.js";
import { MATCH, matchScore } from "./url.js";

const tabUrl = (t) => t.url || t.pendingUrl || "";

/**
 * The open tab showing this item: an exact URL match, else the closest tab scoring at least
 * `minScore` (see url.matchScore). Decided only by the tab's current URL — once the user browses
 * away, the tab is no longer this item's (D-014: "點出去就點出去"; it then shows
 * under other tabs and can be filed again).
 */
export function findOpenTab(item, tabs, { minScore = MATCH.SITE } = {}) {
  let best = null;
  let bestScore = MATCH.NONE;
  for (const t of tabs) {
    const score = matchScore(item.url, tabUrl(t));
    if (score === MATCH.EXACT) return t;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return bestScore >= minScore ? best : null;
}

const hiddenTab = (t, { selfTabId, extensionOrigin }) => {
  const url = tabUrl(t);
  if (t.id === selfTabId) return true;
  if (!url || /^(chrome|edge|about|devtools):/i.test(url)) return true;
  return !!extensionOrigin && url.startsWith(extensionOrigin);
};

/**
 * Every open tab the page lists, each with `place`: where in Pin it already lives (the place of the
 * closest item matching at PAGE or better), or null when it is not filed anywhere.
 * `places` is [{ item, place }]. Our own page and browser-internal pages are left out.
 * PAGE, not SITE, on purpose: a front-page pin like github.com marks itself open when any GitHub tab
 * is, but must not label every GitHub tab as filed.
 */
export function describeTabs(tabs, places, { selfTabId = null, extensionOrigin = "" } = {}) {
  return tabs
    .filter((t) => !hiddenTab(t, { selfTabId, extensionOrigin }))
    .map((t) => {
      let place = null;
      let best = MATCH.PAGE - 1;
      for (const p of places) {
        const score = matchScore(p.item.url, tabUrl(t));
        if (score > best) {
          best = score;
          place = p.place;
        }
      }
      return { ...t, place };
    });
}

/** Open tabs not filed anywhere in Pin. */
export function untrackedTabs(tabs, items, opts = {}) {
  return describeTabs(tabs, items.map((item) => ({ item, place: true })), opts).filter((t) => !t.place);
}

/**
 * Where a task's new tab should go.
 * 1. the remembered group, if it still exists in this window
 * 2. a group in this window with the task's title
 * 3. a new group
 * @returns {{action:"join", groupId:number} | {action:"create"}}
 */
export function planGroup({ mapEntry, groups, windowId, taskTitle }) {
  const inWindow = groups.filter((g) => g.windowId === windowId);
  if (mapEntry && inWindow.some((g) => g.id === mapEntry.groupId)) {
    return { action: "join", groupId: mapEntry.groupId };
  }
  const byTitle = inWindow.find((g) => normTitle(g.title) === normTitle(taskTitle));
  if (byTitle) return { action: "join", groupId: byTitle.id };
  return { action: "create" };
}

/** The group currently showing a task, anywhere. Same precedence as planGroup minus the window. */
export function findTaskGroup({ mapEntry, groups, taskTitle, windowId = null }) {
  if (mapEntry) {
    const g = groups.find((x) => x.id === mapEntry.groupId);
    if (g) return g;
  }
  const pool = windowId == null ? groups : groups.filter((g) => g.windowId === windowId);
  return pool.find((g) => normTitle(g.title) === normTitle(taskTitle)) ?? null;
}

const COLORS = ["blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple"];

/** Stable colour per task title, so a task looks the same every time it is reopened. */
export function colorFor(title) {
  let h = 0;
  for (const ch of normTitle(title)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
