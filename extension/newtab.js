// New tab page: DOM only. Data comes from actions.load(); every click goes through an action and
// is followed by a fresh load, because bookmarks may have changed in between.

import { daysLeft, relativeDay, sortInbox } from "./lib/archive.js";
import { highlight, search, searchEntries, tokenize } from "./lib/search.js";
import { colorFor } from "./lib/tabs.js";
import { displayHost } from "./lib/url.js";
import {
  ACCENTS, MAX_WIDTH_PRESETS, PAGE_WIDTH_STEP, accentHex, clampPageWidth, removeWidthPreset, saveWidthPreset, dominantColor, exportAppearance, greetingFor, importAppearance, normalizeAppearance, themeTokens,
} from "./lib/theme.js";
import { createActions, Gone, TOP_GROUP_TITLE } from "./chrome/actions.js";
import { normalizeDrawers } from "./chrome/store.js";
import { createT, intlLocale, resolveLang, UserError } from "./lib/i18n.js";
import { clearWallpaper, getWallpaper, setWallpaper } from "./wallpaper.js";

// ---------- language (D-033) ----------
// `t` is swapped when the language changes; everything re-renders from state, so a switch is instant.
// The last resolved language is cached in localStorage so the first paint already uses it.
const LANG_CACHE = "cairntab.lang";
let lang = (() => {
  try {
    return resolveLang(localStorage.getItem(LANG_CACHE) ?? "auto", navigator.languages);
  } catch {
    return resolveLang("auto", navigator.languages);
  }
})();
let t = createT(lang);

const actions = createActions(chrome, { labels: () => ({ loose: t("task.loose"), untitled: t("ui.untitled") }) });
const $ = (s) => document.querySelector(s);
const GROUP_COLORS = {
  grey: "#8a8a8a", blue: "#3b78e7", cyan: "#12a4af", green: "#1e8e3e",
  yellow: "#e8a600", orange: "#e8710a", red: "#d93025", pink: "#d01884", purple: "#9334e6",
};

let selfTabId = null;
let state = null;

// ---------- helpers ----------

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

/** One stroke icon set for every in-page control (D-022), instead of mixed text glyphs. */
const ICONS = {
  x: ["M6 6l12 12", "M18 6L6 18"],
  edit: ["M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z", "M14 7l3 3"],
  down: ["M6 9l6 6 6-6"],
  right: ["M9 6l6 6-6 6"],
  plus: ["M12 5v14", "M5 12h14"],
  inbox: ["M4 13l2.5-7h11L20 13v6H4z", "M4 13h5l1 2h4l1-2h5"],
  archive: ["M4 5h16v4H4z", "M5 9v10h14V9", "M10 13h4"],
  trash: ["M4 7h16", "M9 7V4.5h6V7", "M6 7l1 13h10l1-13", "M10 11v5.5", "M14 11v5.5"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  star: ["M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9z"],
  tabs: ["M3 9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M7 4h11a3 3 0 0 1 3 3v10"],
  image: ["M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 16l4-4 3 3 4-4 5 5", "M9 9h.01"],
};
const SVG = "http://www.w3.org/2000/svg";
function icon(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const emptyState = (name, text) => el("p", { class: "empty" }, icon(name), el("span", {}, text));

/**
 * Tile tint per icon URL, sampled once from the favicon Chrome already has (D-022). `null` = icon is
 * colourless. In-memory only: re-sampling a few dozen 32px icons per page load costs nothing.
 */
const tintCache = new Map();
const tintCanvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(16, 16) : null;

function sampleTint(img) {
  if (!tintCanvas) return null;
  try {
    const ctx = tintCanvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(img, 0, 0, 16, 16);
    return dominantColor(ctx.getImageData(0, 0, 16, 16).data);
  } catch {
    return null; // tainted or not decodable
  }
}

const letterColor = (url) => GROUP_COLORS[colorFor(displayHost(url) || url || "?")];

/**
 * Icon from Chrome's local favicon cache (_favicon endpoint, no network); a letter tile when the
 * endpoint is unavailable (preview) or fails. Pass the URL Chrome has actually loaded (item.iconPage):
 * for a URL it never loaded, Chrome answers with the default globe rather than an error.
 */
function favicon(url, size = 16, { tint = null } = {}) {
  const letter = el("span", { class: "fav letter", style: `width:${size}px;height:${size}px;--letter:${letterColor(url)}` },
    (displayHost(url) || "?").slice(0, 1));
  const base = chrome.runtime?.getURL?.("/_favicon/") ?? "";
  const toLetter = () => {
    tint?.style.setProperty("--tile", letterColor(url));
    return letter;
  };
  if (!base.startsWith("chrome-extension://")) return toLetter();
  const href = `${base}?pageUrl=${encodeURIComponent(url)}&size=${size * 2}`;
  const img = el("img", { class: "fav", src: href, alt: "", width: size, height: size, loading: "lazy" });
  img.addEventListener("error", () => img.replaceWith(toLetter()), { once: true });
  if (tint) {
    if (tintCache.has(href)) {
      const c = tintCache.get(href);
      if (c) tint.style.setProperty("--tile", c);
    } else {
      img.addEventListener("load", () => {
        const c = sampleTint(img);
        tintCache.set(href, c);
        if (c) tint.style.setProperty("--tile", c);
      }, { once: true });
    }
  }
  return img;
}

/** Text for an error: dictionary keys for ours (UserError, Gone), the raw message for anything else. */
function errorText(e) {
  if (e instanceof Gone) return t("toast.gone", { what: t(`what.${e.what}`) });
  if (e instanceof UserError) return t(e.key, e.params);
  return e?.message ?? String(e);
}

/** Run an action, report the outcome, and reload. Gone is expected, not an error. */
async function run(fn, okMsg) {
  try {
    const result = await fn();
    const msg = typeof okMsg === "function" ? okMsg(result) : okMsg;
    if (msg) toast(msg);
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    toast(errorText(e));
  }
  scheduleRender(0);
}

/**
 * Whether a click opens in the background and keeps CairnTab in front (D-024). The user picks what a
 * plain click does (settings → 開啟方式); ⌘/Ctrl-click does the opposite, middle-click is always background.
 */
const stayMode = () => state?.settings?.openMode === "stay";
/**
 * The tab to give up when a click goes to a page: this one, unless the user keeps CairnTab around
 * (closeOnSwitch off, D-025). Passing null makes actions open a new tab and never close this one.
 */
const leaving = () => (state?.settings?.closeOnSwitch === false ? null : selfTabId);
const wantsBackground = (ev) => ev.button === 1 || (ev.metaKey || ev.ctrlKey) !== stayMode();

/** Feedback for a background open, since nothing else visibly happens on this page. */
const openedMsg = (bg, title) => (r) => !bg ? null : t(r.focused ? "toast.alreadyOpen" : "toast.openedBg", { title });

/** Where something is filed, for tags: the section name for Pin and Inbox, the task's own title. */
const placeLabel = (kind, label) => (kind === "top" ? t("sec.pin") : kind === "inbox" ? t("sec.inbox") : label);

/** "today" / "yesterday" / "N days ago" in the current language. */
function dayText(ts, now) {
  const r = relativeDay(ts, now);
  return r ? t(r.key, { n: r.n }) : "";
}

/** Fill the static page text (data-i18n*, see newtab.html) in the current language. */
function applyStaticText() {
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of n.dataset.i18nAttr.split(",")) {
      const [attr, key] = pair.split(":");
      n.setAttribute(attr, t(key));
    }
  }
  // Header buttons: the label is the accessible name and the tooltip adds the shortcut key.
  for (const n of document.querySelectorAll("[data-i18n-tip]")) {
    const label = t(n.dataset.i18nTip);
    n.setAttribute("aria-label", label);
    n.dataset.tip = `${label} (${n.getAttribute("aria-keyshortcuts")})`;
  }
  $("#usageRoles").replaceChildren(...[["Pin", "usage.top"], ["Groups", "usage.groups"], ["Inbox", "usage.inbox"], ["Archive", "usage.archive"]]
    .flatMap(([folder, key]) => [el("dt", {}, folder), el("dd", {}, t(key, { group: TOP_GROUP_TITLE }))]));
}

/**
 * Switch the page language for a setting ("auto" | "zh-Hant" | "en"). Cheap when nothing changes,
 * so render() calls it every time with the stored setting.
 */
function setLanguage(setting, { force = false } = {}) {
  const next = resolveLang(setting, navigator.languages);
  try {
    localStorage.setItem(LANG_CACHE, setting);
  } catch {
    /* cache only */
  }
  for (const b of document.querySelectorAll("#language button")) b.setAttribute("aria-pressed", String(b.dataset.lang === setting));
  if (next === lang && !force) return false;
  lang = next;
  t = createT(lang);
  applyStaticText();
  renderAppearance();
  tickClock();
  return true;
}

