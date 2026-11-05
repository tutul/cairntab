// Bookmark tree -> page model. Pure: works on the plain objects chrome.bookmarks.getTree() returns.
//
// Everything here must tolerate whatever the user did by hand: missing folders, duplicate
// names, nested folders, loose URLs, empty titles. It never throws on shape.

import { isOpenable } from "./url.js";

export const ROLES = ["top", "groups", "inbox", "archive"];

/**
 * Folder names per role, matched case-insensitively. The first name is the one CairnTab creates;
 * the rest are older names that keep working. The pinned row's folder is "Pin" since D-035 and was
 * "Top" before (the role key stays "top" in code and storage).
 */
export const ROLE_NAMES = Object.freeze({ top: ["Pin", "Top"], groups: ["Groups"], inbox: ["Inbox"], archive: ["Archive"] });

/** The role a folder title stands for, or undefined. */
export function roleOf(title) {
  const t = normTitle(title);
  return ROLES.find((r) => ROLE_NAMES[r].some((n) => normTitle(n) === t));
}
const LOOSE_TASK_ID = "loose";

export function normTitle(title) {
  return String(title ?? "").trim().toLowerCase();
}

const isFolder = (n) => !n.url;

function children(n) {
  return Array.isArray(n?.children) ? n.children : [];
}

/** The bookmarks bar and "Other bookmarks" nodes, by folderType when Chrome provides it. */
function topLevel(tree) {
  const root = Array.isArray(tree) ? tree[0] : tree;
  const kids = children(root);
  const bar = kids.find((n) => n.folderType === "bookmarks-bar") ?? kids.find((n) => n.id === "1") ?? kids[0];
  const other = kids.find((n) => n.folderType === "other") ?? kids.find((n) => n.id === "2");
  return { root, bar, other };
}

/** Find the root folder: bar first, then Other bookmarks, then anywhere in tree order. */
export function findRoot(tree, rootTitle) {
  const want = normTitle(rootTitle);
  const { root, bar, other } = topLevel(tree);
  const direct = (parent) => children(parent).find((n) => isFolder(n) && normTitle(n.title) === want);
  const found = direct(bar) ?? direct(other);
  if (found) return found;
  const stack = [...children(root)];
  while (stack.length) {
    const n = stack.shift();
    if (isFolder(n) && normTitle(n.title) === want) return n;
    stack.push(...children(n));
  }
  return null;
}

/** All URL bookmarks below a node, depth-first in display order. */
export function flatten(node) {
  const out = [];
  const walk = (n) => {
    for (const c of children(n)) {
      if (isFolder(c)) walk(c);
      else out.push(toItem(c));
    }
  };
  if (node) walk(node);
  return out;
}

function toItem(n) {
  return {
    id: n.id,
    parentId: n.parentId,
    title: (n.title ?? "").trim() || n.url,
    url: n.url,
    dateAdded: n.dateAdded ?? 0,
    openable: isOpenable(n.url),
  };
}

/** Every id in the tree; used to garbage-collect id-keyed metadata. */
export function allIds(tree) {
  const ids = new Set();
  const walk = (n) => {
    ids.add(n.id);
    children(n).forEach(walk);
  };
  (Array.isArray(tree) ? tree : [tree]).forEach(walk);
  return ids;
}

/**
 * @returns {{
 *   root: {id,title}|null, barId: string|null,
 *   folders: {top,groups,inbox,archive: {id,title}|null},
 *   top: Item[], tasks: Task[], inbox: Item[], archive: Item[], archiveCount: number,
 *   extras: {id,title,isFolder}[], warnings: {key, params}[]  (dictionary keys, D-033)
 * }}
 */
export const DEFAULT_LABELS = Object.freeze({ loose: "Ungrouped", untitled: "(untitled)" });

export function buildModel(tree, { rootTitle = "CairnTab", labels = DEFAULT_LABELS } = {}) {
  const { bar } = topLevel(tree);
  const model = {
    root: null,
    barId: bar?.id ?? null,
    folders: { top: null, groups: null, inbox: null, archive: null },
    top: [],
    tasks: [],
    inbox: [],
    archive: [],
    archiveCount: 0,
    extras: [],
    warnings: [],
  };
  const root = findRoot(tree, rootTitle);
  if (!root) return model;
  model.root = { id: root.id, title: root.title };

  const roleNodes = {};
  for (const c of children(root)) {
    const role = isFolder(c) ? roleOf(c.title) : undefined;
    if (role && !roleNodes[role]) {
      roleNodes[role] = c;
    } else {
      if (role) model.warnings.push({ key: "warn.dupRole", params: { title: c.title } });
      model.extras.push({ id: c.id, title: c.title || c.url, isFolder: isFolder(c) });
    }
  }
  for (const r of ROLES) {
    if (roleNodes[r]) model.folders[r] = { id: roleNodes[r].id, title: roleNodes[r].title };
  }

  model.top = flatten(roleNodes.top);
  model.inbox = flatten(roleNodes.inbox);
  // Newest first: items are appended to Archive as they are archived.
  model.archive = flatten(roleNodes.archive).reverse();
  model.archiveCount = model.archive.length;

  const groups = roleNodes.groups;
  const loose = [];
  for (const c of children(groups)) {
    if (isFolder(c)) {
      model.tasks.push({ id: c.id, title: (c.title ?? "").trim() || labels.untitled, loose: false, items: flatten(c) });
    } else {
      loose.push(toItem(c));
    }
  }
  if (loose.length) {
    model.tasks.push({ id: LOOSE_TASK_ID, title: labels.loose, loose: true, items: loose });
  }
  return model;
}

/** Every item the page shows, for matching against open tabs. */
export function allItems(model) {
  return [...model.top, ...model.tasks.flatMap((t) => t.items), ...model.inbox];
}

/**
 * Folders that look like a CairnTab root under another name — at least two direct children named
 * like role folders (Top / Groups / Inbox / Archive). Offered on the welcome screen when the
 * configured root is missing, e.g. a folder from before the default name changed (D-029).
 * Bar first, then Other bookmarks, then the rest, in tree order; at most `limit`.
 */
export function findCandidateRoots(tree, { exclude = "", limit = 3 } = {}) {
  const skip = normTitle(exclude);
  const { root, bar, other } = topLevel(tree);
  const out = [];
  const seen = new Set();
  const visit = (n, path) => {
    if (!isFolder(n) || seen.has(n.id)) return;
    seen.add(n.id);
    const roleKids = children(n).filter((c) => isFolder(c) && roleOf(c.title));
    if (n !== root && n.title && normTitle(n.title) !== skip && roleKids.length >= 2) {
      out.push({ id: n.id, title: n.title, path, roles: roleKids.map((c) => c.title) });
    }
    for (const c of children(n)) visit(c, n.title ? [...path, n.title] : path);
  };
  for (const start of [bar, other, root].filter(Boolean)) {
    for (const c of children(start)) visit(c, start === root ? [] : [start.title]);
  }
  return out.slice(0, limit);
}
