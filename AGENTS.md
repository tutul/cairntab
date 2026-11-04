# CairnTab — agent notes

Chrome MV3 new tab page: pins, tasks and an inbox backed by a bookmarks folder.
Read `docs/brief.md` (what and why), `docs/conventions.md` (rules), `docs/architecture.md`
(layout, storage, flows), `docs/decisions.md` (why it is this way) before changing behaviour.

## Invariants

Breaking any of these makes the extension worse than not having it:

1. **Never delete a bookmark.** Archive = move into `Pin/Archive`. The user's bookmarks are the
   only copy of their tasks.
2. **Tabs never write bookmarks.** Data flows bookmarks → tabs. Closing a tab or group must not
   change the bookmark tree.
3. **Re-read before every write.** The user edits bookmarks at any time; a stale id must end in
   `Gone` + re-render, never a write to the wrong node.
4. **Losing `chrome.storage.local` loses only conveniences.** Nothing the user cares about lives
   only there.
5. **`extension/lib/` stays pure** (no `chrome.*`, no DOM) — `make check` enforces it.

## Commands

| | |
|---|---|
| `make ci` | syntax + manifest + purity checks, then all tests. Run before every commit. |
| `make test` | `node:test` suite only |
| `make preview` | serves the repo with caching off; open `http://127.0.0.1:8770/dev/preview.html` (real page, fake Chrome; `?demo` = public demo data, `?bare` = Pin folder without role folders) |
| `make package` | zip `extension/` into `dist/` |
| `make icons` | re-render `extension/icons/*.png` from `assets/*.svg` (needs `rsvg-convert`) |
| `make screenshots` | re-render `docs/screenshots/` from `dev/demo.js` (needs `make preview` running and Chrome) |

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.

## Traps

| Symptom | Cause | Do instead |
|---|---|---|
| A panel with `hidden` still shows | a component rule like `display:flex` beats the `hidden` attribute | keep the global `[hidden]{display:none!important}` in `newtab.css` |
| Preview runs old code after an edit ("actions.pinTab is not a function") | `python -m http.server` sends no Cache-Control, so the browser heuristically caches ES modules | use `make preview` (`scripts/serve.py`, sends `no-store`); if a stale copy is already cached, `fetch(url, {cache:"reload"})` each module once |
| A drag is cancelled halfway, or an open `<select>` closes by itself | a re-render replaced the DOM; ticker tabs (prices, chats) fire `tabs.onUpdated` every second | `scheduleRender` waits while `isBusy()`; `onUpdated` only re-renders on url/group/pinned/complete, never on title |
| Keyboard shortcuts on the page do nothing until you click | Chrome keeps focus in the address bar on new tab pages | keys (B/T/R/S/Esc) are a bonus; every action must also work by mouse |
| Drag from the bookmark drawer is refused by every target | `dragstart` bubbled from a bookmark up through its folder rows; the outermost folder became the payload | drag sources call `stopPropagation()` in `dragstart` |
| Drop silently cancelled on a row | `dragover` called `preventDefault()` but left `dropEffect` unset; Chrome picked an effect the source does not allow | every drop target sets `dataTransfer.dropEffect = "move"` |
| An open site shows Chrome's default globe icon | `_favicon` only knows URLs Chrome loaded; a redirecting bookmark URL gets the globe (a valid image, so `onerror` never fires) | ask with the tab's real URL (`item.iconPage`), remembered in `iconPage` |
| Every Google search tab looks "already filed" | PAGE matching ignored the query; one bookmarked search matched all searches | a bookmark's own query params must be present in the tab (`queryCovered`) |
| Reordering lands one slot off | Chrome's `bookmarks.move` index is a pre-removal position within the same folder | `placeItem` passes `anchor.index (+1)`; the fake implements the same rule |
| `make test` with `node --test test/` fails "Cannot find module" | Node 24 treats a directory argument as a module path | use the glob `'test/*.test.js'` (the Makefile does) |
| Code after `chrome.tabs.update(selfTabId, {url})` never runs | navigating our own tab unloads the page | do every storage/group write before it; it must be the last call |
| Every task's fold arrow looked "pressed" | a generic `.icon-btn[aria-expanded="true"]` highlight meant for header toggles also matched the fold buttons | scope it to `.bar .icon-btn` |
| An entry animation flickers on every bookmark event | each render replaces the DOM, so CSS enter animations replay | animate only state changes (hover, fold, drawers, toast) (D-022) |
| A preview screenshot shows half-light, half-dark cards | it was taken during the .25s theme transition | wait ~1s or screenshot again before judging |

## Current state (2026-11-04)

- v0.1.0, public, load-unpacked only; UI in Traditional Chinese. 86 tests (`make ci`); every UI
  change is also checked in `dev/preview.html`.
- Verified in real Chrome: tab groups (tasks, Top Pin), favicons, drag and drop, drawers. Not
  formally tested: recovering task groups by title after a Chrome restart.
- Feature set: Top pins (× archive, ✎ rename, reorder), tasks (fold, rename incl. tab group, open one
  / all, 收起), Inbox with configurable archive days and Archive view, bookmark drawer (left), open-tabs
  drawer (right, closed by default) with multi-select, settings in the right drawer, click behaviour
  (switch / stay, keep CairnTab), B/T/R/S/Esc keys, appearance settings (D-022). Design history:
  `docs/decisions.md` D-001…D-027.
- Not built yet: per-task "review every N days" reminders, English UI/i18n, a Chrome Web Store
  listing. Not possible: Android (Chrome Android has no extensions; the Pin folder syncs anyway).
- Apache-2.0; `NOTICE` credits the author and must ship with copies (D-026). Fixtures, demo data
  (`dev/demo.js`) and screenshots use public sites and made-up titles only; never put real profile
  data in the repo (CONTRIBUTING.md).
