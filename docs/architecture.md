# Architecture

## Bookmark layout

```
Bookmarks bar
└─ CairnTab                 root; title configurable (default "CairnTab"), matched case-insensitively
   ├─ Pin  (or Top)         icon row. URLs anywhere below are flattened.
   ├─ Groups
   │  ├─ <task>             one task per direct subfolder; URLs below it are flattened
   │  └─ (loose URLs)       shown as task "未分組"; open without a tab group
   ├─ Inbox                 parked pages; dateAdded drives archiving
   └─ Archive               where Inbox items go when due or marked done
```

Lookup order for the root: a folder with the configured title directly under the bookmarks bar,
then directly under "Other bookmarks", then anywhere (first by tree order). Role folders are direct
children of the root, matched case-insensitively. Missing role folders render as empty sections; a
button creates them. With no root at all the page shows a welcome screen (D-029): a button that creates
the root and its role folders, plus `lib/model.findCandidateRoots` — folders under another name that
have at least two role-named children (e.g. an older `Pin`) — each with a button that just sets
`settings.rootTitle` to it.

## Storage (`chrome.storage.local`)

| Key | Shape | Lost means |
|---|---|---|
| `settings` | `{ rootTitle, archiveDays, openMode, closeOnSwitch, inboxSort }` | defaults: `"CairnTab"`, 30, `"switch"`, `true`, `"expiring"` (D-024, D-025, D-027) |
| `lastOpened` | `{ [bookmarkId]: epochMs }` | "N days ago" shows nothing until reopened |
| `groupMap` | `{ [taskFolderId]: { groupId, windowId } }` | next open finds the group by title |
| `collapsed` | `{ [taskFolderId \| "loose"]: true, archive: true }` | cards unfold; for `archive`, `true` means the list is *open* |
| `iconPage` | `{ [bookmarkId]: url }` the URL its tab actually loaded, when it differs | icons fall back to the bookmark URL, which may show Chrome's default globe |
| `appearance` | `lib/theme.DEFAULT_APPEARANCE` shape, always stored normalized | default look (D-022) |
| `inboxSince` | `{ [bookmarkId]: epochMs }` when moved into Inbox by CairnTab | restored items age from their original `dateAdded` (D-013) |

## Flows

**Render** `getTree()` → `lib/model.buildModel(tree, settings)` → model of sections, each item
`{ id, title, url, dateAdded, openable }`. Open tabs from `tabs.query({})` are matched to items with
`lib/tabs.findOpenTab` (current URL only, D-014). Render policy (D-011):
- triggers: bookmark events, tab created/removed/moved, `tabs.onUpdated` only for url/group/pinned/
  load-complete (never title), tab-group events, the page becoming visible, ↻
- bursts are coalesced (150 ms); while the page is hidden nothing renders, it is marked stale and
  re-reads once on becoming visible; during a drag or an open `<select>` the render waits
- one render ≈ 1 ms of logic for a large personal tree (340 bookmarks, 30 tabs) plus Chrome API calls
  and the DOM rebuild; metadata GC writes storage only when something was actually removed

**Tab matching** (`lib/url.matchScore`, `lib/tabs.findOpenTab`, D-012, D-014) by the tab's current
URL only: EXACT > PAGE (query and locale segment ignored) > INSIDE > SITE (front-page bookmarks). The open dot and click target accept SITE and up; `untrackedTabs` only hides PAGE and up,
so a github.com pin cannot swallow every GitHub tab.

**Open pin** If a tab matches the URL (see Tab matching) → focus it (and its window),
wherever it is. Otherwise open it and place it in the "Cairn Pin" group, using the same placement as
a task with the Pin folder's id as the `groupMap` key (D-010).

**Open task page** Re-read the task folder. If the page is already open → focus it. Otherwise
create the tab, then place it with `lib/groups.planGroup`:
1. `groupMap[taskId]` exists, the group still exists and is in this window → join it;
2. else a group in this window titled like the task → join it;
3. else create a group, title it, store the mapping.
Closing tabs or groups only invalidates the map entry, which step 1 detects.

**Park tab** Ensure `Inbox` exists → `bookmarks.create` in it → close the tab. If the bookmark
write fails the tab stays open.

