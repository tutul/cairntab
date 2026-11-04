# CairnTab — brief

Originally built under the working name `pin-newtab` (see `decisions.md` D-008, D-009).

**Goal** A Chrome new-tab page that turns a bookmarks folder into a task board: pins you reach in
one click, tasks whose pages open one at a time into their own tab group, and an inbox that holds
"come back to this" pages as bookmarks instead of live tabs.

**Why** Moving from Arc to Chrome showed two gaps: a pinned page costs memory the moment it sits in
the tab strip, and a saved tab group can only be opened all at once. Most long-lived tabs are
reminders, not pages being read.

**Scope (v1)**
- New tab override reading `Pin/` on the bookmarks bar: `Top`, `Groups/<task>`, `Inbox`, `Archive`.
- Top: icon row; click focuses the tab if open, opens it otherwise.
- Groups: each subfolder is a task. Open one page or all; pages land in a native tab group named
  after the task. Closing tabs or the group never touches bookmarks.
- Inbox: park an open tab (bookmark it, close it). Items older than N days (user setting, 0 = never)
  move to `Archive` automatically.
- Open tabs that are not in `Pin/` are listed so they can be parked or filed into a task.
- Metadata (settings, last opened, folder → tab group map) in `chrome.storage.local`. No sync.

**Non-goals**
- Replacing the native tab strip or side panel — extensions cannot, and the new tab is the
  deliberate entry point.
- Syncing metadata across machines — the bookmarks already sync; that is enough.
- Two-way sync between tab groups and bookmarks — tabs are disposable views of the bookmarks.
- Chrome Web Store listing — later, once the name and v1 have settled.

**Constraints**
- Bookmarks are edited by hand at any time, including while the page is open, and by Chrome Sync.
  Nothing may assume an id, folder, or child still exists between two calls.
- No build step, no runtime dependencies: plain ES modules loaded unpacked.
- Maintenance budget: one author, in spare time — favour small, dependency-free code.

**Stack** Manifest V3, vanilla JS modules, `node:test` with an in-memory fake of the Chrome APIs.

**Risks**
- Chrome changes tab-group or bookmark API behaviour → all Chrome calls sit in one adapter layer.
- Redirects and locale segments make an open tab's URL differ from its bookmark → tiered,
  normalised URL matching (D-012, D-014).
- A new tab page cannot take keyboard focus from the address bar (Chrome rule) → design for mouse.
