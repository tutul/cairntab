// The service worker's wiring (D-028): the toolbar icon opens a new tab, its menu opens the repo.
// Runs the real background.js against stubs that record listeners and calls.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createFakeChrome } from "./fake-chrome.js";
import { sampleTree } from "./fixtures.js";

test("toolbar icon opens a new tab; the action menu links to GitHub", async () => {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const created = [];
  const menus = [];
  const chrome = createFakeChrome({ tree: sampleTree() });
  Object.assign(chrome, {
    runtime: { ...chrome.runtime, onInstalled: on("installed"), onStartup: on("startup") },
    alarms: { create() {}, onAlarm: on("alarm") },
    action: { onClicked: on("action") },
    contextMenus: {
      removeAll: (cb) => cb(),
      create: (item) => menus.push(item),
      onClicked: on("menu"),
    },
  });
  chrome.tabs.create = async (opts) => { created.push(opts); return { id: 99, ...opts }; };
  globalThis.chrome = chrome;
  await import(`../extension/background.js?t=${Date.now()}`);

  listeners.installed();
  assert.deepEqual(menus.map((m) => [m.id, m.contexts]), [["open-repo", ["action"]]]);

  listeners.action({ windowId: 3, index: 4 });
  assert.deepEqual(created.at(-1), { windowId: 3, index: 5 }, "a plain new tab (CairnTab) next to the current one");

  listeners.menu({ menuItemId: "open-repo" }, { windowId: 3 });
  assert.equal(created.at(-1).url, "https://github.com/tutul/cairntab");
  delete globalThis.chrome;
});
