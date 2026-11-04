# Changelog

## Unreleased

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