// ---------- drag and drop ----------
//
// Sources: open tabs ({kind:"tab"}), bookmark items ({kind:"item"}) and, from the bookmark drawer,
// folders ({kind:"folder"}).
// Targets: Top, a task card, Inbox, the "＋ 新任務" card (the only one taking folders), and item
// rows / pins themselves, which reorder: drop on the upper/left half to go before, else after.
// The payload lives in `dragging` rather than dataTransfer, because dragover handlers cannot read
// dataTransfer contents and we need to know whether to accept the drop.

let dragging = null;

function dragSource(payload) {
  return {
    draggable: "true",
    ondragstart: (ev) => {
      // In the drawer a bookmark sits inside folder rows that are drag sources too; without this
      // the event bubbles and the outermost folder overwrites the payload (seen 2026-11-04: dragging
      // "Figma" carried its grandparent folder "匯入的收藏", so every target refused it).
      ev.stopPropagation();
      dragging = payload;
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", payload.url ?? "");
      document.body.classList.add("dragging");
    },
    ondragend: () => {
      dragging = null;
      document.body.classList.remove("dragging");
      clearDropMarks();
    },
  };
}

function clearDropMarks() {
  document.querySelectorAll(".drop-over, .drop-before, .drop-after")
    .forEach((n) => n.classList.remove("drop-over", "drop-before", "drop-after"));
}

const notFolder = (p) => p.kind !== "folder";

function dropZone(target, accepts = notFolder) {
  return {
    "data-drop": "1",
    ondragover: (ev) => {
      if (!dragging || !accepts(dragging)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      ev.currentTarget.classList.add("drop-over");
    },
    ondragleave: (ev) => {
      if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove("drop-over");
    },
    ondrop: (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.currentTarget.classList.remove("drop-over");
      const payload = dragging;
      dragging = null;
      document.body.classList.remove("dragging");
      if (payload) handleDrop(payload, target);
    },
  };
}

/**
 * Reorder target on an item row or pin. Only bookmark items reorder; tabs and folders fall through
 * to the surrounding card or section.
 */
function placeTarget(anchor, { horizontal = false } = {}) {
  const side = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return horizontal ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
  };
  return {
    ondragover: (ev) => {
      if (dragging?.kind !== "item" || dragging.id === anchor.id) return;
      ev.preventDefault();
      ev.stopPropagation();
      // Without this Chrome picks an effect the source did not allow ("move" only) and silently
      // cancels the drop — seen 2026-11-04 dragging from the bookmark drawer onto a task row.
      ev.dataTransfer.dropEffect = "move";
      const after = side(ev);
      ev.currentTarget.classList.toggle("drop-after", after);
      ev.currentTarget.classList.toggle("drop-before", !after);
    },
    ondragleave: (ev) => ev.currentTarget.classList.remove("drop-before", "drop-after"),
    ondrop: (ev) => {
      if (dragging?.kind !== "item" || dragging.id === anchor.id) return;
      ev.preventDefault();
      ev.stopPropagation();
      const after = side(ev);
      const payload = dragging;
      dragging = null;
      document.body.classList.remove("dragging");
      clearDropMarks();
      run(() => actions.placeItem(payload.id, anchor.id, { after }));
    },
  };
}

function handleDrop(p, target) {
  const isTab = p.kind === "tab";
  if (p.kind === "folder") {
    return run(() => actions.adoptFolder(p.id), t("toast.adopted", { title: p.title }));
  }
  if (target.newTask) {
    const name = prompt(t("newTask.prompt"), p.title ?? "");
    if (!name?.trim()) return;
    return run(async () => {
      const { taskId } = await actions.createTask(name, { tabId: isTab ? p.id : null });
      if (!isTab) await actions.moveItem(p.id, { taskId });
      return name.trim();
    }, (n) => t("toast.taskCreated", { name: n }));
  }
  if (target.role === "top") {
    return isTab
      ? run(() => actions.pinTab(p.id), (r) => t(r.duplicate ? "toast.pinExists" : "toast.pinned"))
      : run(() => actions.moveItem(p.id, { role: "top" }), t("toast.movedToPin"));
  }
  if (target.role === "inbox") {
    return isTab
      ? run(() => actions.parkTab(p.id), (r) => t(r.duplicate ? "toast.inboxExists" : "toast.parked"))
      : run(() => actions.moveItem(p.id, { role: "inbox" }), t("toast.movedToInbox"));
  }
  if (target.taskId) {
    return isTab
      ? run(() => actions.fileTab(p.id, target.taskId), t("toast.filed", { name: target.title }))
      : run(() => actions.moveItem(p.id, { taskId: target.taskId }), t("toast.movedTo", { name: target.title }));
  }
}

// ---------- inline rename ----------

/**
 * Swap `hide` for a text input; Enter or leaving the field saves, Esc cancels. The input stops
 * click/drag events so typing never opens the page or starts a drag of the row around it.
 */
function inlineEdit({ hide, value, onSave, wrap = (input) => input }) {
  const input = el("input", { class: "rename", type: "text", "aria-label": t("ui.newName") });
  input.value = value;
  const node = wrap(input);
  const dragHost = hide.closest('[draggable="true"]');
  dragHost?.setAttribute("draggable", "false");
  hide.hidden = true;
  hide.after(node);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    node.remove();
    hide.hidden = false;
    dragHost?.setAttribute("draggable", "true");
    if (save && next && next !== value) run(() => onSave(next), t("toast.renamed"));
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault(); // handled: cancel the rename, do not also close a drawer
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  for (const type of ["click", "mousedown", "dragstart", "auxclick"]) input.addEventListener(type, (e) => e.stopPropagation());
}

// ---------- sections ----------

function renderTop(model) {
  if (!model.folders.top) return null;
  const pins = model.top.map((it) =>
    el("button", {
      ...dragSource({ kind: "item", id: it.id, title: it.title, url: it.url }),
      ...placeTarget(it, { horizontal: true }),
      class: "pin",
      title: `${it.title}\n${it.url}${it.openTabId != null ? `\n${t("pin.openHint")}` : ""}`,
      disabled: !it.openable,
      onclick: (ev) => {
        const bg = wantsBackground(ev);
        run(() => actions.openItem(it.id, { selfTabId: leaving(), group: "top", background: bg }), openedMsg(bg, it.title));
      },
      onauxclick: (ev) => ev.button === 1 && run(() => actions.openItem(it.id, { selfTabId, group: "top", background: true })),
    },
    pinTile(it, [
      el("span", {
        class: "pin-edit",
        role: "button",
        title: t("ui.rename"),
        onclick: (ev) => {
          ev.stopPropagation(); // do not also open the pin
          const pin = ev.currentTarget.closest(".pin");
          inlineEdit({
            hide: pin,
            value: it.title,
            onSave: (v) => actions.renameItem(it.id, v),
            wrap: (input) => el("div", { class: "pin editing" }, pinTile(it), input),
          });
        },
      }, icon("edit")),
      el("span", {
        class: "pin-x",
        role: "button",
        title: t("ui.archiveTitle"),
        onclick: (ev) => {
          ev.stopPropagation(); // do not also open the pin
          run(() => actions.archiveItem(it.id), t("toast.archivedItem", { title: it.title }));
        },
      }, icon("x")),
    ]),
    el("span", { class: "label" }, it.title)));
  return el("section", { class: "block zone", ...dropZone({ role: "top" }) },
    el("h2", {}, t("sec.pin"), el("span", { class: "count" }, String(model.top.length)),
      model.topGroupId != null ? el("button", {
        class: "btn small ghost",
        title: t("pin.closeTitle", { group: TOP_GROUP_TITLE }),
        onclick: () => run(() => actions.closeTop(), (r) => t("toast.closedTabs", { n: r.closed })),
      }, t("task.closeTabs")) : null),
    pins.length ? el("div", { class: "pins" }, pins) : emptyState("star", t("empty.pin")));
}

/** The tinted square behind a Top icon; its tint comes from the favicon itself. */
function pinTile(it, controls = []) {
  const tile = el("span", { class: "tile" }, controls);
  tile.append(favicon(it.iconPage ?? it.url, 32, { tint: tile }));
  if (it.openTabId != null) tile.append(el("span", { class: "dot", title: t("ui.open") }));
  return tile;
}

/**
 * "移到…" on an Inbox row: Top or a task (`from` is left out of the list). Dragging a row out of a
 * long Inbox up to a task card means scrolling while dragging (D-032). Task cards do not get it: they
 * are narrow, and even hidden the select would take the room the titles need.
 */
