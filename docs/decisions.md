# Decision log

Why CairnTab works the way it does. Each entry records a design decision by
[TuTu](https://github.com/tutul), the author, with the problem behind it and the alternatives
that were rejected. Newest last. Decisions that were later reversed stay in place, marked
**Overturned** or **Superseded**, next to the entry that replaced them.

**D-001 Build a dedicated extension instead of adopting an existing tab manager.** 2026-11-04.
The model — pins, tasks as folders, and an inbox of reminders, all living in bookmarks — is
specific, and owning it keeps the data in plain bookmarks rather than a vendor's store.

**D-002 New tab page, not side panel.** 2026-11-04.
A side panel was the first idea. Rejected: it is opened per window and cannot be guaranteed in a
new window, while ⌘T works everywhere and is already how most people start something new.

**D-003 Bookmarks are the source of truth.** 2026-11-04.
They sync through Chrome, are editable in the bookmark manager, and survive uninstalling the
extension. Alternative considered: an extension-owned database; rejected because losing it would
lose the user's work.

**D-004 Metadata in `chrome.storage.local`, no sync.** 2026-11-04.
Bookmark ids differ per machine, so id-keyed metadata could not be synced meaningfully anyway, and
the bookmarks themselves already sync. Rejected alternative: encoding settings into folder titles
(e.g. `Task ·7d`) — readable but clutters names and breaks on rename.

**D-005 Archive period is a user setting, default 30 days, 0 disables.** 2026-11-04.
How long a reminder stays relevant differs per person; 30 days is about the lifetime of a typical
"come back to this" tab.

**D-006 One-way flow bookmarks → tabs.** 2026-11-04.
Closing tabs or a tab group in the tab strip must never change what the extension manages.
Otherwise closing a group would silently delete a task.

**D-007 Never delete bookmarks; archive instead.** 2026-11-04.
Bookmarks are edited by hand at any time; a mistaken delete by the extension is unrecoverable from
its UI, a mistaken move is not.

**D-008 Public name undecided; working name `pin-newtab`.** 2026-11-04. **Superseded by D-009.**
Candidates: Moor, Berth, Tabstead, Waypoint, Perch, plus a second round focused on "tasks that
persist vs tabs that come and go". The display name lives only in `manifest.json` and
`newtab.html`, so renaming is a two-line change.

**D-009 Name: CairnTab.** 2026-11-04. Settles D-008.
A cairn is a stack of stones marking a trail: a place you mean to come back to. That matches the
product's core — tasks and reminders persist while tabs come and go — better than "Moor" (parking),
which leans on the memory-saving side effect. Final round was CairnTab vs MoorTab.
Name check (web search, 2026-11-04, not a trademark search):
- MoorTab rejected: one letter from "Moontab Extreme", an existing Chrome new-tab organiser with
  columns and groups; "Mooru" also saves tabs. Too easy to confuse in store search.
- CairnTab: no exact match. "Cairn" alone is taken nearby — a Firefox bookmark-library add-on
  (Unifybrowse) and a Chrome extension developer brand (cairn.it.com) — so always write the one-word
  "CairnTab", never "Cairn".
Re-check the Chrome Web Store and GitHub before a store listing.
The bookmark root folder keeps the default title "Pin": it describes the folder, not the product,
and it is a name people already use for such a folder.

**D-010 Top pins open into a "Top Pin" tab group.** 2026-11-04.
Pins opened from the page should collect in one group, like task pages do. Implemented as a task
whose `groupMap` key is the Top folder's bookmark id (so GC and restart recovery work the same way)
and whose group title is the fixed "Top Pin". An already-open pin is only focused, never pulled out
of whatever group it is in — moving tabs the user arranged would be surprising.

**D-011 Render only when visible and when something relevant changed.** 2026-11-04.
Question raised: does constant re-rendering waste work? Measured: ~1 ms logic per render, but every
render also wrote storage (unconditional GC write) and a hidden new tab page re-rendered on every tab
event; ticker tabs (prices) retitle every second. Now: no title-driven renders, no renders while
hidden (re-read once on becoming visible), GC writes only on change. Rejected: diffing the DOM
instead of rebuilding — not worth the code at this size.

**D-012 Tab matching in tiers instead of exact URL only.** 2026-11-04. Partly overturned by D-014.
Problem: an open shop page was not recognised (different URL — locale segment, query), yet a pin
opened from CairnTab stayed "open" even after navigating elsewhere. Now: exact > remembered tab while
still on the same site > same page ignoring query/locale > inside the bookmarked path > same site
for front-page bookmarks. Locale segments come from a fixed language list, because "any two letters"
would also eat real paths like /go/ or /ai/. Loose tiers only drive the open dot and click target;
the "other tabs" list uses PAGE and above, so a github.com pin cannot hide every GitHub tab from
parking.

**D-013 Inbox ages from when an item entered Inbox.** 2026-11-04.
Found while adding "restore from Archive": Chrome's dateAdded cannot be changed, so a restored item
(or a task page dragged into Inbox) would be re-archived by the next sweep. CairnTab records
`inboxSince` on such moves and ages from max(dateAdded, inboxSince). Rejected: re-creating the
bookmark to get a fresh dateAdded — it would mean deleting the original (D-007).

**D-014 Match by current URL only; drop the remembered-tab tier.** 2026-11-04. Partly overturns D-012.
D-012 kept a tab CairnTab opened as "the item's tab" while it stayed on the same site. In use that
felt wrong: once you click away it is simply another tab ("點出去就點出去") and should show under open
tabs, where it can be filed again. `pinTabs` storage was removed with it.

**D-015 Bookmark drawer inside the page instead of relying on the bookmarks bar.** 2026-11-04.
Many people keep the bookmarks bar hidden, and Chrome's "only on the new tab page" mode does not
reliably cover an extension new tab. The drawer shows the full tree and doubles as a drag source
into Top, tasks and Inbox; folders dragged to ＋ 新任務 become tasks. Renaming/deleting stays in
Chrome's bookmark manager (one click away) to keep D-007.

**D-016 List every open tab; tag filed ones instead of hiding them.** 2026-11-04.
Problem: Google search tabs were missing from "other open tabs"; the list should equal the browser's
tabs, with filed ones marked. Cause: PAGE matching ignored the query, so one bookmarked Google search
matched every search. Now a bookmark's own query parameters must be present in the tab (extra tab
parameters are still ignored), and the section lists all tabs: unfiled first with the filing
actions, filed ones dimmed with a tag naming their place. "完成" became "Archive" to say what it does.

