// Runs synchronously in <head>, before first paint: replays the last appearance tokens newtab.js
// mirrored to localStorage, so a new tab opens in the user's theme instead of flashing the default
// (D-022). chrome.storage.local stays the source of truth; this copy is only a cache.
try {
  const t = JSON.parse(localStorage.getItem("cairntab.tokens") || "null");
  if (t) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(t.attrs || {})) if (v != null) root.setAttribute(k, v);
    for (const [k, v] of Object.entries(t.vars || {})) root.style.setProperty(k, v);
  }
} catch {
  /* cache only */
}