function moveSelect(it, from) {
  const tasks = (state?.model?.tasks ?? []).filter((t) => !t.loose && t.id !== from);
  const opts = [
    from === "top" ? null : el("option", { value: "role:top" }, t("sec.pin")),
    from === "inbox" ? null : el("option", { value: "role:inbox" }, t("sec.inbox")),
    tasks.length ? el("optgroup", { label: t("move.tasks") }, tasks.map((t) => el("option", { value: `task:${t.id}` }, t.title))) : null,
  ];
  return el("select", {
    class: "file move hover-only",
    title: t("move.title"),
    "aria-label": t("move.aria", { title: it.title }),
    onchange: (ev) => {
      const [kind, id] = ev.target.value.split(/:(.*)/s);
      const name = ev.target.selectedOptions[0]?.textContent;
      ev.target.value = "";
      if (!kind) return;
      const target = kind === "task" ? { taskId: id } : { role: id };
      run(() => actions.moveItem(it.id, target), t("toast.movedTo", { name }));
    },
  }, el("option", { value: "" }, t("move.label")), opts);
}

function itemRow(it, { taskId = null, extra = null, archivable = true, reorder = false, moveFrom = null } = {}) {
  const drag = dragSource({ kind: "item", id: it.id, title: it.title, url: it.url });
  return el("li", { class: "row", ...drag, ...(reorder ? placeTarget(it) : {}) },
    el("button", {
      class: "edit hover-only",
      title: t("ui.rename"),
      onclick: (ev) => inlineEdit({
        hide: ev.currentTarget.parentElement.querySelector(".main"),
        value: it.title,
        onSave: (v) => actions.renameItem(it.id, v),
      }),
    }, icon("edit")),
    el("button", {
      draggable: "true",
      class: "main",
      title: it.openable ? it.url : t("err.bookmarklet"),
      disabled: !it.openable,
      onclick: (ev) => {
        const bg = wantsBackground(ev);
        run(() => actions.openItem(it.id, { selfTabId: leaving(), taskId, background: bg }), openedMsg(bg, it.title));
      },
      onauxclick: (ev) => ev.button === 1 && run(() => actions.openItem(it.id, { selfTabId, taskId, background: true })),
    },
    favicon(it.iconPage ?? it.url),
    el("span", { class: "text" }, it.title, el("span", { class: "host" }, displayHost(it.url)))),
    it.openTabId != null ? el("span", { class: "dot", title: t("ui.open") }) : null,
    extra,
    moveFrom ? moveSelect(it, moveFrom) : null,
    archivable ? el("button", {
      class: "btn small ghost hover-only",
      title: t("ui.archiveTitle"),
      onclick: () => run(() => actions.archiveItem(it.id), t("toast.archived")),
    }, t("ui.archive")) : null);
}

function renderTasks(model, now) {
  if (!model.folders.groups) return null;
  const cards = model.tasks.map((task) => {
    const color = GROUP_COLORS[colorFor(task.title)];
    const meta = [el("span", {}, t("task.pages", { n: task.items.length }))];
    if (task.openCount) meta.push(el("span", { class: "chip" }, el("span", { class: "dot" }), t("task.openCount", { n: task.openCount })));
    if (task.lastOpened) meta.push(el("span", {}, t("task.last", { when: dayText(task.lastOpened, now) })));
    const zone = task.loose ? {} : dropZone({ taskId: task.id, title: task.title });
    // Folding is instant (class toggle) and only then persisted; no re-render needed.
    const fold = el("button", {
      class: "icon-btn small fold",
      title: task.collapsed ? t("ui.expand") : t("ui.fold"),
      "aria-expanded": String(!task.collapsed),
      onclick: (ev) => {
        const card = ev.currentTarget.closest(".task");
        const collapsed = card.classList.toggle("collapsed");
        ev.currentTarget.setAttribute("aria-expanded", String(!collapsed));
        ev.currentTarget.title = t(collapsed ? "ui.expand" : "ui.fold");
        actions.setCollapsed(task.id, collapsed).catch((e) => console.warn("[cairntab] fold not saved:", e));
      },
    }, icon("down"));
    return el("article", {
      class: `task${task.loose ? "" : " zone"}${task.collapsed ? " collapsed" : ""}`,
      style: task.loose ? null : `--task:${color}`,
      ...zone,
    },
      el("header", {},
        task.loose
          ? el("span", { class: "title", title: task.title }, task.title)
          : el("span", {
            class: "title editable",
            title: t("task.renameHint"),
            onclick: (ev) => inlineEdit({
              hide: ev.currentTarget,
              value: task.title,
              onSave: (v) => actions.renameTask(task.id, v),
            }),
          }, task.title),
        el("span", { class: "actions" },
          task.loose ? null : el("button", {
            class: "btn small",
            title: t("task.openAllTitle"),
            disabled: !task.items.some((i) => i.openable),
            onclick: (ev) => {
              const bg = wantsBackground(ev);
              run(() => actions.openTask(task.id, { selfTabId: leaving(), background: bg }),
                bg ? (r) => t("toast.openedTaskBg", { n: r.opened }) : null);
            },
          }, t("task.openAll")),
          !task.loose && task.groupId != null ? el("button", {
            class: "btn small ghost",
            title: t("task.closeTitle"),
            onclick: () => run(() => actions.closeTask(task.id), (r) => t("toast.closedTabs", { n: r.closed })),
          }, t("task.closeTabs")) : null,
          task.loose ? null : el("button", {
            class: "icon-btn small delete-task",
            title: t("task.delete"),
            "aria-label": t("task.delete"),
            onclick: () => {
              if (!confirm(t("task.deleteConfirm", { title: task.title, n: task.items.length }))) return;
              run(() => actions.archiveTask(task.id), (r) => t("toast.taskDeleted", { title: r.title, n: r.pages }));
            },
          }, icon("trash")),
          fold)),
      el("p", { class: "meta" }, meta),
      el("div", { class: "task-body" },
        el("div", {},
          task.items.length
            ? el("ul", { class: "rows" }, task.items.map((it) => itemRow(it, { taskId: task.loose ? null : task.id, reorder: true })))
            : emptyState("folder", t("empty.task")))));
  });
  const newTask = el("button", {
    class: "task new-task zone",
    title: t("newTask.title"),
    ...dropZone({ newTask: true }, () => true),
    onclick: () => {
      const name = prompt(t("newTask.prompt"));
      if (name?.trim()) run(() => actions.createTask(name), t("toast.taskCreated", { name: name.trim() }));
    },
  }, el("span", { class: "plus" }, icon("plus")), el("span", {}, t("newTask.label")), el("span", { class: "hint" }, t("newTask.hint")));
  return el("section", { class: "block" },
    el("h2", {}, t("sec.tasks"), el("span", { class: "count" }, String(model.tasks.filter((x) => !x.loose).length))),
    el("div", { class: "tasks" }, cards, newTask));
}

function renderInbox(model, settings, now) {
  if (!model.folders.inbox) return null;
  const manual = settings.inboxSort === "manual";
  const rows = sortInbox(model.inbox, settings.inboxSort)
    .map((it) => {
      const left = daysLeft(it.dateAdded, settings.archiveDays, now);
      const badge = left == null ? null
        : el("span", { class: `badge${left <= 3 ? " warn" : ""}`, title: t("inbox.autoTitle", { n: settings.archiveDays }) },
          left === 0 ? t("inbox.today") : t("inbox.left", { n: left }));
      return itemRow(it, { reorder: manual, moveFrom: "inbox", extra: el("span", { class: "side" }, dayText(it.dateAdded, now), " ", badge) });
    });
  return el("section", { class: "block zone", ...dropZone({ role: "inbox" }) },
    el("h2", {}, t("sec.inbox"), el("span", { class: "count" }, String(model.inbox.length))),
    el("div", { class: "list-panel" }, rows.length ? el("ul", { class: "rows" }, rows)
      : emptyState("inbox", t("empty.inbox"))),
    renderArchive(model));
}

/**
 * Archive, folded under Inbox by default. Shown so finished items can be checked or restored
 * without opening the bookmark manager. Deleting stays in the bookmark manager (D-007).
 */
function renderArchive(model) {
  if (!model.folders.archive) return null;
  const open = model.archiveOpen;
  const toggle = el("button", {
    class: "archive-toggle",
    "aria-expanded": String(open),
    onclick: (ev) => {
      const wrap = ev.currentTarget.closest(".archive");
      const now = wrap.classList.toggle("open");
      ev.currentTarget.setAttribute("aria-expanded", String(now));
      actions.setCollapsed("archive", now).catch((e) => console.warn("[cairntab] archive state not saved:", e));
    },
  }, el("span", { class: "chev" }, icon("right")), t("archive.toggle", { n: model.archiveCount }));
  const rows = model.archive.map((it) => itemRow(it, {
    archivable: false,
    extra: el("button", {
      class: "btn small ghost hover-only",
      title: t("archive.restoreTitle"),
      onclick: () => run(() => actions.restoreItem(it.id), t("toast.restored")),
    }, t("archive.restore")),
  }));
  return el("div", { class: `archive${open ? " open" : ""}` },
    toggle,
    el("div", { class: "list-panel archive-list" },
      rows.length ? el("ul", { class: "rows" }, rows) : emptyState("archive", t("empty.archive")),
      el("p", { class: "hint archive-hint" }, t("archive.hint"))));
}