**D-017 Icons only from Chrome's local cache, keyed by the URL a tab really loaded.** 2026-11-04.
Problem: an open page showed Chrome's default globe. Chrome's `_favicon` answers for URLs it has
loaded; a bookmark URL that redirects or was imported from another browser has no entry and gets
the globe (not an error, so the letter fallback never triggers). Items now use their open tab's URL
and remember it (`iconPage`) for when the tab is closed. The open-tabs list stopped using
`tab.favIconUrl`, which is usually the site's remote URL — loading it made the page contact every
open site, contradicting the README's "no network requests".

**D-018 Open tabs live in the right panel; settings swap into it.** 2026-11-04. Amended by D-019, D-020.
The open-tabs list at the bottom of the page was far from the folders tabs get filed into. It is now
a right panel, so tabs can be dragged straight into the middle column, mirroring the bookmark drawer
on the left. Settings are used rarely, so they borrow the same slot while open and give it back on
close, rather than adding a third column. On narrow windows the panels overlay the page and only one
is open at a time.

**D-019 Side panels overlay as sliding drawers instead of pushing the page.** 2026-11-04. Overturns the
"push" layout used for the bookmark drawer (D-015) and the right panel (D-018).
Opening either side shifted the middle column sideways, which looked jumpy. The middle column is
centred at max 1080px, so on a wide screen both drawers (320 + 360px) fit in the empty margins
without covering it; narrower windows get overlap, which is the normal drawer trade-off. Drawers stay
in the DOM and slide with a transform; closed ones are `inert` and `visibility: hidden` after the
slide so they cannot be tabbed into or clicked.

