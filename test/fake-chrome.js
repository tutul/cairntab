// In-memory fake of the chrome.* subset this extension uses. Shared by node tests and the browser
// preview (dev/preview.html). Errors use Chrome's wording so isGone() is exercised for real.
//
// Behaviours copied from Chrome on purpose:
// - every getter returns copies (mutating a result never changes state)
// - removing the last tab of a group removes the group
// - bookmarks.get on a missing id rejects with "Can't find bookmark for id."

function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    fire: (...args) => listeners.forEach((fn) => fn(...args)),
  };
}

const clone = (x) => structuredClone(x);

/**
 * @param {object} opts
 * @param {object} opts.tree   nested bookmark tree: {title, url?, children?, dateAdded?, folderType?}
 * @param {Array}  opts.tabs   [{id?, windowId?, url, title?, groupId?, active?}]
 * @param {Array}  opts.groups [{id, windowId, title, color?}]
 */
export function createFakeChrome({ tree, tabs = [], groups = [], currentWindowId = 1, selfTabId = null, now = Date.now() } = {}) {
  // ---------- bookmarks ----------
  const nodes = new Map(); // id -> {id,parentId,title,url,dateAdded,folderType,childIds}
  let nextBookmarkId = 0;

  function insert(spec, parentId) {
    const id = spec.id ?? String(nextBookmarkId++);
    nextBookmarkId = Math.max(nextBookmarkId, Number(id) + 1 || nextBookmarkId);
    const node = {
      id,
      parentId,
      title: spec.title ?? "",
      url: spec.url,
      dateAdded: spec.dateAdded ?? now,
      folderType: spec.folderType,
      childIds: spec.url ? undefined : [],
    };
    nodes.set(id, node);
    if (parentId != null) nodes.get(parentId).childIds.push(id);
    for (const c of spec.children ?? []) insert(c, id);
    return node;
  }
  insert(tree ?? { title: "", children: [
    { title: "Bookmarks bar", folderType: "bookmarks-bar" },
    { title: "Other bookmarks", folderType: "other" },
  ] }, undefined);

  function view(node, deep) {
    const out = { id: node.id, title: node.title, dateAdded: node.dateAdded };
    if (node.parentId != null) {
      out.parentId = node.parentId;
      out.index = nodes.get(node.parentId).childIds.indexOf(node.id);
    }
    if (node.url) out.url = node.url;
    if (node.folderType) out.folderType = node.folderType;
    if (!node.url && deep) out.children = node.childIds.map((c) => view(nodes.get(c), true));
    return out;
  }

  function must(id) {
    const n = nodes.get(String(id));
    if (!n) throw new Error("Can't find bookmark for id.");
    return n;
  }

  const bookmarkEvents = {
    onCreated: event(), onRemoved: event(), onChanged: event(), onMoved: event(),
    onChildrenReordered: event(), onImportEnded: event(),
  };

  const bookmarks = {
    ...bookmarkEvents,
    async getTree() {
      return [view(nodes.get("0"), true)];
    },
    async get(idOrIds) {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      return ids.map((id) => view(must(id), false));
    },
    async getSubTree(id) {
      return [view(must(id), true)];
    },
    async getChildren(id) {
      return must(id).childIds.map((c) => view(nodes.get(c), false));
    },
    async create({ parentId, title = "", url, index }) {
      const parent = nodes.get(String(parentId));
      if (!parent || parent.url) throw new Error("Can't find parent bookmark for id.");
      const node = insert({ title, url, dateAdded: fake.now }, parent.id);
      if (index != null) {
        parent.childIds.pop();
        parent.childIds.splice(index, 0, node.id);
      }
      bookmarkEvents.onCreated.fire(node.id, view(node, false));
      return view(node, false);
    },
    async move(id, { parentId, index }) {
      const node = must(id);
      const target = nodes.get(String(parentId ?? node.parentId));
      if (!target || target.url) throw new Error("Can't find parent bookmark for id.");
      const old = nodes.get(node.parentId);
      const oldIndex = old.childIds.indexOf(node.id);
      old.childIds.splice(oldIndex, 1);
      // Chrome (BookmarkModel::Move) reads `index` as a position in the folder *before* the node is
      // taken out, so moving down within one folder lands one slot earlier than a naive splice.
      let at = index ?? target.childIds.length;
      if (index != null && target === old && index > oldIndex) at -= 1;
      target.childIds.splice(at, 0, node.id);
      node.parentId = target.id;
      bookmarkEvents.onMoved.fire(node.id, { parentId: target.id, oldParentId: old.id });
      return view(node, false);
    },
    async update(id, changes) {
      const node = must(id);
      Object.assign(node, changes);
      bookmarkEvents.onChanged.fire(node.id, changes);
      return view(node, false);
    },
    async removeTree(id) {
      const node = must(id);
      const drop = (n) => {
        n.childIds?.forEach((c) => drop(nodes.get(c)));
        nodes.delete(n.id);
      };
      const parent = nodes.get(node.parentId);
      parent.childIds.splice(parent.childIds.indexOf(node.id), 1);
      drop(node);
      bookmarkEvents.onRemoved.fire(id, {});
    },
    async remove(id) {
      const node = must(id);
      if (node.childIds?.length) throw new Error("Can't remove non-empty folder (use recursive to force).");
      return bookmarks.removeTree(id);
    },
  };

  // ---------- tabs & groups ----------
  let nextTabId = 100;
  let nextGroupId = 500;
  const tabMap = new Map();
  const groupMap = new Map();
  for (const g of groups) {
    groupMap.set(g.id, { color: "grey", collapsed: false, ...g });
    nextGroupId = Math.max(nextGroupId, g.id + 1);
  }
  const tabEvents = { onCreated: event(), onRemoved: event(), onUpdated: event(), onAttached: event(), onDetached: event(), onReplaced: event() };
  const groupEvents = { onCreated: event(), onRemoved: event(), onUpdated: event() };

  function addTab(t) {
    const id = t.id ?? nextTabId++;
    nextTabId = Math.max(nextTabId, id + 1);
    const tab = { id, windowId: currentWindowId, title: "", groupId: -1, active: false, pinned: false, ...t };
    tab.index = [...tabMap.values()].filter((x) => x.windowId === tab.windowId).length;
    tabMap.set(id, tab);
    return tab;
  }
  tabs.forEach(addTab);

  const mustTab = (id) => {
    const t = tabMap.get(id);
    if (!t) throw new Error(`No tab with id: ${id}.`);
    return t;
  };
  const mustGroup = (id) => {
    const g = groupMap.get(id);
    if (!g) throw new Error(`No group with id: ${id}.`);
    return g;
  };
  function dropEmptyGroups() {
    for (const g of [...groupMap.values()]) {
      if (![...tabMap.values()].some((t) => t.groupId === g.id)) {
        groupMap.delete(g.id);
        groupEvents.onRemoved.fire(clone(g));
      }
    }
  }

  const chromeTabs = {
    ...tabEvents,
    async query(q = {}) {
      return [...tabMap.values()]
        .filter((t) => Object.entries(q).every(([k, v]) => t[k] === v))
        .map(clone);
    },
    async get(id) {
      return clone(mustTab(id));
    },
    async getCurrent() {
      return selfTabId != null && tabMap.has(selfTabId) ? clone(tabMap.get(selfTabId)) : undefined;
    },
    async create({ url, windowId = currentWindowId, active = true }) {
      const tab = addTab({ url, windowId, active, title: url });
      tabEvents.onCreated.fire(clone(tab));
      return clone(tab);
    },
    async update(id, props) {
      const tab = mustTab(id);
      Object.assign(tab, props);
      tabEvents.onUpdated.fire(id, props, clone(tab));
      return clone(tab);
    },
    async remove(ids) {
      for (const id of Array.isArray(ids) ? ids : [ids]) {
        mustTab(id);
        tabMap.delete(id);
        tabEvents.onRemoved.fire(id, {});
      }
      dropEmptyGroups();
    },
    async group({ tabIds, groupId, createProperties }) {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      ids.forEach(mustTab);
      let gid = groupId;
      if (gid == null) {
        gid = nextGroupId++;
        const windowId = createProperties?.windowId ?? tabMap.get(ids[0]).windowId;
        groupMap.set(gid, { id: gid, windowId, title: "", color: "grey", collapsed: false });
        groupEvents.onCreated.fire(clone(groupMap.get(gid)));
      } else {
        mustGroup(gid);
      }
      for (const id of ids) {
        const t = tabMap.get(id);
        t.groupId = gid;
        t.windowId = groupMap.get(gid).windowId;
      }
      dropEmptyGroups();
      return gid;
    },
  };

  const tabGroups = {
    ...groupEvents,
    async query(q = {}) {
      return [...groupMap.values()].filter((g) => Object.entries(q).every(([k, v]) => g[k] === v)).map(clone);
    },
    async get(id) {
      return clone(mustGroup(id));
    },
    async update(id, props) {
      const g = mustGroup(id);
      Object.assign(g, props);
      groupEvents.onUpdated.fire(clone(g));
      return clone(g);
    },
  };

  // ---------- storage, windows, runtime, alarms ----------
  const store = {};
  const storage = {
    local: {
      async get(keys) {
        if (keys == null) return clone(store);
        const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, clone(store[k])]));
      },
      async set(items) {
        Object.assign(store, clone(items));
      },
      async clear() {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  };

  const fake = {
    now,
    bookmarks,
    tabs: chromeTabs,
    tabGroups,
    storage,
    windows: {
      async getCurrent() {
        return { id: currentWindowId };
      },
      async update(id, props) {
        return { id, ...props };
      },
    },
    runtime: {
      id: "fake",
      getURL: (p = "") => `fake-extension://fake/${String(p).replace(/^\//, "")}`,
      onInstalled: event(),
      onStartup: event(),
    },
    alarms: { create() {}, onAlarm: event() },
    // Test helpers (not part of the Chrome API)
    _nodes: nodes,
    _tabs: tabMap,
    _groups: groupMap,
    _store: store,
    _findBookmark(title) {
      return [...nodes.values()].find((n) => n.title === title);
    },
  };
  return fake;
}