/** Tab ids ticked in "other open tabs". Survives re-renders; pruned to tabs that still exist. */
const selectedTabs = new Set();

function taskSelect(tasks, { label, title, onPick, cls = "file" }) {
  return el("select", {
    class: cls,
    title,
    onchange: (ev) => {
      const taskId = ev.target.value;
      ev.target.value = "";
      if (taskId) onPick(taskId, tasks.find((t) => t.id === taskId)?.title);
    },
  }, el("option", { value: "" }, label), tasks.map((t) => el("option", { value: t.id }, t.title)));
}

function bulk(op, opts = {}, label = "") {
  const ids = [...selectedTabs];
  if (!ids.length) return;
  run(async () => {
    const r = await actions.bulkTabs(ids, op, opts);
    selectedTabs.clear();
    return r;
  }, (r) => t("toast.bulk", { label, n: r.done, gone: r.gone }));
}

/**
 * Every open tab (D-016). Unfiled ones first, with the filing actions; filed ones after, dimmed, with a
 * tag naming where they already live (Top, a task, Inbox), so the list matches the browser's tabs.
 */
function renderOpenTabs(openTabs, model) {
  for (const id of [...selectedTabs]) if (!openTabs.some((t) => t.id === id)) selectedTabs.delete(id);
  if (!openTabs.length) return null;
  const tasks = model.tasks.filter((t) => !t.loose);
  const unfiled = openTabs.filter((t) => !t.place);
  const ordered = [...unfiled, ...openTabs.filter((t) => t.place)];
  const untracked = ordered; // checkboxes and select-all cover every listed tab
  const placeTag = (place) => {
    const label = placeLabel(place.kind, place.label);
    return el("span", { class: `place-tag place-${place.kind}`, title: t("tabs.filedIn", { label }) },
      place.kind === "task" ? el("span", { class: "swatch", style: `background:${GROUP_COLORS[colorFor(place.label)]}` }) : null,
      label);
  };
  const rows = ordered.map((tab) => el("li", {
    class: `row${tab.place ? " tracked" : ""}${selectedTabs.has(tab.id) ? " selected" : ""}`,
    ...dragSource({ kind: "tab", id: tab.id, title: tab.title, url: tab.url }),
  },
  el("input", {
    type: "checkbox",
    class: "pick",
    "aria-label": t("tabs.select"),
    checked: selectedTabs.has(tab.id),
    onchange: (ev) => {
      if (ev.target.checked) selectedTabs.add(tab.id);
      else selectedTabs.delete(tab.id);
      ev.target.closest(".row").classList.toggle("selected", ev.target.checked);
      updateBulkBar(untracked.length);
    },
  }),
  el("button", {
    draggable: "true",
    class: "main",
    title: tab.url,
    onclick: () => run(() => actions.switchToTab(tab.id, { selfTabId: leaving() })),
  },
  // Chrome's local icon cache, not tab.favIconUrl: that is usually the site's remote URL, and loading
  // it would make this page fetch from every site you have open.
  favicon(tab.url),
  el("span", { class: "text" }, tab.title || tab.url, el("span", { class: "host" }, displayHost(tab.url)))),
  tab.place ? placeTag(tab.place) : null,
  tab.place ? null : el("span", { class: "row-actions hover-only" },
    tasks.length ? taskSelect(tasks, {
      label: t("tabs.addToTask"),
      title: t("tabs.addToTaskTitle"),
      onPick: (taskId, name) => run(() => actions.fileTab(tab.id, taskId), t("toast.filed", { name })),
    }) : null,
    el("button", {
      class: "btn small",
      title: t("tabs.parkTitle"),
      onclick: () => run(() => actions.parkTab(tab.id), (r) => t(r.duplicate ? "toast.inboxExists" : "toast.parked")),
    }, t("tabs.park")))));

  const allBox = el("input", {
    type: "checkbox",
    id: "pickAll",
    "aria-label": t("tabs.selectAll"),
    onchange: (ev) => {
      for (const t of untracked) ev.target.checked ? selectedTabs.add(t.id) : selectedTabs.delete(t.id);
      scheduleRender(0);
    },
  });
  const bar = el("div", { class: "bulk-bar", id: "bulkBar" },
    el("span", { class: "count", id: "bulkCount" }),
    el("button", { class: "btn small", onclick: () => bulk("inbox", {}, t("toast.movedToInbox")) }, t("tabs.park")),
    el("button", { class: "btn small", onclick: () => bulk("top", {}, t("toast.pinned")) }, t("tabs.pin")),
    tasks.length ? taskSelect(tasks, {
      label: t("tabs.addToTask"),
      title: t("tabs.addToTaskBulkTitle"),
      onPick: (taskId, name) => bulk("task", { taskId }, t("toast.filed", { name })),
    }) : null,
    el("button", { class: "btn small ghost", title: t("tabs.closeTitle"), onclick: () => bulk("close", {}, t("toast.closed")) }, t("tabs.close")),
    el("button", { class: "btn small ghost", onclick: () => { selectedTabs.clear(); scheduleRender(0); } }, t("tabs.deselect")));
  const section = el("section", { class: "open-tabs" },
    el("div", { class: "open-tabs-head" },
      el("label", { class: "pick-all" }, allBox, t("tabs.selectAll")),
      el("span", { class: "count" }, t("tabs.unfiled", { n: unfiled.length }))),
    el("p", { class: "hint" }, t("tabs.hint")),
    bar,
    el("div", { class: "list-panel" }, el("ul", { class: "rows" }, rows)));
  queueMicrotask(() => updateBulkBar(untracked.length));
  return section;
}

/** Show the batch bar only while something is ticked; keep "select all" in sync. */
function updateBulkBar(total) {
  const bar = $("#bulkBar");
  if (!bar) return;
  const n = selectedTabs.size;
  bar.hidden = n === 0;
  $("#bulkCount").textContent = t("tabs.selected", { n });
  const all = $("#pickAll");
  all.checked = n > 0 && n === total;
  all.indeterminate = n > 0 && n < total;
}

/**
 * Welcome screen when the root folder does not exist (D-029): what CairnTab will create, a button to
 * create it, and — when a folder that already looks like one exists under another name (e.g. one
 * made before the default changed from "Pin") — a one-click way to use that instead.
 */
// Folder names are shown as they are (they are what the user sees in the bookmark manager).
const ROLE_HELP = [["Pin", "role.top"], ["Groups", "role.groups"], ["Inbox", "role.inbox"], ["Archive", "role.archive"]];
const quoteList = (xs) => xs.map((s) => t("quote", { s })).join(t("list.sep"));

function renderNoRoot(settings, candidates = []) {
  const name = settings.rootTitle;
  const alt = candidates.map((c) => el("div", { class: "welcome-alt" },
    el("div", { class: "stext" },
      el("span", { class: "slabel" }, t("welcome.found", { title: c.title })),
      el("p", { class: "shint" }, t("welcome.foundDetail", {
        path: c.path.length ? `${c.path.join(" › ")} › ` : "", title: c.title, roles: c.roles.join(t("list.sep")),
      }))),
    el("button", {
      class: "btn",
      onclick: () => run(() => actions.saveSettings({ rootTitle: c.title }), t("toast.useRoot", { title: c.title })),
    }, t("welcome.use", { title: c.title }))));
  return el("section", { class: "block welcome" },
    el("div", { class: "welcome-card" },
      el("h2", {}, t("welcome.title")),
      el("p", { class: "welcome-lead" }, t("welcome.lead", { name })),
      el("dl", { class: "welcome-roles" }, ROLE_HELP.flatMap(([folder, key]) => [el("dt", {}, folder), el("dd", {}, t(key))])),
      el("p", { class: "shint" }, t("welcome.sync")),
      el("div", { class: "welcome-actions" },
        el("button", {
          class: "btn primary",
          onclick: () => run(() => actions.ensureStructure(), t("toast.rootCreated", { name })),
        }, icon("plus"), t("welcome.create", { name })),
        el("button", {
          class: "btn ghost",
          onclick: () => {
            setView("settings", true);
            showSettingsTab("folders");
            setTimeout(() => $("#rootTitle").focus(), 300);
          },
        }, t("welcome.otherName"))),
      alt.length ? el("div", { class: "welcome-alts" },
        el("p", { class: "shint" }, t("welcome.alts")), alt) : null));
}

const ROLE_LABELS = { top: "Pin", groups: "Groups", inbox: "Inbox", archive: "Archive" };

/**
 * The root exists but some role folders do not. Without this the page showed only "other tabs"
 * and looked broken (seen 2026-11-04 with an existing root folder), and the create
 * button was hidden inside settings.
 */