**D-020 Open-tabs drawer closed by default; Esc closes drawers.** 2026-11-04. Amends D-018.
D-018 showed the open-tabs panel by default on wide windows. With drawers now overlaying (D-019), an
open-by-default drawer covers part of the page on most window sizes, so it starts closed and only
remembers being opened. Esc closes every open drawer; a rename field consumes its own Esc first.

**D-021 Header shortcuts are plain single letters on the page.** 2026-11-04.
B / T / R / S toggle bookmarks, open tabs, refresh, settings; tooltips show the key. Plain letters
cannot clash with Chrome, whose shortcuts all carry ⌘/Ctrl/Alt, and they are ignored while typing or
with a modifier held. Rejected: `chrome.commands` global shortcuts — they would work without first
clicking the page, but need a background→page message, are limited to four suggested keys, and
modifier combos are exactly where clashes with Chrome and other extensions happen.

**D-022 Appearance: polish by default, plus a user-tunable look stored locally.** 2026-11-04.
The layout worked, but the details looked rough, and a page you see dozens of times a day should be
customisable. Two parts:
- *Polish, no setting:* one SVG icon set instead of text glyphs (× ✎ ▾ ▸ ＋), soft two-layer
  shadows instead of border-only cards, Top pins as tinted tiles (tint sampled from the favicon
  Chrome already has locally — no network), task cards carry their tab-group colour, greeting and
  clock in the header, short transitions on state changes only (re-renders replace the DOM, so
  enter animations would replay on every bookmark event), and everything still honours
  `prefers-reduced-motion`.
- *Appearance settings:* theme (system/light/dark), accent (presets or any colour), background
  (plain / accent tint / own image with dim and blur), density, corner radius, font size, pin size and
  labels, task columns, greeting and clock toggles, export/import as JSON.
How: `lib/theme.js` turns the stored object into CSS custom properties (pure, tested); the page only
sets them on `:root`. Stored in `chrome.storage.local` key `appearance` (no sync, like everything
else). The background image is a Blob in the page's IndexedDB, because storage.local caps at 10 MB
without `unlimitedStorage` and a photo would eat most of it. A copy of the computed variables is
mirrored to localStorage and applied by a tiny synchronous `boot.js` before first paint, so a new tab
does not flash the default theme; chrome.storage stays the source of truth.
Rejected: a theme marketplace / remote wallpapers (network requests, contradicts the privacy promise);
per-section colours (more knobs than value); CSS-only presets without tokens (cannot mix with a
custom accent).

**D-023 Settings panel: grouped rows with one type scale; folder settings save on change.** 2026-11-04.
After D-022 the settings panel was the one place left with no consistent hierarchy — headings,
labels and hints in mixed sizes, fields stacked loosely. It now follows the system-settings pattern:
titled groups (外觀 / 版面 / Top 與頁首 / 點擊網頁時 / 資料夾與 Inbox / 使用方式), each a card of rows
split by hairlines; a row is label (13/500) plus optional hint (12, muted) on the left and its control
on the right, every control in the same 176px column (segmented, slider) or a switch. Wide controls
(accent swatches, the folder name field) stack under their label. The 儲存 button is gone: the folder
name and archive days save on change, like every appearance control, and renders no longer overwrite
a field that has focus. Group titles are not uppercased — with mixed Chinese/English it only shouted
"INBOX".

**D-024 A plain click can keep CairnTab in front ("留在這頁").** 2026-11-04.
Opening several pages in a row should not make the new tab page disappear after each click.
⌘/Ctrl-click already did that, but it is easy to forget and awkward for a run of clicks. New setting
`settings.openMode`: `"switch"` (default: the CairnTab tab becomes the page, or focuses it if open) or
`"stay"` (open as an inactive tab, focus nothing). ⌘/Ctrl-click always does the opposite of the plain
click; middle-click is always background; 全開 follows the same rule. Because nothing visibly changes
on the page in stay mode, each background open shows a toast ("已在背景開啟…" or "…已經開著了") and the
item's open dot appears on the next render. It lives in `settings` (behaviour), not `appearance`.
Rejected: a per-section mode (more to remember for no clear gain).

