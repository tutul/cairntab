// Service worker: the Inbox -> Archive sweep, so items age out even when no new tab is opened for
// days (the new tab page also sweeps on every render), plus the toolbar icon (D-028): a click opens
// a new tab, i.e. CairnTab; its right-click menu links to the project on GitHub.

import { createActions } from "./chrome/actions.js";

const ALARM = "archive-sweep";
const actions = createActions(chrome);

async function sweep() {
  try {
    await actions.sweep();
  } catch (e) {
    // Bookmarks changing under us is normal; anything else is worth a console line, not a crash.
    console.warn("[cairntab] archive sweep skipped:", e?.message ?? e);
  }
}

const REPO_URL = "https://github.com/tutul/cairntab";
const MENU_REPO = "open-repo";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
  // Menu items persist across restarts; recreate on install/update so there is never a duplicate id.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_REPO, title: "在 GitHub 查看 CairnTab", contexts: ["action"] });
  });
  sweep();
});

// A new tab is CairnTab (chrome_url_overrides), so the icon simply opens one next to the current tab.
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ windowId: tab?.windowId, index: tab ? tab.index + 1 : undefined });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_REPO) chrome.tabs.create({ url: REPO_URL, windowId: tab?.windowId });
});
chrome.runtime.onStartup.addListener(sweep);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) sweep();
});