function renderMissingRoles(model) {
  const missing = Object.keys(ROLE_LABELS).filter((r) => !model.folders[r]);
  if (!missing.length) return null;
  const rootName = model.root.title;
  return el("section", { class: "block notice" },
    el("p", {}, t("missing.lead", { root: rootName, list: missing.map((r) => ROLE_LABELS[r]).join(t("list.sep")) })),
    model.extras.length
      ? el("p", { class: "hint" }, t("missing.extras", {
        root: rootName, n: model.extras.length, examples: quoteList(model.extras.slice(0, 3).map((e) => e.title)),
      }))
      : null,
    el("button", { class: "btn", onclick: () => run(() => actions.ensureStructure(), t("toast.rolesCreated")) }, t("missing.create")));
}

// ---------- bookmark drawer ----------
//
// Open/closed and which folders are expanded are per-browser view preferences, so they live in
// localStorage (wrapped: it can throw in some profiles) rather than chrome.storage.

const pref = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`cairntab.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`cairntab.${key}`, JSON.stringify(value));
    } catch {
      /* preference only */
    }
  },
};

let expanded = new Set(pref.get("drawer.expanded", []));

// Drawers slide over the page instead of pushing it (D-019): the middle column never moves. On wide
// screens they sit in the empty margins; below 900px they cover the page, so only one opens at once.
const narrow = () => matchMedia("(max-width: 900px)").matches;

/** Open/close a drawer. `inert` keeps a closed drawer out of Tab order and clicks while it slides. */
function showPanel(node, open) {
  node.classList.toggle("open", open);
  node.inert = !open;
}

// ---------- drawer slots (D-036) ----------
//
// Two slots, left and right. Each view (bookmarks, open tabs, settings) belongs to one side
// (settings.drawers, cached in localStorage for the first paint). A slot shows one view at a time:
// opening a view closes the other one on its side; settings cover their side while open and then
// give it back. Which of bookmarks/tabs are open is remembered; settings always start closed.

const VIEWS = { bookmarks: "#bookmarksView", tabs: "#tabsView", settings: "#settings" };
const VIEW_BTNS = { bookmarks: "#bookmarksBtn", tabs: "#tabsBtn", settings: "#settingsBtn" };
const SLOTS = { left: "#slotLeft", right: "#slotRight" };

let drawerSides = normalizeDrawers(pref.get("drawers", null));
// Before D-036: "drawer.open" (bookmarks) and "side.base" === "tabs".
let openViews = new Set(pref.get("panels.open", null)
  ?? [pref.get("drawer.open", false) && "bookmarks", pref.get("side.base", null) === "tabs" && "tabs"].filter(Boolean));
let settingsOpen = false;

const isShown = (view) => !$(VIEWS[view]).hidden && $(SLOTS[drawerSides[view]]).classList.contains("open");

/** Put each view in its slot and show what should be open. */
function applyDrawers() {
  for (const [side, sel] of Object.entries(SLOTS)) {
    const slot = $(sel);
    const mine = Object.keys(VIEWS).filter((v) => drawerSides[v] === side);
    const show = settingsOpen && drawerSides.settings === side ? "settings"
      : mine.find((v) => v !== "settings" && openViews.has(v)) ?? null;
    for (const v of mine) {
      const node = $(VIEWS[v]);
      if (node.parentElement !== slot) slot.append(node);
      node.hidden = v !== show;
    }
    showPanel(slot, !!show);
  }
  for (const [v, sel] of Object.entries(VIEW_BTNS)) $(sel).setAttribute("aria-expanded", String(isShown(v)));
  if (isShown("bookmarks") && state) renderDrawer();
}

/** Open or close one view (toggles when `open` is omitted). */
function setView(view, open = !isShown(view)) {
  const side = drawerSides[view];
  if (view === "settings") settingsOpen = open;
  else if (open) {
    for (const v of [...openViews]) if (drawerSides[v] === side) openViews.delete(v);
    openViews.add(view);
    if (drawerSides.settings === side) settingsOpen = false;
  } else openViews.delete(view);
  // Below 900px a drawer covers the page, so only one side opens at a time.
  if (open && narrow()) {
    for (const v of [...openViews]) if (drawerSides[v] !== side) openViews.delete(v);
    if (drawerSides.settings !== side) settingsOpen = false;
  }
  pref.set("panels.open", [...openViews]);
  applyDrawers();
}

function closeAllDrawers() {
  openViews.clear();
  settingsOpen = false;
  pref.set("panels.open", []);
  applyDrawers();
}

/** New sides from settings: move the views, keep what is open. */
function setDrawerSides(next) {
  const norm = normalizeDrawers(next);
  if (Object.keys(norm).every((k) => norm[k] === drawerSides[k])) return;
  drawerSides = norm;
  pref.set("drawers", norm);
  // Two views that now share a side cannot both stay open: keep the one listed first.
  const seen = new Set();
  for (const v of [...openViews]) {
    if (seen.has(drawerSides[v])) openViews.delete(v);
    seen.add(drawerSides[v]);
  }
  applyDrawers();
}

function renderDrawerSides() {
  for (const seg of document.querySelectorAll("#drawerSides [data-view]")) {
    for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.side === drawerSides[seg.dataset.view]));
  }
}

function toggleFolder(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  pref.set("drawer.expanded", [...expanded]);
  renderDrawer();
}

function drawerNode(n, depth) {
  const pad = `padding-left:${8 + depth * 14}px`;
  if (n.url) {
    return el("li", {
      class: "dnode",
      ...dragSource({ kind: "item", id: n.id, title: n.title || n.url, url: n.url }),
    }, el("button", {
      class: "dnode-main",
      draggable: "true",
      style: pad,
      title: n.url,
      onclick: (ev) => {
        const bg = wantsBackground(ev);
        run(() => actions.openItem(n.id, { selfTabId: leaving(), background: bg }), openedMsg(bg, n.title || n.url));
      },
    }, favicon(n.url), el("span", { class: "text" }, n.title || n.url)));
  }
  const open = expanded.has(n.id);
  const kids = n.children ?? [];
  // Top-level roots (bookmarks bar, other, mobile) cannot be dragged: moving them is not possible.
  const drag = depth > 0 ? dragSource({ kind: "folder", id: n.id, title: n.title }) : {};
  return el("li", { class: `dnode folder${open ? " open" : ""}`, ...drag },
    el("button", { class: "dnode-main", draggable: depth > 0 ? "true" : null, style: pad, onclick: () => toggleFolder(n.id) },
      el("span", { class: "chev" }, icon("right")),
      el("span", { class: "text" }, n.title || t("ui.untitled")),
      el("span", { class: "count" }, String(kids.length))),
    open && kids.length ? el("ul", {}, kids.map((c) => drawerNode(c, depth + 1))) : null);
}

function renderDrawer() {
  if (!isShown("bookmarks")) return;
  const roots = state?.bookmarkRoots ?? [];
  if (!pref.get("drawer.touched", false) && roots[0]) {
    expanded.add(roots[0].id); // first visit: bookmarks bar open
    pref.set("drawer.touched", true);
    pref.set("drawer.expanded", [...expanded]);
  }
  $("#drawerTree").replaceChildren(el("ul", {}, roots.map((r) => drawerNode(r, 0))));
}

// ---------- appearance (D-022) ----------
//
// Stored in chrome.storage.local via actions; applied as data-* attributes and custom properties on
// <html>. The computed tokens are mirrored to localStorage for boot.js, which replays them before the
// first paint of the next new tab.

let appearance = normalizeAppearance(null);
let wallpaperUrl = null;

async function loadWallpaper() {
  const blob = await getWallpaper();
  if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);
  wallpaperUrl = blob ? URL.createObjectURL(blob) : null;
}

function applyAppearance(a, { cache = true } = {}) {
  appearance = normalizeAppearance(a);
  const { attrs, vars } = themeTokens(appearance);
  // "image" without an image falls back to plain instead of an empty backdrop.
  if (attrs["data-bg"] === "image" && !wallpaperUrl) attrs["data-bg"] = "plain";
  const root = document.documentElement;
  for (const [k, v] of Object.entries(attrs)) v == null ? root.removeAttribute(k) : root.setAttribute(k, v);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (wallpaperUrl) root.style.setProperty("--wallpaper", `url("${wallpaperUrl}")`);
  else root.style.removeProperty("--wallpaper");
  if (cache) pref.set("tokens", { attrs, vars });
  tickClock();
}

/** Save a patch, apply what was stored (normalized), and refresh the controls. */
async function patchAppearance(patch) {
  // The image may have been chosen in another new tab since this one loaded.
  if (patch.background === "image" && !wallpaperUrl) await loadWallpaper().catch(() => null);
  applyAppearance({ ...appearance, ...patch }, { cache: false }); // instant feedback
  try {
    applyAppearance(await actions.saveAppearance(patch));
  } catch (e) {
    console.error(e);
    toast(t("toast.appearanceNotSaved"));
  }
  renderAppearance();
}

function tickClock() {
  const d = new Date();
  $("#greeting").textContent = appearance.greeting ? t(greetingFor(d.getHours())) : "CairnTab";
  $("#today").textContent = d.toLocaleDateString(intlLocale(lang), { month: "long", day: "numeric", weekday: "short" });
  const clock = $("#clock");
  clock.hidden = !appearance.clock;
  clock.textContent = d.toLocaleTimeString(intlLocale(lang), { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Settings layout: titled groups of rows, like the system settings. A row is a label (plus an
// optional one-line hint) on the left and its control on the right; wide controls stack below.
function srow(label, control, { hint = null, stack = false } = {}) {
  const text = el("div", { class: "stext" }, el("span", { class: "slabel" }, label), hint ? el("p", { class: "shint" }, hint) : null);
  return el("div", { class: `srow${stack ? " stack" : ""}` }, text, control);
}
const sgroup = (title, rows, footer = null) =>
  el("section", { class: "sgroup" }, el("h3", {}, title), el("div", { class: "scard" }, rows), footer);

function seg(label, key, options, opts) {
  return srow(label, el("div", { class: "seg", role: "group", "aria-label": label },
    options.map(([value, text]) => el("button", {
      type: "button",
      "aria-pressed": String(appearance[key] === value),
      onclick: () => patchAppearance({ [key]: value }),
    }, text))), opts);
}

function range(label, key, min, max, unit, { step = 1, hint = null } = {}) {
  const out = el("output", {}, `${appearance[key]}${unit}`);
  const input = el("input", {
    type: "range", min, max, step, value: appearance[key], "aria-label": label,
    // Drag = live preview only; release = one save (not one storage write per pixel).
    oninput: (ev) => {
      out.textContent = `${ev.target.value}${unit}`;
      applyAppearance({ ...appearance, [key]: Number(ev.target.value) }, { cache: false });
    },
    onchange: (ev) => patchAppearance({ [key]: Number(ev.target.value) }),
  });
  return srow(label, el("div", { class: "range-row" }, input, out), { hint });
}

function toggle(label, key, hint) {
  return srow(label, el("input", {
    type: "checkbox",
    class: "switch",
    role: "switch",
    "aria-label": label,
    checked: appearance[key],
    onchange: (ev) => patchAppearance({ [key]: ev.target.checked }),
  }), { hint });
}

/**
 * Content width (D-040/D-041): slider and number box kept in step, plus up to MAX_WIDTH_PRESETS named
 * widths ("Laptop", "Monitor") to switch between screens in one click.
 */
function pageWidthRow() {
  const w = appearance.pageWidth;
  const bounds = { min: 760, max: 2400, step: PAGE_WIDTH_STEP };
  const num = el("input", {
    type: "number", ...bounds, value: w, "aria-label": t("set.pageWidth"),
    onchange: (ev) => {
      const v = clampPageWidth(ev.target.value);
      ev.target.value = v;
      patchAppearance({ pageWidth: v });
    },
    onkeydown: (ev) => ev.key === "Enter" && ev.target.blur(),
  });
  const slider = el("input", {
    type: "range", ...bounds, value: w, "aria-label": t("set.pageWidth"),
    // Drag = live preview only; release = one save.
    oninput: (ev) => {
      num.value = ev.target.value;
      applyAppearance({ ...appearance, pageWidth: Number(ev.target.value) }, { cache: false });
    },
    onchange: (ev) => patchAppearance({ pageWidth: Number(ev.target.value) }),
  });
  const list = appearance.widthPresets;
  const full = list.length >= MAX_WIDTH_PRESETS;
  const presets = list.map((p) => el("span", { class: `preset${p.width === w ? " on" : ""}` },
    el("button", {
      type: "button", class: "preset-main", title: t("preset.apply", { width: p.width }),
      onclick: () => patchAppearance({ pageWidth: p.width }),
    }, el("span", { class: "preset-name" }, p.name), el("span", { class: "preset-w" }, String(p.width))),
    el("button", {
      type: "button", class: "preset-x", title: t("preset.remove", { name: p.name }), "aria-label": t("preset.remove", { name: p.name }),
      onclick: () => patchAppearance({ widthPresets: removeWidthPreset(list, p.name) }),
    }, icon("x"))));
  const save = el("button", {
    type: "button", class: "btn small ghost preset-add", disabled: full,
    title: full ? t("preset.full", { n: MAX_WIDTH_PRESETS }) : t("preset.saveTitle"),
    onclick: () => {
      const name = prompt(t("preset.prompt", { width: appearance.pageWidth }));
      if (name == null) return;
      try {
        const next = saveWidthPreset(appearance.widthPresets, name, appearance.pageWidth);
        patchAppearance({ widthPresets: next }).then(() => toast(t("toast.presetSaved", { name: name.trim() })));
      } catch (e) {
        toast(errorText(e));
      }
    },
  }, icon("plus"), t("preset.save"));
  return el("div", { class: "srow stack" },
    el("div", { class: "stext" }, el("span", { class: "slabel" }, t("set.pageWidth")), el("p", { class: "shint" }, t("set.pageWidthHint"))),
    el("div", { class: "width-row" }, slider, el("span", { class: "unit-input" }, num, el("span", {}, "px"))),
    el("div", { class: "presets" }, presets, save));
}

const SIZES = () => [["s", t("size.s")], ["m", t("size.m")], ["l", t("size.l")]];

function renderAppearance() {
  const a = appearance;
  const custom = !ACCENTS[a.accent];
  const swatches = el("div", { class: "swatches" },
    Object.entries(ACCENTS).map(([name, hex]) => el("button", {
      type: "button", style: `--c:${hex}`, title: name, "aria-label": t("accent.aria", { name }),
      "aria-pressed": String(a.accent === name),
      onclick: () => patchAppearance({ accent: name }),
    })),
    el("label", { class: `custom${custom ? " on" : ""}`, title: t("accent.custom") },
      el("input", {
        type: "color", value: accentHex(a.accent), "aria-label": t("accent.customAria"),
        oninput: (ev) => applyAppearance({ ...appearance, accent: ev.target.value }, { cache: false }),
        onchange: (ev) => patchAppearance({ accent: ev.target.value }),
      })));

  const file = el("input", {
    type: "file", accept: "image/*", hidden: true,
    onchange: async (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      try {
        await setWallpaper(f);
        await loadWallpaper();
        await patchAppearance({ background: "image" });
        toast(t("toast.wallpaperSet"));
      } catch (e) {
        toast(e instanceof UserError ? errorText(e) : t("err.imageUnusable"));
      }
    },
  });
  const imageRows = a.background === "image" ? [
    el("div", { class: "srow stack" },
      el("div", { class: "wall-preview" }, wallpaperUrl ? null : el("span", { class: "shint" }, t("bg.none"))),
      el("div", { class: "field-actions" },
        el("button", { class: "btn small", type: "button", onclick: () => file.click() }, icon("image"), t(wallpaperUrl ? "bg.change" : "bg.choose")),
        wallpaperUrl ? el("button", {
          class: "btn small ghost", type: "button",
          onclick: async () => {
            await clearWallpaper();
            await loadWallpaper();
            await patchAppearance({ background: "plain" });
          },
        }, t("bg.remove")) : null)),
    range(t("bg.dim"), "imageDim", 0, 85, "%"),
    range(t("bg.blur"), "imageBlur", 0, 24, "px"),
  ] : [];

  const footer = el("div", { class: "sfooter" },
    el("button", {
      class: "btn small ghost", type: "button", title: t("set.exportTitle"),
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(exportAppearance(appearance));
          toast(t("toast.appearanceCopied"));
        } catch {
          prompt(t("set.copyPrompt"), exportAppearance(appearance));
        }
      },
    }, t("set.export")),
    el("button", {
      class: "btn small ghost", type: "button", title: t("set.importTitle"),
      onclick: () => {
        const text = prompt(t("set.importPrompt"));
        if (!text) return;
        try {
          const next = importAppearance(text);
          patchAppearance(next).then(() => toast(t("toast.appearanceApplied")));
        } catch (e) {
          toast(errorText(e));
        }
      },
    }, t("set.import")),
    el("span", { class: "spacer" }),
    el("button", {
      class: "btn small ghost", type: "button",
      onclick: () => {
        if (confirm(t("set.resetConfirm"))) patchAppearance(normalizeAppearance(null));
      },
    }, t("set.reset")));

  // Two settings tabs (D-039): colours and background (+ export/import) under 外觀, sizes under 版面.
  $("#appearanceLook").replaceChildren(
    sgroup(t("set.colors"), [
      seg(t("set.theme"), "theme", [["system", t("theme.system")], ["light", t("theme.light")], ["dark", t("theme.dark")]]),
      srow(t("set.accent"), swatches, { stack: true }),
      seg(t("set.background"), "background", [["plain", t("bg.plain")], ["tint", t("bg.tint")], ["image", t("bg.image")]]),
      file, ...imageRows,
    ], footer));
  $("#appearanceLayout").replaceChildren(
    sgroup(t("set.sizing"), [
      pageWidthRow(),
      seg(t("set.density"), "density", [["comfortable", t("density.comfortable")], ["compact", t("density.compact")]]),
      seg(t("set.fontSize"), "fontSize", SIZES()),
      range(t("set.radius"), "radius", 4, 20, "px"),
      seg(t("set.columns"), "columns", [["auto", t("columns.auto")], ["2", "2"], ["3", "3"], ["4", "4"]]),
    ]),
    sgroup(t("set.pinHeader"), [
      seg(t("set.pinSize"), "pinSize", SIZES()),
      toggle(t("set.pinLabels"), "pinLabels"),
      toggle(t("set.greeting"), "greeting", t("set.greetingHint")),
      toggle(t("set.clock"), "clock"),
    ]));
}

// ---------- settings tabs (D-039) ----------

const SETTINGS_TABS = ["general", "appearance", "layout", "folders", "about"];

function showSettingsTab(tab) {
  const current = SETTINGS_TABS.includes(tab) ? tab : SETTINGS_TABS[0];
  for (const b of document.querySelectorAll("#settingsTabs [data-tab]")) {
    const on = b.dataset.tab === current;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const pane of document.querySelectorAll("#settings .spane")) pane.hidden = pane.dataset.pane !== current;
  $("#settings .settings-body").scrollTop = 0;
  pref.set("settings.tab", current);
}

$("#settingsTabs").addEventListener("click", (ev) => {
  const tab = ev.target.closest("[data-tab]")?.dataset.tab;
  if (tab) showSettingsTab(tab);
});
// Arrow keys move between tabs, as in any tablist.
$("#settingsTabs").addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
  const i = SETTINGS_TABS.indexOf(pref.get("settings.tab", SETTINGS_TABS[0]));
  const next = SETTINGS_TABS[(i + (ev.key === "ArrowRight" ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length];
  showSettingsTab(next);
  $(`#stab-${next}`).focus();
  ev.preventDefault();
});

