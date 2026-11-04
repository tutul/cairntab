// Service worker: only runs the Inbox -> Archive sweep, so items age out even when no new tab is
// opened for days. The new tab page also sweeps on every render.

import { createActions } from "./chrome/actions.js";

const ALARM = "archive-sweep";
const actions = createActions(chrome);

async function sweep() {
  try {
    await actions.sweep();
  } catch (e) {
    // Bookmarks changing under us is normal; anything else is worth a console line, not a crash.
    console.warn("[pin] archive sweep skipped:", e?.message ?? e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
  sweep();
});
chrome.runtime.onStartup.addListener(sweep);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) sweep();
});