**Drag and drop** (`newtab.js`) Sources: open tabs and item rows/pins. Targets: Top → `pinTab`
(bookmark, tab stays), a task → `fileTab`, Inbox → `parkTab` (bookmark, tab closes), ＋ 新任務 →
`createTask` (reuses a same-named task). Dragging a bookmark item calls `moveItem` instead. The
payload is kept in a module variable because `dragover` cannot read `dataTransfer` contents.
Re-renders are deferred while a drag or a `<select>` is active.

**Reorder** (`placeItem`) dropping a bookmark on a row/pin moves it to the anchor's folder at
`anchor.index` (+1 for "after"). Chrome reads `move` indices as pre-removal positions; the fake does
the same so tests catch off-by-one moves.

**Bookmark drawer** renders `load().bookmarkRoots`. Items drag as `{kind:"item"}`, folders as
`{kind:"folder"}`; folders are accepted only by ＋ 新任務 (`adoptFolder`, which refuses top-level,
the root/role folders and ancestors of Groups). Drag sources stop `dragstart` propagation so a nested
item is not overwritten by its parent folder rows.

**Archive sweep** In the service worker on startup and on a daily alarm, and on each render:
`lib/archive.dueItems(inbox, archiveDays, now)` → for each, re-read the node, confirm it is still in
Inbox, move to `Archive`. `archiveDays = 0` disables it.

**Search** (D-030) `lib/search.searchEntries(model, openTabs)` → one entry per openable thing (Top,
task pages, Inbox, unfiled tabs; not Archive), then `search(entries, query)` → ranked results with
highlight ranges. Recomputed from `state` on each keystroke and each render; nothing is indexed or
stored. Opens go through `openItem` (with `duplicate` for a second copy), `switchToTab` and
`duplicateTab`.

**Language** (D-033) `lib/i18n.createT(lang)` over `extension/locales/*.js`; `settings.language`
("auto" | "zh-Hant" | "en") resolved against `navigator.languages`. Static HTML carries `data-i18n`
keys filled by `applyStaticText()`; everything else renders through `t()`, so switching re-renders
in place. Actions throw `UserError(key, params)` and `Gone(what)`; the page translates them. The
model's own labels (the loose task, an untitled task) come from `createActions({ labels })`.
Manifest name/description, the toolbar tooltip and the toolbar menu use Chrome's `_locales/`
(browser language only; they cannot follow the in-page setting).

**Drawers** (D-036) Two fixed slots, `#slotLeft` and `#slotRight`. The three views
(`#bookmarksView`, `#tabsView`, `#settings`) are moved into a slot per `settings.drawers`
(cached in localStorage as `cairntab.drawers` for the first paint). A slot shows one view; settings
cover their slot while open. Open bookmarks/tabs are remembered in `cairntab.panels.open`.

## Why new tab, not side panel

A side panel is per window and cannot be guaranteed open in a new window; a new tab page appears
in every window via ⌘T and matches a common habit: "finish something, open a new tab, decide
what next". See `decisions.md` D-002.

## Appearance (D-022)

```
chrome.storage.local.appearance ──lib/theme.themeTokens──▶ { attrs: data-theme/bg/density/pin-labels,
                                                              vars: --accent-base, --radius, --fs, … }
                                    newtab.js applyAppearance ──▶ <html> attributes + inline custom properties
                                                              └─▶ localStorage "cairntab.tokens" (cache)
next new tab: boot.js (sync, in <head>) replays the cache before first paint; newtab.js then applies
the stored truth.
IndexedDB "cairntab"/files/"wallpaper": the background image Blob (downscaled to 2560px, JPEG) —
wallpaper.js. Exposed to CSS as --wallpaper (an object URL); data-bg="image" without a Blob renders plain.
```

CSS reads only tokens: the light palette on `:root`, the dark palette under
`prefers-color-scheme: dark` unless `data-theme="light"`, and again under `data-theme="dark"`.
`--accent` is derived from `--accent-base` (lightened in dark mode). Tile tints for Top come from
sampling the favicon into a 16×16 OffscreenCanvas (`lib/theme.dominantColor`); letter tiles use the
same hash colour as tab groups. Transitions are only on state changes (hover, fold, drawers, toast),
never on enter: a render replaces the DOM and would replay them.