// ---------- search (D-030) ----------
//
// Top, task pages, Inbox and unfiled open tabs; Archive is left out. Enter follows the click settings,
// except that something already open is always switched to. ⌘/Ctrl opens a second copy in the
// background (to compare), ⌘⇧ a second copy in front, middle-click a copy in the background.
// IME: nothing filters or opens while a composition is in progress (注音/拼音 Enter picks a word).

const q = $("#q");
let results = [];
let active = 0;

const marked = (s, rs) => highlight(s, rs).map((p) => (p.hit ? el("mark", {}, p.text) : p.text));

function whereTag(r) {
  if (r.kind === "tab") return el("span", { class: "where tab" }, t("search.openTab"));
  const swatch = r.kind === "task" && r.taskId ? el("span", { class: "swatch", style: `background:${GROUP_COLORS[colorFor(r.label)]}` }) : null;
  const label = placeLabel(r.kind, r.label);
  return el("span", { class: "where", title: label }, swatch, label);
}

function setActive(i) {
  const rows = $("#results").querySelectorAll(".result");
  if (!rows.length) return;
  active = (i + rows.length) % rows.length;
  rows.forEach((row, k) => {
    row.classList.toggle("active", k === active);
    row.setAttribute("aria-selected", String(k === active));
  });
  q.setAttribute("aria-activedescendant", rows[active].id);
  rows[active].scrollIntoView({ block: "nearest" });
}

