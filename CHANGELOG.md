# Changelog

## Unreleased

- The default root folder is now called `CairnTab` (was `Pin`). Existing setups that saved a folder
  name keep it; otherwise the new welcome screen finds the old folder and offers to keep using it.
- Welcome screen when the root folder is missing: what will be created, a create button, and any
  existing folder that already looks like one.
- Clicking the toolbar icon opens a new tab (CairnTab); its right-click menu has a link to the
  project on GitHub. Adds the `contextMenus` permission.
- Search bar: matches titles and URLs of Top, task pages, Inbox and unfiled open tabs as you type;
  space-separated pieces match in any order; works with Chinese text, Chinese URL paths and input
  methods; Traditional and Simplified Chinese match each other. Enter opens, ⌘-Enter opens a second copy, **/** focuses it.
- English UI. Settings → General → Language: follow the browser (default), 中文 or English; switches
  without a reload. Manifest name, description, toolbar tooltip and menu are localised too.
- The pinned row is **Pin** (釘選), and so is its bookmarks folder: new setups create `Pin`, an
  existing `Top` folder keeps working. Its tab group is now **Cairn Pin**; an open "Top Pin" group is
  found and renamed.
- Drawer position setting: open tabs, bookmarks and settings can each slide in from the left or the
  right. New default: open tabs left, bookmarks and settings right.
- Clicking outside an open drawer closes it.
- Header: open tabs before bookmarks; the settings button is a gear.
- Delete a task (bin icon on the card, with a confirmation): the task folder and its pages move to
  Archive; nothing is deleted.
- Inbox rows have a **Move to…** menu (Top or any task), so filing from a long Inbox needs no drag.
- Inbox order setting: closest to archiving first (default), newest first, or manual with
  drag-to-reorder.

## 0.1.0 — 2026-11-04

First public release.

- New tab page built from one bookmarks folder (`Pin`): **Top** pins, **tasks** (one folder each,
  opening into a native tab group named after the task), **Inbox** with automatic archiving after a
  configurable number of days, and **Archive** (nothing is ever deleted).
- Open-tabs drawer listing every tab, with where it is already filed; multi-select to move tabs to
  Inbox, Top or a task, or close them.
- Bookmark drawer with drag and drop into Top, tasks and Inbox; folders dragged to ＋ 新任務 become
  tasks.
- Inline rename for pages, pins and tasks (tab group renamed with it); reorder by drag.
- Click behaviour: switch to the page or stay on CairnTab, optionally keeping the CairnTab tab.
- Appearance: theme, accent colour, background (plain, tint or your own image), density, radius,
  font size, pin size and labels, task columns, greeting and clock; export/import.
- Keyboard: B / T / R / S toggle bookmarks, open tabs, refresh, settings; Esc closes drawers.
- Local only: `chrome.storage.local` and IndexedDB; no network requests, no account.
- Licensed under Apache-2.0; see NOTICE for attribution.
