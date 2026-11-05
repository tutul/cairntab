# CairnTab

**English** | [繁體中文](README-zh.md)

**Tasks stay, tabs come and go.**

CairnTab replaces Chrome's new tab page with a small task board built from one bookmarks folder.
Pins you reach in one click, tasks that open one page at a time into their own tab group, and an
inbox for "come back to this" pages — kept as bookmarks instead of live tabs, so they stop eating
memory.

> A *cairn* is a stack of stones that marks a trail: a place you mean to come back to.
> CairnTab marks your tasks the same way, so the tabs themselves can be closed without worry.

Created by [TuTu](https://github.com/tutul). Status: v0.1, load-unpacked only. The UI is in English
and Traditional Chinese (settings → General; follows the browser by default). Licensed under Apache-2.0 — see [License](#license).

![CairnTab: pins, task cards and the Inbox](docs/screenshots/overview.png)

<table>
<tr>
<td><img src="docs/screenshots/dark.png" alt="Dark theme with a teal accent"></td>
<td><img src="docs/screenshots/open-tabs.png" alt="Open-tabs drawer showing where each tab is filed"></td>
<td><img src="docs/screenshots/settings.png" alt="Settings: appearance and click behaviour"></td>
</tr>
<tr>
<td align="center">Dark theme, teal accent</td>
<td align="center">Open tabs, tagged by where they live</td>
<td align="center">Settings</td>
</tr>
</table>

<sub>Screenshots use made-up demo data (`dev/demo.js`).</sub>

---

## Why

Most long-lived tabs are not pages you are reading — they are reminders. In Chrome every one of
them is a running page. Saved tab groups help, but they only open all at once. Arc solved this with
pinned folders that show without loading; CairnTab brings that model to Chrome using nothing but
bookmarks.

## What it does

| Section | What you see | Click |
|---|---|---|
| **Pin** | A row of up to ~12 pinned sites | Switches to the tab if it is open, otherwise opens it into a tab group called **Cairn Pin**. **Close** closes that group's tabs; the **×** on a pin moves it to `Archive`. Pins never stay loaded just because they are pinned. |
| **Tasks** | One card per folder under `Groups`, with its pages, how many are open, and when you last touched it | Opens that single page into a native tab group named after the task. **Open all** opens the rest; **Close** closes the task's tabs. The bin icon (on hover) deletes the task after asking: its folder and pages move to `Archive` — nothing is deleted, and dragging the folder from the bookmarks drawer onto **＋ New task** brings it back. |
| **Inbox** | Parked pages, with age and days left before archiving. Sorted closest-to-archiving first by default; settings can switch to newest first or a manual order you drag | Opens the page. **Move to…** (on hover) moves it to Pin or a task without dragging. **Archive** moves it to `Archive`. Click **▸ Archive** under it to see archived pages and **Back to Inbox** (the countdown restarts). |
| **Open tabs** (left drawer) | Every open tab. Unfiled ones first; filed ones dimmed with a tag saying where they live (Pin, a task, Inbox) | On hover (unfiled tabs): **Add to task…** or **Move to Inbox** (bookmark it, close the tab). Tick several (or the header box for all) to act on them at once: Move to Inbox, Pin, Add to task, Close tabs. Or drag onto Pin, a task, or Inbox. |

Rename in place: click a task's title (its open tab group is renamed and recoloured with it), or use
the **✎** that appears at the front of a page row / on a pin. Enter or clicking away saves, Esc
cancels. It renames the bookmark itself. Task cards fold with **▾** (remembered). Drag a page onto another page (or a pin onto another pin)
to put it before/after it — that reorders the bookmarks themselves.

### Appearance

Settings (S) → Appearance and Layout change the look instantly, no reload (every setting, including the folder name
and archive days, saves as soon as you change it): theme (system / light / dark), accent
colour (presets or any colour), background (plain, a tint of the accent, or your own image with
adjustable dim and blur — cards turn frosted over it), content width (slider or typed number, 760–2400px; save up to 5 named widths such as "Laptop"
and "Monitor" and switch with one click), density, corner radius, font size, pin icon
size and labels, number of task columns, and whether to show the greeting and clock. Export / Import copy
the settings as JSON (the image is not included). Pin icons sit on a tile tinted from their own
favicon; task cards carry their tab group's colour.

**Bookmarks** opens a drawer (on the right by default) with every bookmark. Drag a bookmark from it onto Pin, a task, a
task's page (to place it there) or Inbox; drag a whole folder onto **＋ New task** to make it a task. The
drawer's **Manager** button opens Chrome's bookmark manager at the `CairnTab` folder for renaming and deleting.

### When does a bookmark count as "open"?

Only the tab's current URL decides; a tab that browses away simply loses its tag in **Open tabs**.

| Match | Example (bookmark → open tab) |
|---|---|
| Exact (scheme, `www.`, trailing `/`, `#…` ignored) | `shop.example/products/blue-mug` → `https://www.shop.example/products/blue-mug/` |
| Same page, ignoring the language segment and any query the bookmark itself does not have | `shop.example/products/blue-mug` → `shop.example/zh-hant/products/blue-mug?tab=1`; but `google.com/search?q=a` ≠ `?q=b` |
| Inside the bookmarked path | `notion.so/team` → `notion.so/team/page-123` |
| Site front page bookmarked, tab anywhere on the site | `shop.example/` → `shop.example/zh-hant/account` |

The first two also tag the tab in **Open tabs** as filed; the last two only light the "open" dot and
decide where a click goes.

Closing tabs or whole tab groups never changes your bookmarks. Your tasks are the bookmarks; tabs
are just views of them.

## How it is organised

Everything lives in a normal bookmarks folder on the bookmarks bar:

```
Bookmarks bar
└─ CairnTab
   ├─ Pin          pinned sites (icon row)
   ├─ Groups
   │  └─ <task>    one folder per task; subfolders are flattened
   ├─ Inbox        parked pages
   └─ Archive      finished or expired Inbox items
```

- Rearrange, rename, add or delete anything in Chrome's bookmark manager at any time; the page
  updates live.
- Folder names are case-insensitive. A pins folder named `Top` (the name before 0.2) still works;
  new setups get `Pin`. Anything else inside the `CairnTab` folder is left alone.
- Because it is all bookmarks, it syncs across your computers with Chrome Sync, and nothing is lost
  if you uninstall the extension.
- The root folder name (`CairnTab` by default) can be changed in settings.

## Install

Not on the Chrome Web Store yet.

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension/` folder.
4. Open a new tab. When Chrome asks whether to keep the changed new tab page, choose **Keep it**.
5. The first time, a welcome screen explains the folders and offers **Create the “CairnTab” folder**. If you already have a folder with `Pin`/`Groups`/`Inbox`/`Archive` under another name,
   it is listed there with a button to use it instead. If the folder exists but lacks some of them,
   click **Create the missing folders**; existing items are left where they are.

Requires Chrome 116 or later.

## Using it

- **Click** an item: focus it if open, otherwise open it in the current tab. With settings →
  General → When you click a page → **Stay here**, a click instead opens it in the background and CairnTab stays in front,
  so you can open several in a row (a toast confirms each; Open all does the same).
- **⌘/Ctrl-click** does whichever of the two the plain click does not; **middle-click** always opens
  in the background.
- When a click goes to the page, CairnTab normally turns into it (or closes, if the page was already
  open). Turn off **Close CairnTab when switching** to open the page in a new tab and keep CairnTab where it is.
- **Search** (the bar under the header, or press **/**): type part of a title or URL. Spaces split
  the query into pieces that must all appear, in any order — `github cairn` finds a GitHub page with
  "cairn" in its title. Case, full-/half-width, Traditional vs Simplified Chinese and percent-encoded
  URLs don't matter, so Chinese titles and Chinese URL paths match as typed — `台湾` finds 「臺灣」. It covers Pin, task pages, Inbox and open tabs that are
  not filed (Archive is left out); a page that is already open is listed once, marked open. Best
  matches first: title starting with the query, then all of it in the title, then URL-only matches.
  **↑↓** to pick, **Enter** to open (as a click would; something already open is switched to),
  **⌘/Ctrl-Enter** or **⌘-click** opens a second copy in the background (to compare two views of a
  page), **⌘⇧-Enter** a second copy in front, **Esc** clears. While an input method is composing,
  Enter only picks the word.
- **Drag and drop**: drag an open tab onto **Pin** (pin it, tab stays open), a **task** (bookmark it
  there and move the tab into the task's group), **Inbox** (bookmark it and close the tab), or
  **＋ New task** (name a new task and file the tab into it). Bookmarks already on the page can be
  dragged between Pin, tasks and Inbox the same way.
- **Layout**: open tabs drawer on the left, your CairnTab folder in the middle, bookmarks drawer and
  settings on the right (drawers start closed; open them from the header). Settings → General →
  Drawer position puts each of the three on either side. Drawers on the same side open one at a time, and
  settings cover their side until closed. Drawers slide over the page, so the middle column never
  moves; on narrow windows only one side opens at a time. Clicking anywhere outside the drawers (or Esc)
  closes them. Drawers remember whether they were open.
- **Language**: settings → General → Language: Browser (default; Chinese for any Chinese browser
  language, English otherwise), 中文 or English. Switches instantly. Folder names stay `Pin`,
  `Groups`, `Inbox`, `Archive` in both, since they are your bookmarks.
- **Keys**: **/** search, **B** bookmarks, **T** open tabs, **R** refresh, **S** settings, **Esc** close drawers. Plain
  letters, ignored while typing in a field or with ⌘/Ctrl/Alt held. Click the page once first:
  Chrome keeps keyboard focus in the address bar on a new tab.
- **Bookmarks drawer**: open/closed and expanded folders are remembered. Chrome's
  "bookmarks bar only on the new tab page" may not apply to CairnTab; the drawer replaces it.
- **Toolbar icon**: click it to open a new tab (CairnTab). Right-click it for **View CairnTab on GitHub**.
- **↻**: re-read everything (useful after Chrome Sync changes bookmarks on another device).
- **Settings drawer**, in five tabs (the last one used reopens): **General** (language, what a click
  does, drawer positions), **Appearance** (theme, accent, background, export/import), **Layout**
  (content width, density, sizes, task columns, pins and header), **Folders** (the root folder name, after how many
  days Inbox items move to `Archive` — default 30, `0` turns archiving off — and the Inbox order:
  **Expiring** (closest to archiving first), **Newest** or **Manual** (bookmark order; drag
  rows to reorder; the order never changes when an item is archived), and **About** (how it works, a link to
  this repository). "CairnTab · by TuTu" sits at the bottom of every tab.
- Bookmarklets (`javascript:` links) are shown but cannot be opened from an extension.

## Privacy and permissions

CairnTab makes no network requests and has no server, analytics or account. Its only stored data
is a small local record (settings, appearance, last-opened times, which tab group belongs to which
task) in `chrome.storage.local`, plus an optional background image in the page's IndexedDB. None of
it leaves your browser.

| Permission | Used for |
|---|---|
| `bookmarks` | Reading the `CairnTab` folder, parking tabs into Inbox, moving items to Archive |
| `tabs` | Knowing which pins are already open, switching to them, closing parked tabs |
| `tabGroups` | Putting a task's pages into a tab group named after the task |
| `storage` | The small local record above |
| `alarms` | Archiving expired Inbox items even on days you open no new tab |
| `favicon` | Showing site icons from Chrome's own cache |
| `contextMenus` | The "View CairnTab on GitHub" item in the toolbar icon's right-click menu |

## Safety guarantees

- **Never deletes a bookmark.** The Archive button and expiry move items to `Archive`; deleting is up to you.
- **Tabs never write to bookmarks.** Closing tabs or groups cannot lose a task.
- **Safe with live edits.** Every action re-reads the bookmark it is about to touch. If you moved
  or deleted it meanwhile, the page says so and refreshes instead of writing to the wrong place.

## Roadmap

- Per-task "review every N days" reminders
- A Chrome Web Store listing

## Development

No build step and no runtime dependencies: plain ES modules loaded unpacked. Tests need Node ≥ 20.

```
make ci        # syntax, manifest and purity checks, then all tests
make test      # tests only
make preview   # then open http://127.0.0.1:8770/dev/preview.html
make package   # zip extension/ into dist/
make icons     # re-render icons from assets/*.svg (needs rsvg-convert)
make screenshots  # re-render docs/screenshots from the demo data (needs make preview + Chrome)
```

`make preview` renders the real page against an in-memory fake of the Chrome APIs, so the UI can
be checked in any browser without installing the extension. Add `?demo` for the public demo data,
and `&theme=dark`, `&accent=teal`, `&bg=tint` or `&panel=settings|tabs|bookmarks` to preset the look.

```
extension/
  manifest.json, newtab.html/css/js   the page (DOM only)
  background.js                       daily archive sweep
  chrome/                             the only code that calls chrome.*
  lib/                                pure logic, fully unit-tested
test/                                 node:test suites + the Chrome fake
docs/                                 brief, conventions, architecture, decision log
```

Start with [`AGENTS.md`](AGENTS.md) for the rules that must not break, then `docs/`.
Contributions: see [`CONTRIBUTING.md`](CONTRIBUTING.md). Changes: [`CHANGELOG.md`](CHANGELOG.md).

## License

Copyright 2026 [TuTu](https://github.com/tutul). Licensed under the [Apache License 2.0](LICENSE).

You may use, modify and redistribute CairnTab, including commercially. If you ship it or anything
built from it, keep the [`NOTICE`](NOTICE) file with it and show its attribution where your users
can read it (documentation or an about screen), and mark the files you changed — that is what the
license asks in return.