function renderSearch({ keepActive = true } = {}) {
  const panel = $("#results");
  const show = !!state && document.activeElement === q && tokenize(q.value).length > 0;
  panel.hidden = !show;
  q.setAttribute("aria-expanded", String(show));
  if (!show) {
    results = [];
    q.removeAttribute("aria-activedescendant");
    return;
  }
  results = search(searchEntries(state.model, state.openTabs), q.value);
  if (!keepActive) active = 0;
  if (!results.length) {
    panel.replaceChildren(el("p", { class: "results-empty" }, t("search.none")));
    return;
  }
  const rows = results.map((r, i) => el("li", {
    class: "result",
    id: `result-${i}`,
    role: "option",
    "aria-disabled": r.openable ? null : "true",
    onmousedown: (ev) => ev.preventDefault(), // keep focus (and the list) in the search box
    onmousemove: () => i !== active && setActive(i),
    onclick: (ev) => openResult(r, ev),
    onauxclick: (ev) => ev.button === 1 && openResult(r, ev),
  },
  favicon(r.iconPage ?? r.url),
  el("span", { class: "text" },
    el("span", { class: "t" }, marked(r.title, r.titleRanges)),
    el("span", { class: "u" }, marked(r.shownUrl, r.urlRanges))),
  r.openTabId != null && r.kind !== "tab" ? el("span", { class: "dot", title: t("ui.open") }) : null,
  whereTag(r)));
  panel.replaceChildren(
    el("ul", {}, rows),
    el("div", { class: "results-foot" },
      el("span", {}, el("kbd", {}, "↑↓"), " ", t("search.pick")),
      el("span", {}, el("kbd", {}, "Enter"), " ", t("search.open")),
      el("span", {}, el("kbd", {}, "⌘ Enter"), " ", t("search.copyBg")),
      el("span", {}, el("kbd", {}, "⌘⇧ Enter"), " ", t("search.copyFront")),
      el("span", {}, el("kbd", {}, "Esc"), " ", t("search.clear"))));
  setActive(Math.min(active, results.length - 1));
}

function openResult(r, ev) {
  if (!r?.openable) return toast(t("err.bookmarklet"));
  const copy = ev.button === 1 || ev.metaKey || ev.ctrlKey;
  const front = copy && ev.shiftKey && ev.button !== 1;
  const group = r.kind === "top" ? "top" : null;
  if (copy) {
    const msg = front ? null : t("toast.copyBg", { title: r.title });
    if (r.kind === "tab") return run(() => actions.duplicateTab(r.id, { background: !front }), msg);
    return run(() => actions.openItem(r.id, {
      selfTabId: front ? leaving() : null, taskId: r.taskId, group, background: !front, duplicate: true,
    }), msg);
  }
  if (r.kind === "tab") return run(() => actions.switchToTab(r.id, { selfTabId: leaving() }));
  // Already open: go there, whatever the click setting (opening in the background would do nothing).
  const bg = r.openTabId == null && stayMode();
  return run(() => actions.openItem(r.id, { selfTabId: leaving(), taskId: r.taskId, group, background: bg }), openedMsg(bg, r.title));
}

q.addEventListener("input", (ev) => {
  if (ev.isComposing) return;
  renderSearch({ keepActive: false });
});
q.addEventListener("compositionend", () => renderSearch({ keepActive: false }));
q.addEventListener("focus", () => renderSearch());
q.addEventListener("blur", () => renderSearch());
q.addEventListener("keydown", (ev) => {
  // keyCode 229: Chrome's "IME is handling this key", also sent for the Enter that confirms a word.
  if (ev.isComposing || ev.keyCode === 229) return;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    setActive(active + (ev.key === "ArrowDown" ? 1 : -1));
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    if (results[active]) openResult(results[active], ev);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    if (q.value) {
      q.value = "";
      renderSearch({ keepActive: false });
    } else q.blur();
  }
});

// ---------- render loop ----------

function render() {
  const { model, settings, openTabs, now, movedToArchive } = state;
  setLanguage(settings.language);
  setDrawerSides(settings.drawers);
  renderDrawerSides();
  tickClock();
  // Do not overwrite a field the user is typing in (renders happen on any bookmark/tab event).
  if (document.activeElement !== $("#rootTitle")) $("#rootTitle").value = settings.rootTitle;
  if (document.activeElement !== $("#archiveDays")) $("#archiveDays").value = settings.archiveDays;
  const missing = Object.entries(model.folders).filter(([, v]) => !v).map(([k]) => ROLE_LABELS[k] ?? k);
  const complete = !!model.root && missing.length === 0;
  $("#structureInfo").textContent = !model.root ? t("structure.noRoot", { name: settings.rootTitle })
    : missing.length ? t("structure.missing", { list: missing.join(t("list.sep")) })
      : model.extras.length ? t("structure.extras", { n: model.extras.length }) : t("structure.all");
  $("#structureOk").hidden = !complete;
  $("#ensure").hidden = complete;
  renderOpenMode(settings.openMode);
  renderCloseOnSwitch(settings.closeOnSwitch);
  renderInboxSort(settings.inboxSort);

  const app = $("#app");
  const parts = model.root
    ? [renderMissingRoles(model), renderTop(model), renderTasks(model, now), renderInbox(model, settings, now)]
    : [renderNoRoot(settings, state.candidates)];
  if (model.warnings.length) parts.push(el("p", { class: "warnings" }, model.warnings.map((w) => t(w.key, w.params)).join(t("warn.sep"))));
  app.replaceChildren(...parts.filter(Boolean));
  $("#tabsCount").textContent = String(openTabs.length);
  $("#tabsBody").replaceChildren(renderOpenTabs(openTabs, model) ?? emptyState("tabs", t("tabs.empty")));
  renderDrawer();
  renderSearch();
  if (movedToArchive) toast(t("toast.autoArchived", { n: movedToArchive }));
}