**D-025 Switching can keep the CairnTab tab; the tab is titled "CairnTab".** 2026-11-04.
Besides "switch" and "stay" (D-024), switching should optionally leave CairnTab open.
`settings.closeOnSwitch` (default true): the CairnTab tab becomes the page, or closes when the page
was already open. Off: the page opens in a new active tab (or the open one is focused) and the
CairnTab tab stays. Implemented in the page only: actions already treat `selfTabId: null` as "no tab
to give up", so `newtab.js` passes `leaving()` (null when kept) for every switching click — items,
全開, the open-tabs panel and the bookmark manager button. Also, the page `<title>` is now "CairnTab"
instead of "新分頁", so tab strips and vertical-tab sidebars show the product name.

**D-026 Apache-2.0 with a NOTICE, and a visible credit.** 2026-11-04.
Licence chosen so that redistributions and derivative works keep crediting the original author.
Apache-2.0 is as permissive as MIT for users, but requires copies and derivatives to carry the
`NOTICE` file in readable form and to mark changed files; MIT only asks to keep a copyright line in
the source. Rejected: MIT (credit easily lost), GPL (it governs keeping derivatives open, not credit).
A licence covers code, not ideas, so the credit is also made visible: "Created by TuTu" at the top
of the README, `homepage_url` in the manifest (shown on chrome://extensions and store pages), and a
"CairnTab · by TuTu" line linking to github.com/tutul at the end of the settings panel.

**D-027 Inbox order is a setting: expiring, newest, or manual.** 2026-11-04.
Inbox was always shown oldest-first (closest to archiving on top), and neither dragging nor the
bookmark manager's order could change it. `settings.inboxSort`: `"expiring"` (default, unchanged),
`"newest"` (latest first, for reading Inbox as a read-later list), or `"manual"` (the Inbox folder's
own bookmark order, with the same drag-to-reorder as task pages, so the bookmark manager and the page
agree). Ordering is display only: the archive countdown still uses when each item entered Inbox, and
reordering within Inbox does not reset it (`placeItem` only records `inboxSince` when an item comes
from another folder). The sort itself is `lib/archive.sortInbox` (pure, tested).

**D-028 Toolbar icon opens a new tab; the GitHub link lives in its menu.** 2026-11-04.
With no `action` defined, clicking CairnTab's toolbar icon did nothing except show Chrome's menu,
whose top entry went to the author's profile. Expected behaviour is that clicking the icon opens
CairnTab, and since CairnTab is the new tab page that is simply `tabs.create({})` next to the current
tab. The project link moved to an explicit right-click item, "在 GitHub 查看 CairnTab", which opens
the repository. Costs the `contextMenus` permission (no install warning). Rejected: a popup — it
would be a second, smaller UI to maintain for something the new tab page already is.

**D-029 Default root folder "CairnTab"; welcome screen when it is missing.** 2026-11-04. Amends D-009
(which kept "Pin" as the folder name).
Now that CairnTab is public, a folder named after the product is easier to recognise in the bookmarks
bar and in support questions than the generic "Pin". The default `rootTitle` becomes "CairnTab"
(the "Top Pin" tab group keeps its name: it is about pins, not the folder). A saved setting is never
changed, so setups that stored "Pin" keep working. For setups that never saved one — and for every
first run — the old notice was replaced by a welcome screen: what the four folders are for, a primary
button that creates the root and role folders, "用其他名稱…" which opens settings at the folder name,
and any folder that already looks like a root under another name (`findCandidateRoots`: at least two
role-named children) with a one-click "改用" that only sets `rootTitle`. Rejected: silently falling
back to "Pin" when "CairnTab" is missing — invisible magic, and it would pick up an unrelated folder
that happens to be called Pin.

**D-030 Search bar over CairnTab and open tabs.** 2026-11-05.
The address bar already searches all bookmarks and history; what it cannot do is search only what
CairnTab holds plus the tabs open right now. A search bar under the header does that, with results in
a dropdown (not by filtering the board, which would move everything around while typing).
- Scope: Top, every task's pages, Inbox, and open tabs not filed anywhere. Archive is left out — it is
  the place for things you are done with. A bookmark that is open is one result marked open; its tab
  is not listed again.
- Query: whitespace (and `*`) split it into tokens; each token must be a substring of the title or of
  the URL, in any order. An ordered glob (`a*b`) was the first idea; rejected because it fails when the
  pieces are typed in the other order or one is in the title and the other in the URL.
- Chinese: comparison is on NFKC + lower-case text per code point (full-width letters and the
  ideographic space fold to ASCII), and URLs are percent-decoded first, so Chinese titles and Chinese
  URL paths match as typed. No word segmentation is needed for substring matching. Highlight ranges
  are mapped back to the original string, since folding can change lengths. Traditional/Simplified:
  see D-031.
- Input methods: nothing filters while `isComposing`; the list updates on `compositionend`. Enter with
  `isComposing` or keyCode 229 (the Enter that confirms a word) is ignored.
- Ranking: title starts with the first token > every token in the title > some token only in the URL;
  ties go to open things, then most recently opened.
- Opening: Enter follows the click settings (D-024/D-025), except that something already open is
  switched to. ⌘/Ctrl opens a second copy in the background — the "already open, switch to it" rule
  would otherwise make comparing two states of a page impossible — ⌘⇧ a second copy in front, and
  middle-click a second copy in the background. This is deliberately not the board's ⌘ meaning
  ("the other click mode"): in a search list the useful alternative is a fresh copy.
- Focus: Chrome keeps keyboard focus in the address bar on a new tab page and the page cannot take it,
  so the field is not auto-focused; **/** focuses it once the page has been clicked.

**D-031 Search folds Traditional and Simplified Chinese together.** 2026-11-05. Amends D-030.
Bookmarks and tabs mix both scripts (a Simplified page title in a Traditional setup, or the other way
round), and the query should find either. Each code point is mapped Traditional → Simplified with
OpenCC's character table (TSCharacters, default form only; 3,221 pairs, ~20 KB, generated into
`lib/hanzi-data.js` by `scripts/gen-hanzi.mjs`), on both the query and the text. The folded form is
only compared, never shown; highlights still mark the original characters.
Why fold to Simplified, although the UI and most users here are Traditional: the mapping is
many-to-one in that direction (發／髮 → 发, 臺／台 → 台), so it is a plain lookup. Folding to Traditional
is one-to-many (发 → 發 or 髮) and would need phrase context to pick, which is what OpenCC's phrase
dictionaries are for and is out of scope. The cost is a few extra matches where two Traditional
characters share a Simplified one (searching 「髮」 also finds 「發」); for search that is acceptable.
Character level only: regional vocabulary (软件／軟體) is not converted. OpenCC is Apache-2.0, so its
attribution is in NOTICE.

**D-032 "移到…" on Inbox rows.** 2026-11-05.
Filing an Inbox item into a task meant dragging it up past a long Inbox, which scrolls while dragging
and is unreliable. Inbox rows get a hover menu next to Archive: Top or any task, using the existing
`moveItem`. Task rows do not get it: task cards are narrow and the hidden menu still takes the width
the titles need; between tasks, cards sit side by side and dragging is short.

**D-033 English UI; all UI text in dictionaries.** 2026-11-05.
The UI mixed Chinese labels with English ones (Move to Inbox, Archive). Every fixed string is now a
key in `extension/locales/zh-Hant.js` and `en.js` (plain strings with `{param}`, or functions for
plurals and word order), read through `lib/i18n.createT`. Setting `language`: "auto" (default — any
Chinese browser language gets Chinese, everything else English), "zh-Hant" or "en"; switching
re-renders in place, and the resolved language is cached in localStorage for the next first paint.
- Own dictionaries, not `chrome.i18n`: Chrome's API only follows the browser language and cannot be
  switched from the page. `_locales/` is still used for what only Chrome shows (extension name and
  description, toolbar tooltip, toolbar menu).
- Code outside the page never builds UI text: actions and lib throw `UserError(key, params)` (its
  message is the key, which tests match), `Gone(what)` carries a `what.*` key, `relativeDay` and
  `greetingFor` return keys, model warnings are `{key, params}`, and the model's own labels come in
  through `createActions({ labels })`.
- Guards: a test keeps both dictionaries' keys identical and every entry non-empty; `make check`
  fails on CJK text in `extension/**/*.{js,html}` outside comments, `locales/`, `_locales/` and the
  generated hanzi table. (Written in Node: macOS grep has no `-P`, and a grep version passed
  silently.)
- Folder names are data, never translated: `Top`, `Groups`, `Inbox`, `Archive` and the root keep their
  names in both languages, so a bookmarks folder made in one language works in the other.
- Wording: Chinese mode uses Chinese for actions (移到 Inbox, 封存) and keeps folder names for the
  Inbox/Archive sections; README screenshots exist in both languages (`*-zh.png`).

**D-034 The pinned row is "Pin" / 「釘選」; its tab group is "Cairn Pin".** 2026-11-05.
"Top" said where the row sits, not what it is, and does not translate well. The UI calls it Pin /
釘選. The bookmarks folder keeps the name `Top` (D-033: folder names are data; renaming would need a
second accepted name, and "Pin" was also the old root folder's name — D-029 — so `Pin/Pin` folders
would follow). Rejected: naming the row "Cairn" — it collided with the product name and with
existing roots called "Cairn", and says nothing about what the row does. The tab group the pins open
into becomes "Cairn Pin": it shows only in the tab strip, where the product name helps. A group still
titled "Top Pin" is found by title on load and renamed; the remembered group id keeps working as
before.

**D-035 The pins folder is "Pin"; "Top" still works.** 2026-11-05. Amends D-034.
D-034 renamed the row in the UI only and kept the folder `Top`, to avoid a second accepted name and
`Pin/Pin` for roots still named "Pin". In use, a UI called Pin over a folder called Top was the
confusing part, so the folder follows: `ROLE_NAMES.top = ["Pin", "Top"]` — CairnTab creates "Pin",
and both names are read (case-insensitive, first one wins with the usual duplicate warning). Existing
`Top` folders keep working and can be renamed whenever the user likes. The role key stays "top" in
code and storage (`groupMap`, drop targets), so nothing stored has to migrate. A root that is itself
named "Pin" (setups from before D-029 that saved that name) with a "Pin" folder inside is fine:
the root is searched from the bookmarks bar down, the role folder only among its children.

**D-036 Drawer sides are a setting; open tabs left, bookmarks and settings right.** 2026-11-05.
Amends D-018/D-019 (bookmarks fixed left, open tabs and settings sharing the right).
The drawers' sides followed the original layout, not how they are used: the open-tabs list is where
filing starts, and it reads better next to the page's left edge. `settings.drawers` =
`{ tabs, bookmarks, settings }`, each "left" | "right"; default tabs left, bookmarks and settings
right. The page has two slots and moves the three views into them, so any combination works: views on
the same side open one at a time (opening one closes the other), settings cover their side while
open and give it back when closed (as before on the right), and below 900px only one side opens. It
is a synced setting, not a per-browser preference, because it is about the user's habits rather than
the window. The header lists open tabs before bookmarks to match, and the settings button became a
gear (the sliders icon read as "filters").

**D-037 Deleting a task archives its folder.** 2026-11-05.
Finished tasks had to be removed in the bookmark manager. Task cards get a bin button (visible on
hover or keyboard focus); after a confirm dialog that says how many pages are affected, the whole
task folder moves into `Archive` (`archiveTask`). Its pages then show in the Archive list like any
archived page. Moving the folder, rather than moving the pages out and removing the empty folder,
keeps invariant 1 (never delete a bookmark), keeps the pages together under the task's name in the
bookmark manager, and makes undo free: dragging the folder from the bookmarks drawer onto ＋ 新任務
(`adoptFolder`) restores the task. Open tabs are not touched — closing them is what 收起 is for, and
a delete should not also throw away pages the user has open. The loose "未分組" card has no bin.

**D-038 A click outside the drawers closes them.** 2026-11-05.
Drawers only closed with their × button, their header button or Esc. Now a primary-button
pointerdown anywhere outside both drawer slots closes every open drawer (and forgets that they were
open, like Esc). The click itself still goes through: clicking a task page opens it and closes the
drawer in one go. Exempt: the drawers themselves and the header buttons (which toggle their own
drawer). Dragging is unaffected — drags start inside a drawer, and a drop is not a pointerdown — so
filing a tab from the open-tabs drawer onto a task still works with the drawer open.

**D-039 Settings in tabs.** 2026-11-05.
The settings drawer had grown to eight groups in one long scroll. It now has a tab strip under the
title — 一般 General (language, click behaviour, drawer positions), 外觀 Appearance (theme, accent,
background, export/import), 版面 Layout (density and sizes, pins and header), 資料夾 Folders (root
folder, structure, Inbox archiving and order), 說明 About (how it works, a link to the GitHub
repository). The "CairnTab · by TuTu" credit and the version sit at the bottom of every tab, not only
About: the attribution should be visible wherever the panel is opened (NOTICE, D-026). Grouped by
what people come to change, and balanced so no tab needs much scrolling. The strip sits outside the
scrolling body, so it stays visible; the last tab is remembered per browser (localStorage), arrow
keys move between tabs, and the welcome screen's "use another name" opens Folders directly. The
selected tab uses the accent colour: a panel-coloured pill was nearly invisible in dark mode.

**D-040 Content width is a slider.** 2026-11-05.
The middle column was capped at 1100px (1320px with four task columns), which leaves wide margins on
large screens and was not adjustable. `appearance.pageWidth` (760–2400px, step 20, default 1100)
sets `--page-w`, the max width of the header and the page; on a window narrower than the setting the
column simply fills it. It lives in Settings → 版面 next to density and task columns, previews live
while dragging and saves on release like the other sliders. An unset width with four columns
normalises to the old 1320px, so nobody's layout changes until they move the slider. The search bar
keeps its own 620px cap: a search field as wide as a 2000px page is harder to read, not easier.

**D-041 Typed width and named width presets.** 2026-11-05. Extends D-040.
A slider is quick but imprecise, and people who move between a laptop and a monitor want to switch
widths, not re-drag. The width row now has a number box next to the slider (kept in step; typed
values are clamped to 760–2400 and rounded to the 20px step) and up to five named presets,
`appearance.widthPresets = [{ name, width }]`. "儲存目前寬度" asks for a name (`prompt`, like new
task names); the same name, ignoring case, overwrites that preset; a sixth is refused with the save
button disabled. A chip applies its width, × removes it, and the chip matching the current width is
highlighted. Presets are part of the appearance object, so they are exported and imported with it.
The presets hold width only, not whole appearance profiles: the request was about fitting screens,
and a full profile system would duplicate export/import.

**D-042 Reorder tasks by dragging cards.** 2026-11-07.
Task cards follow the order of the folders under `Groups`, which could only be changed in the
bookmark manager. A card's header is now a drag handle; dropping it on another card's left or right
half moves the task folder before or after that one (`placeTask`). The bookmark order stays the one
source of truth (invariant: bookmarks are the data), so the bookmark manager and every synced
device show the same order, and nothing new is stored. Task drags are kept apart from filing: a card
accepts a task only to reorder, and the Pin row, Inbox and ＋ 新任務 refuse it.

**D-043 Pickable task colours, limited to tab-group colours.** 2026-11-07.
A task's colour came from a hash of its title (`colorFor`, D-022), so it could not be chosen and changed on
rename. The dot before the title opens a palette of Chrome's nine tab-group colours plus 自動
(back to the title colour). Only those nine, not any colour, because the card and the task's tab
group are meant to look the same and tab groups cannot take other colours. The pick is stored in
`chrome.storage.local.taskColors` keyed by the task folder id (garbage-collected like the other
metadata); losing it only brings back the title colours (invariant 4). The open tab group is
recoloured at once, new groups and renames use the picked colour, and the open-tabs tags and search
results use it too.
