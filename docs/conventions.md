# Conventions

Rules meant to hold for the life of the project. Current state and todos live in `AGENTS.md`.

## Data ownership

- **Bookmarks are the source of truth.** Anything the user would be upset to lose lives in a
  bookmark or folder. Losing `chrome.storage.local` must only cost conveniences (last-opened times,
  group reuse, settings back to default).
- **Tabs are disposable views.** Data flows bookmarks → tabs only. No tab or group event may create,
  edit, move or delete a bookmark. Without this, closing a group would silently eat a task.
- **The extension never deletes a bookmark.** "Done" and "archive" move into `CairnTab/Archive`. The
  user deletes by hand. A wrong archive is one drag to undo; a wrong delete is not.

## Robustness against live edits

- **Re-read before every write.** Ids held by the UI are hints. Each action fetches the node it is
  about to change and verifies parent/url first; a missing node is a normal outcome ("it was
  removed meanwhile"), reported as a quiet toast and a re-render, never an exception in the console.
- **Identify folders by role, not by id or position.** `Top`/`Groups`/`Inbox`/`Archive` are found
  by case-insensitive title under the root folder each time the tree is read. Ids change when a
  folder is deleted and recreated, and positions change whenever the user drags.
- **Unknown structure is tolerated, not repaired.** Extra folders, nested folders, loose URLs,
  `javascript:` bookmarks: shown or ignored, never moved. The only structural writes are creating a
  missing role folder when an action needs it, and moving Inbox items to Archive.
- **Metadata keyed by bookmark id is garbage-collected** against the current tree, and only after
  a successful full read — a partial read during sync must not wipe it.

## Data in the repository

- Test fixtures, preview data and screenshots use public sites and invented titles only. Nothing
  copied from a real browser profile, workspace URL or account goes into the repository.

## Code layout

- `extension/lib/` — pure functions over plain data (tree → model, URL matching, archive due
  dates, group placement plans). No `chrome.*`, no DOM. Everything here is unit-tested.
- `extension/chrome/` — the only code that calls `chrome.*`. Thin: read, call lib, write.
- `extension/newtab.js` — DOM only. Calls actions, renders the model.
- Tests run the real `lib/` and `chrome/` code against `test/fake-chrome.js`, an in-memory fake of
  the subset of the bookmarks/tabs/tabGroups/windows/storage APIs we use. The fake throws the same
  "Can't find bookmark" style errors Chrome does, so the missing-node paths are exercised.

## UI

- Mouse-first. Chrome keeps focus in the address bar on a new tab page; keyboard shortcuts on the
  page only work after a click, so nothing may depend on them.
- Every destructive-looking action (close task tabs, archive) is reversible from the page or the
  bookmark manager, so no confirm dialogs.
- Light and dark from `prefers-color-scheme`.

## Docs and commits

- Decisions go in `docs/decisions.md`; overturned ones stay, marked overturned, with the reason.
- Conventional commit prefixes; body says why.
- `make ci` passes on every commit.