let renderTimer = null;
let rendering = false;
let again = false;

async function reload() {
  if (rendering) {
    again = true;
    return;
  }
  rendering = true;
  try {
    state = await actions.load({ selfTabId });
    render();
  } catch (e) {
    console.error(e);
    $("#app").replaceChildren(el("p", { class: "empty" }, t("ui.loadFailed", { error: errorText(e) })));
  } finally {
    rendering = false;
    if (again) {
      again = false;
      scheduleRender();
    }
  }
}

/**
 * Re-rendering replaces the DOM, which cancels a drag in progress and closes an open <select>.
 * While the user is mid-gesture, wait and try again.
 */
function isBusy() {
  const a = document.activeElement;
  return dragging != null || a?.tagName === "SELECT" || a?.classList?.contains("rename");
}

/**
 * Coalesces bursts of bookmark/tab events into one render. A new tab page left open in the
 * background would otherwise rebuild itself on every tab event nobody is looking at, so hidden
 * pages only note that they are stale and render once when shown again.
 */
let stale = false;

function scheduleRender(delay = 150) {
  if (document.hidden) {
    stale = true;
    return;
  }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => (isBusy() ? scheduleRender(400) : reload()), delay);
}

// ---------- wiring ----------

// Bookmark/tab events already re-render; this is for when Chrome Sync or another device changed
// things without an event reaching this page.
// Chrome's "bookmarks bar only on the new tab page" does not apply once CairnTab is the new tab
// page, and many people keep the bar hidden; the drawer shows the whole tree instead.
$("#bookmarksBtn").addEventListener("click", () => setView("bookmarks"));
$("#drawerClose").addEventListener("click", () => setView("bookmarks", false));
$("#managerBtn").addEventListener("click", (ev) =>
  run(() => actions.openBookmarkManager({ selfTabId: wantsBackground(ev) ? null : leaving() })));
$("#refreshBtn").addEventListener("click", async () => {
  await reload();
  toast(t("toast.refreshed"));
});
// Drawers start closed unless they were open last time: on most windows an open drawer covers part
// of the page (D-020).
$("#tabsBtn").addEventListener("click", () => setView("tabs"));
$("#tabsClose").addEventListener("click", () => setView("tabs", false));
$("#settingsBtn").addEventListener("click", () => setView("settings"));
$("#settingsClose").addEventListener("click", () => setView("settings", false));
$("#drawerSides").addEventListener("click", (ev) => {
  const side = ev.target.closest("button")?.dataset.side;
  const view = ev.target.closest("[data-view]")?.dataset.view;
  if (!side || !view || drawerSides[view] === side) return;
  const next = { ...drawerSides, [view]: side };
  setDrawerSides(next);
  renderDrawerSides();
  run(() => actions.saveSettings({ drawers: next }), t("toast.saved"));
});

// Single-key shortcuts for the header buttons (D-021). Plain letters, Gmail-style: this page owns its
// keys, so they cannot clash with Chrome's (which all use ⌘/Ctrl/Alt). Ignored while typing in a field
// and when any modifier is held, so ⌘R, ⌘T and friends still do what Chrome does.
const SHORTCUTS = { b: "#bookmarksBtn", t: "#tabsBtn", r: "#refreshBtn", s: "#settingsBtn" };
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
  if (e.target.closest?.("input, select, textarea, [contenteditable]")) return;
  if (e.key === "/") {
    e.preventDefault();
    q.focus();
    q.select();
    return;
  }
  const sel = SHORTCUTS[e.key.toLowerCase()];
  if (!sel) return;
  e.preventDefault();
  $(sel).click();
});

// A primary click anywhere outside the drawers closes them (D-038). pointerdown, so it happens before
// the click itself, which still goes through (clicking a task page opens it and closes the drawer).
// The header buttons are left out: they toggle their own drawer. Drags start inside a drawer and are
// not affected; a drop is not a pointerdown.
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !Object.values(SLOTS).some((s) => $(s).classList.contains("open"))) return;
  if (e.target.closest?.("#slotLeft, #slotRight, .bar .tools")) return;
  closeAllDrawers();
});

// Esc closes whatever drawers are open. A rename field handles its own Esc (cancel) first, and Chrome
// only delivers keys to a new tab page after it has been clicked once (the address bar has focus).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || e.target.closest?.("input, select, textarea")) return;
  if (!Object.values(SLOTS).some((s) => $(s).classList.contains("open"))) return;
  closeAllDrawers();
});
function renderOpenMode(mode) {
  for (const b of document.querySelectorAll("#openMode button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  $("#openModeHint").textContent = t(mode === "stay" ? "openMode.hintStay" : "openMode.hintSwitch");
}
function renderCloseOnSwitch(on) {
  $("#closeOnSwitch").checked = on;
  $("#closeOnSwitchHint").textContent = t(on ? "closeOnSwitch.hintOn" : "closeOnSwitch.hintOff");
}
const INBOX_SORT_HINTS = { expiring: "sort.hintExpiring", newest: "sort.hintNewest", manual: "sort.hintManual" };
function renderInboxSort(mode) {
  for (const b of document.querySelectorAll("#inboxSort button")) b.setAttribute("aria-pressed", String(b.dataset.sort === mode));
  $("#inboxSortHint").textContent = INBOX_SORT_HINTS[mode] ? t(INBOX_SORT_HINTS[mode]) : "";
}
$("#language").addEventListener("click", (ev) => {
  const setting = ev.target.closest("button")?.dataset.lang;
  if (!setting || setting === state?.settings?.language) return;
  setLanguage(setting);
  run(() => actions.saveSettings({ language: setting }), t("toast.language"));
});

$("#inboxSort").addEventListener("click", (ev) => {
  const mode = ev.target.closest("button")?.dataset.sort;
  if (!mode || mode === state?.settings?.inboxSort) return;
  renderInboxSort(mode);
  run(() => actions.saveSettings({ inboxSort: mode }), t("toast.inboxSort"));
});

$("#closeOnSwitch").addEventListener("change", (ev) => {
  renderCloseOnSwitch(ev.target.checked);
  run(() => actions.saveSettings({ closeOnSwitch: ev.target.checked }),
    t(ev.target.checked ? "toast.closeOnSwitchOn" : "toast.closeOnSwitchOff"));
});

$("#openMode").addEventListener("click", (ev) => {
  const mode = ev.target.closest("button")?.dataset.mode;
  if (!mode || mode === state?.settings?.openMode) return;
  renderOpenMode(mode);
  run(() => actions.saveSettings({ openMode: mode }), t(mode === "stay" ? "toast.stayOn" : "toast.stayOff"));
});

// Folder settings save on change (Enter / leaving the field), like the appearance controls.
for (const id of ["#rootTitle", "#archiveDays"]) {
  $(id).addEventListener("change", () => run(() => actions.saveSettings({
    rootTitle: $("#rootTitle").value,
    archiveDays: $("#archiveDays").value,
  }), t("toast.saved")));
}
$("#ensure").addEventListener("click", () => run(() => actions.ensureStructure(), t("toast.rolesCreated")));

const listen = (ev) => ev?.addListener?.(() => scheduleRender());
for (const name of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]) {
  listen(chrome.bookmarks?.[name]);
}
for (const name of ["onCreated", "onRemoved", "onAttached", "onDetached", "onReplaced"]) {
  listen(chrome.tabs?.[name]);
}
// Price and chat pages rewrite their title every second; re-rendering on that would flicker the
// page and fight the user's mouse. Only changes that move a tab between sections matter.
chrome.tabs?.onUpdated?.addListener((_id, change) => {
  if ("url" in change || "groupId" in change || "pinned" in change || change.status === "complete") scheduleRender();
});
for (const name of ["onCreated", "onRemoved", "onUpdated"]) listen(chrome.tabGroups?.[name]);
document.addEventListener("visibilitychange", () => {
  // Coming back always re-reads: Chrome Sync or the bookmark manager may have changed things
  // without an event reaching a hidden page.
  if (document.visibilityState === "visible") {
    stale = false;
    scheduleRender(0);
  }
});

for (const id of ["#drawerClose", "#tabsClose", "#settingsClose"]) $(id).replaceChildren(icon("x"));
const version = chrome.runtime?.getManifest?.()?.version;
if (version) $("#version").textContent = `v${version}`;
await loadWallpaper().catch(() => null);
applyStaticText();
applyAppearance(await actions.readAppearance().catch(() => null));
renderAppearance();
// The clock only needs minutes; a hidden page skips ticks and catches up on becoming visible.
setInterval(() => document.hidden || tickClock(), 15_000);
document.addEventListener("visibilitychange", () => document.hidden || tickClock());

selfTabId = (await chrome.tabs.getCurrent?.())?.id ?? null;
showSettingsTab(pref.get("settings.tab", "general"));
applyDrawers();
renderDrawerSides();
await reload();
