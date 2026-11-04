// New tab page: DOM only. Data comes from actions.load(); every click goes through an action and
// is followed by a fresh load, because bookmarks may have changed in between.

import { daysLeft, relativeDay, sortInbox } from "./lib/archive.js";
import { colorFor } from "./lib/tabs.js";
import { displayHost } from "./lib/url.js";
import {
  ACCENTS, accentHex, dominantColor, exportAppearance, greetingFor, importAppearance, normalizeAppearance, themeTokens,
} from "./lib/theme.js";
import { createActions, Gone } from "./chrome/actions.js";
import { clearWallpaper, getWallpaper, setWallpaper } from "./wallpaper.js";

const actions = createActions(chrome);
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

/** Run an action, report the outcome, and reload. Gone is expected, not an error. */
async function run(fn, okMsg) {
  try {
    const result = await fn();
    const msg = typeof okMsg === "function" ? okMsg(result) : okMsg;
    if (msg) toast(msg);
  } catch (e) {
    if (e instanceof Gone) toast(`${e.message}，已重新整理`);
    else {
      console.error(e);
      toast(e?.message ?? String(e));
    }
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
const openedMsg = (bg, title) => (r) => !bg ? null : r.focused ? `「${title}」已經開著了` : `已在背景開啟「${title}」`;

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
    return run(() => actions.adoptFolder(p.id), `「${p.title}」已變成任務`);
  }
  if (target.newTask) {
    const name = prompt("新任務名稱", p.title ?? "");
    if (!name?.trim()) return;
    return run(async () => {
      const { taskId } = await actions.createTask(name, { tabId: isTab ? p.id : null });
      if (!isTab) await actions.moveItem(p.id, { taskId });
      return name.trim();
    }, (n) => `已建立任務「${n}」`);
  }
  if (target.role === "top") {
    return isTab
      ? run(() => actions.pinTab(p.id), (r) => (r.duplicate ? "Top 已經有了" : "已加入 Top"))
      : run(() => actions.moveItem(p.id, { role: "top" }), "已移到 Top");
  }
  if (target.role === "inbox") {
    return isTab
      ? run(() => actions.parkTab(p.id), (r) => (r.duplicate ? "Inbox 已經有了，分頁已關閉" : "已移到 Inbox，分頁已關閉"))
      : run(() => actions.moveItem(p.id, { role: "inbox" }), "已移到 Inbox");
  }
  if (target.taskId) {
    return isTab
      ? run(() => actions.fileTab(p.id, target.taskId), `已加入「${target.title}」`)
      : run(() => actions.moveItem(p.id, { taskId: target.taskId }), `已移到「${target.title}」`);
  }
}

// ---------- inline rename ----------

/**
 * Swap `hide` for a text input; Enter or leaving the field saves, Esc cancels. The input stops
 * click/drag events so typing never opens the page or starts a drag of the row around it.
 */
function inlineEdit({ hide, value, onSave, wrap = (input) => input }) {
  const input = el("input", { class: "rename", type: "text", "aria-label": "新名稱" });
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
    if (save && next && next !== value) run(() => onSave(next), "已重新命名");
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
      title: `${it.title}\n${it.url}${it.openTabId != null ? "\n（已開啟，點擊切換）" : ""}`,
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
        title: "重新命名",
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
        title: "移到 Archive（不會刪除）",
        onclick: (ev) => {
          ev.stopPropagation(); // do not also open the pin
          run(() => actions.archiveItem(it.id), `「${it.title}」已移到 Archive`);
        },
      }, icon("x")),
    ]),
    el("span", { class: "label" }, it.title)));
  return el("section", { class: "block zone", ...dropZone({ role: "top" }) },
    el("h2", {}, "Top", el("span", { class: "count" }, String(model.top.length)),
      model.topGroupId != null ? el("button", {
        class: "btn small ghost",
        title: "關掉「Top Pin」分頁群組裡的分頁（書籤不受影響）",
        onclick: () => run(() => actions.closeTop(), (r) => `關掉 ${r.closed} 個分頁`),
      }, "收起") : null),
    pins.length ? el("div", { class: "pins" }, pins) : emptyState("star", "把分頁拖到這裡，或在書籤的 Top 資料夾放入網頁。"));
}

/** The tinted square behind a Top icon; its tint comes from the favicon itself. */
function pinTile(it, controls = []) {
  const tile = el("span", { class: "tile" }, controls);
  tile.append(favicon(it.iconPage ?? it.url, 32, { tint: tile }));
  if (it.openTabId != null) tile.append(el("span", { class: "dot", title: "已開啟" }));
  return tile;
}

function itemRow(it, { taskId = null, extra = null, archivable = true, reorder = false } = {}) {
  const drag = dragSource({ kind: "item", id: it.id, title: it.title, url: it.url });
  return el("li", { class: "row", ...drag, ...(reorder ? placeTarget(it) : {}) },
    el("button", {
      class: "edit hover-only",
      title: "重新命名",
      onclick: (ev) => inlineEdit({
        hide: ev.currentTarget.parentElement.querySelector(".main"),
        value: it.title,
        onSave: (v) => actions.renameItem(it.id, v),
      }),
    }, icon("edit")),
    el("button", {
      draggable: "true",
      class: "main",
      title: it.openable ? it.url : "無法從擴充開啟（例如 bookmarklet）",
      disabled: !it.openable,
      onclick: (ev) => {
        const bg = wantsBackground(ev);
        run(() => actions.openItem(it.id, { selfTabId: leaving(), taskId, background: bg }), openedMsg(bg, it.title));
      },
      onauxclick: (ev) => ev.button === 1 && run(() => actions.openItem(it.id, { selfTabId, taskId, background: true })),
    },
    favicon(it.iconPage ?? it.url),
    el("span", { class: "text" }, it.title, el("span", { class: "host" }, displayHost(it.url)))),
    it.openTabId != null ? el("span", { class: "dot", title: "已開啟" }) : null,
    extra,
    archivable ? el("button", {
      class: "btn small ghost hover-only",
      title: "移到 Archive（不會刪除）",
      onclick: () => run(() => actions.archiveItem(it.id), "已移到 Archive"),
    }, "Archive") : null);
}

function renderTasks(model, now) {
  if (!model.folders.groups) return null;
  const cards = model.tasks.map((t) => {
    const color = GROUP_COLORS[colorFor(t.title)];
    const meta = [el("span", {}, `${t.items.length} 頁`)];
    if (t.openCount) meta.push(el("span", { class: "chip" }, el("span", { class: "dot" }), `${t.openCount} 開著`));
    if (t.lastOpened) meta.push(el("span", {}, `上次 ${relativeDay(t.lastOpened, now)}`));
    const zone = t.loose ? {} : dropZone({ taskId: t.id, title: t.title });
    // Folding is instant (class toggle) and only then persisted; no re-render needed.
    const fold = el("button", {
      class: "icon-btn small fold",
      title: t.collapsed ? "展開" : "收合",
      "aria-expanded": String(!t.collapsed),
      onclick: (ev) => {
        const card = ev.currentTarget.closest(".task");
        const collapsed = card.classList.toggle("collapsed");
        ev.currentTarget.setAttribute("aria-expanded", String(!collapsed));
        ev.currentTarget.title = collapsed ? "展開" : "收合";
        actions.setCollapsed(t.id, collapsed).catch((e) => console.warn("[cairntab] fold not saved:", e));
      },
    }, icon("down"));
    return el("article", {
      class: `task${t.loose ? "" : " zone"}${t.collapsed ? " collapsed" : ""}`,
      style: t.loose ? null : `--task:${color}`,
      ...zone,
    },
      el("header", {},
        t.loose
          ? el("span", { class: "title", title: t.title }, t.title)
          : el("span", {
            class: "title editable",
            title: "點一下重新命名",
            onclick: (ev) => inlineEdit({
              hide: ev.currentTarget,
              value: t.title,
              onSave: (v) => actions.renameTask(t.id, v),
            }),
          }, t.title),
        el("span", { class: "actions" },
          t.loose ? null : el("button", {
            class: "btn small",
            title: "把還沒開的頁面全部開進這個分頁群組",
            disabled: !t.items.some((i) => i.openable),
            onclick: (ev) => {
              const bg = wantsBackground(ev);
              run(() => actions.openTask(t.id, { selfTabId: leaving(), background: bg }),
                bg ? (r) => `在背景開了 ${r.opened} 頁` : null);
            },
          }, "全開"),
          !t.loose && t.groupId != null ? el("button", {
            class: "btn small ghost",
            title: "關掉這個任務的分頁（書籤不受影響）",
            onclick: () => run(() => actions.closeTask(t.id), (r) => `關掉 ${r.closed} 個分頁`),
          }, "收起") : null,
          fold)),
      el("p", { class: "meta" }, meta),
      el("div", { class: "task-body" },
        el("div", {},
          t.items.length
            ? el("ul", { class: "rows" }, t.items.map((it) => itemRow(it, { taskId: t.loose ? null : t.id, reorder: true })))
            : emptyState("folder", "拖分頁或書籤進來"))));
  });
  const newTask = el("button", {
    class: "task new-task zone",
    title: "點擊建立空任務，或把分頁／書籤拖到這裡建立新任務",
    ...dropZone({ newTask: true }, () => true),
    onclick: () => {
      const name = prompt("新任務名稱");
      if (name?.trim()) run(() => actions.createTask(name), `已建立任務「${name.trim()}」`);
    },
  }, el("span", { class: "plus" }, icon("plus")), el("span", {}, "新任務"), el("span", { class: "hint" }, "可拖曳分頁到這裡"));
  return el("section", { class: "block" },
    el("h2", {}, "任務", el("span", { class: "count" }, String(model.tasks.filter((t) => !t.loose).length))),
    el("div", { class: "tasks" }, cards, newTask));
}

function renderInbox(model, settings, now) {
  if (!model.folders.inbox) return null;
  const manual = settings.inboxSort === "manual";
  const rows = sortInbox(model.inbox, settings.inboxSort)
    .map((it) => {
      const left = daysLeft(it.dateAdded, settings.archiveDays, now);
      const badge = left == null ? null
        : el("span", { class: `badge${left <= 3 ? " warn" : ""}`, title: `${settings.archiveDays} 天後自動移到 Archive` },
          left === 0 ? "今天封存" : `剩 ${left} 天`);
      return itemRow(it, { reorder: manual, extra: el("span", { class: "side" }, relativeDay(it.dateAdded, now), " ", badge) });
    });
  return el("section", { class: "block zone", ...dropZone({ role: "inbox" }) },
    el("h2", {}, "Inbox", el("span", { class: "count" }, String(model.inbox.length))),
    el("div", { class: "list-panel" }, rows.length ? el("ul", { class: "rows" }, rows)
      : emptyState("inbox", "Inbox 是空的。把分頁拖到這裡，或按「Move to Inbox」。")),
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
  }, el("span", { class: "chev" }, icon("right")), `Archive ${model.archiveCount}`);
  const rows = model.archive.map((it) => itemRow(it, {
    archivable: false,
    extra: el("button", {
      class: "btn small ghost hover-only",
      title: "移回 Inbox，重新開始倒數",
      onclick: () => run(() => actions.restoreItem(it.id), "已移回 Inbox"),
    }, "移回 Inbox"),
  }));
  return el("div", { class: `archive${open ? " open" : ""}` },
    toggle,
    el("div", { class: "list-panel archive-list" },
      rows.length ? el("ul", { class: "rows" }, rows) : emptyState("archive", "Archive 是空的。"),
      el("p", { class: "hint archive-hint" }, "要永久刪除，請在書籤管理員裡操作；CairnTab 不會刪除書籤。")));
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
  }, (r) => `${label} ${r.done} 個分頁${r.gone ? `（${r.gone} 個已經關掉了）` : ""}`);
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
  const placeTag = (place) => el("span", { class: `place-tag place-${place.kind}`, title: `已收在「${place.label}」` },
    place.kind === "task" ? el("span", { class: "swatch", style: `background:${GROUP_COLORS[colorFor(place.label)]}` }) : null,
    place.label);
  const rows = ordered.map((tab) => el("li", {
    class: `row${tab.place ? " tracked" : ""}${selectedTabs.has(tab.id) ? " selected" : ""}`,
    ...dragSource({ kind: "tab", id: tab.id, title: tab.title, url: tab.url }),
  },
  el("input", {
    type: "checkbox",
    class: "pick",
    "aria-label": "選取這個分頁",
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
    onclick: () => run(async () => {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      const self = leaving();
      if (self != null && self !== tab.id) await chrome.tabs.remove(self);
    }),
  },
  // Chrome's local icon cache, not tab.favIconUrl: that is usually the site's remote URL, and loading
  // it would make this page fetch from every site you have open.
  favicon(tab.url),
  el("span", { class: "text" }, tab.title || tab.url, el("span", { class: "host" }, displayHost(tab.url)))),
  tab.place ? placeTag(tab.place) : null,
  tab.place ? null : el("span", { class: "row-actions hover-only" },
    tasks.length ? taskSelect(tasks, {
      label: "加入任務…",
      title: "加入任務：存成任務書籤，並把分頁移進任務群組",
      onPick: (taskId, name) => run(() => actions.fileTab(tab.id, taskId), `已加入「${name}」`),
    }) : null,
    el("button", {
      class: "btn small",
      title: "存進 Inbox 並關掉分頁，釋放記憶體",
      onclick: () => run(() => actions.parkTab(tab.id), (r) => r.duplicate ? "Inbox 已經有了，分頁已關閉" : "已移到 Inbox，分頁已關閉"),
    }, "Move to Inbox"))));

  const allBox = el("input", {
    type: "checkbox",
    id: "pickAll",
    "aria-label": "全選",
    onchange: (ev) => {
      for (const t of untracked) ev.target.checked ? selectedTabs.add(t.id) : selectedTabs.delete(t.id);
      scheduleRender(0);
    },
  });
  const bar = el("div", { class: "bulk-bar", id: "bulkBar" },
    el("span", { class: "count", id: "bulkCount" }),
    el("button", { class: "btn small", onclick: () => bulk("inbox", {}, "已移到 Inbox") }, "Move to Inbox"),
    el("button", { class: "btn small", onclick: () => bulk("top", {}, "已加入 Top") }, "加到 Top"),
    tasks.length ? taskSelect(tasks, {
      label: "加入任務…",
      title: "把選取的分頁存進任務並移進任務群組",
      onPick: (taskId, name) => bulk("task", { taskId }, `已加入「${name}」`),
    }) : null,
    el("button", { class: "btn small ghost", title: "只關分頁，不存書籤", onclick: () => bulk("close", {}, "已關閉") }, "關閉分頁"),
    el("button", { class: "btn small ghost", onclick: () => { selectedTabs.clear(); scheduleRender(0); } }, "取消選取"));
  const section = el("section", { class: "open-tabs" },
    el("div", { class: "open-tabs-head" },
      el("label", { class: "pick-all" }, allBox, "全選"),
      el("span", { class: "count" }, `未收納 ${unfiled.length}`)),
    el("p", { class: "hint" }, "拖到中間的 Top、任務或 Inbox 就能收納；勾選後可批次處理。"),
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
  $("#bulkCount").textContent = `已選 ${n} 個`;
  const all = $("#pickAll");
  all.checked = n > 0 && n === total;
  all.indeterminate = n > 0 && n < total;
}

/**
 * Welcome screen when the root folder does not exist (D-029): what CairnTab will create, a button to
 * create it, and — when a folder that already looks like one exists under another name (e.g. one
 * made before the default changed from "Pin") — a one-click way to use that instead.
 */
const ROLE_HELP = [
  ["Top", "常用網站，最上方的圖示列"],
  ["Groups", "每個子資料夾是一個任務"],
  ["Inbox", "之後再看的頁面，到期自動封存"],
  ["Archive", "完成或到期的項目，不會刪除"],
];

function renderNoRoot(settings, candidates = []) {
  const name = settings.rootTitle;
  const alt = candidates.map((c) => el("div", { class: "welcome-alt" },
    el("div", { class: "stext" },
      el("span", { class: "slabel" }, `找到「${c.title}」資料夾`),
      el("p", { class: "shint" }, `${c.path.length ? `${c.path.join(" › ")} › ` : ""}${c.title}，裡面有 ${c.roles.join("、")}`)),
    el("button", {
      class: "btn",
      onclick: () => run(() => actions.saveSettings({ rootTitle: c.title }), `已改用「${c.title}」資料夾`),
    }, `改用「${c.title}」`)));
  return el("section", { class: "block welcome" },
    el("div", { class: "welcome-card" },
      el("h2", {}, "歡迎使用 CairnTab"),
      el("p", { class: "welcome-lead" },
        `CairnTab 把書籤列上的一個資料夾變成你的任務板。按下按鈕，會在書籤列建立「${name}」資料夾和四個子資料夾：`),
      el("dl", { class: "welcome-roles" }, ROLE_HELP.flatMap(([t, d]) => [el("dt", {}, t), el("dd", {}, d)])),
      el("p", { class: "shint" }, "全部都是一般書籤：會跟著 Chrome 同步，也能隨時在書籤管理員裡整理。"),
      el("div", { class: "welcome-actions" },
        el("button", {
          class: "btn primary",
          onclick: () => run(() => actions.ensureStructure(), `已建立「${name}」資料夾`),
        }, icon("plus"), `建立「${name}」資料夾`),
        el("button", {
          class: "btn ghost",
          onclick: () => {
            setSide("settings");
            setTimeout(() => $("#rootTitle").focus(), 300);
          },
        }, "用其他名稱…")),
      alt.length ? el("div", { class: "welcome-alts" },
        el("p", { class: "shint" }, "已經有用過的資料夾？"), alt) : null));
}

const ROLE_LABELS = { top: "Top", groups: "Groups", inbox: "Inbox", archive: "Archive" };

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
    el("p", {}, `「${rootName}」資料夾裡還缺少：${missing.map((r) => ROLE_LABELS[r]).join("、")}。`),
    model.extras.length
      ? el("p", { class: "hint" },
        `「${rootName}」裡現有 ${model.extras.length} 個項目不屬於任何區塊（例如 ${model.extras.slice(0, 3).map((e) => `「${e.title}」`).join("、")}），`,
        "CairnTab 不會動它們。建立資料夾後，可以在書籤管理員裡把它們拖進 Top 或 Groups。")
      : null,
    el("button", { class: "btn", onclick: () => run(() => actions.ensureStructure(), "已建立缺少的資料夾") }, "建立缺少的資料夾"));
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
const isOpen = (sel) => $(sel).classList.contains("open");

function setDrawer(open) {
  if (open && narrow()) setSide(null);
  showPanel($("#drawer"), open);
  $("#bookmarksBtn").setAttribute("aria-expanded", String(open));
  pref.set("drawer.open", open);
  if (open && state) renderDrawer();
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
      el("span", { class: "text" }, n.title || "（未命名）"),
      el("span", { class: "count" }, String(kids.length))),
    open && kids.length ? el("ul", {}, kids.map((c) => drawerNode(c, depth + 1))) : null);
}

function renderDrawer() {
  if (!isOpen("#drawer")) return;
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
    toast("外觀沒有存到");
  }
  renderAppearance();
}

function tickClock() {
  const d = new Date();
  $("#greeting").textContent = appearance.greeting ? greetingFor(d.getHours()) : "CairnTab";
  $("#today").textContent = d.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "short" });
  const clock = $("#clock");
  clock.hidden = !appearance.clock;
  clock.textContent = d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
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

function range(label, key, min, max, unit) {
  const out = el("output", {}, `${appearance[key]}${unit}`);
  const input = el("input", {
    type: "range", min, max, step: 1, value: appearance[key], "aria-label": label,
    // Drag = live preview only; release = one save (not one storage write per pixel).
    oninput: (ev) => {
      out.textContent = `${ev.target.value}${unit}`;
      applyAppearance({ ...appearance, [key]: Number(ev.target.value) }, { cache: false });
    },
    onchange: (ev) => patchAppearance({ [key]: Number(ev.target.value) }),
  });
  return srow(label, el("div", { class: "range-row" }, input, out));
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

function renderAppearance() {
  const a = appearance;
  const custom = !ACCENTS[a.accent];
  const swatches = el("div", { class: "swatches" },
    Object.entries(ACCENTS).map(([name, hex]) => el("button", {
      type: "button", style: `--c:${hex}`, title: name, "aria-label": `強調色 ${name}`,
      "aria-pressed": String(a.accent === name),
      onclick: () => patchAppearance({ accent: name }),
    })),
    el("label", { class: `custom${custom ? " on" : ""}`, title: "自訂顏色" },
      el("input", {
        type: "color", value: accentHex(a.accent), "aria-label": "自訂強調色",
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
        toast("背景圖片已設定");
      } catch (e) {
        toast(e?.message ?? "圖片無法使用");
      }
    },
  });
  const imageRows = a.background === "image" ? [
    el("div", { class: "srow stack" },
      el("div", { class: "wall-preview" }, wallpaperUrl ? null : el("span", { class: "shint" }, "還沒有圖片")),
      el("div", { class: "field-actions" },
        el("button", { class: "btn small", type: "button", onclick: () => file.click() }, icon("image"), wallpaperUrl ? "換一張" : "選擇圖片"),
        wallpaperUrl ? el("button", {
          class: "btn small ghost", type: "button",
          onclick: async () => {
            await clearWallpaper();
            await loadWallpaper();
            await patchAppearance({ background: "plain" });
          },
        }, "移除圖片") : null)),
    range("遮罩", "imageDim", 0, 85, "%"),
    range("模糊", "imageBlur", 0, 24, "px"),
  ] : [];

  const footer = el("div", { class: "sfooter" },
    el("button", {
      class: "btn small ghost", type: "button", title: "把外觀設定複製到剪貼簿（不含背景圖片）",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(exportAppearance(appearance));
          toast("外觀設定已複製");
        } catch {
          prompt("複製這段文字", exportAppearance(appearance));
        }
      },
    }, "匯出"),
    el("button", {
      class: "btn small ghost", type: "button", title: "貼上之前匯出的外觀設定",
      onclick: () => {
        const text = prompt("貼上匯出的外觀設定");
        if (!text) return;
        try {
          const next = importAppearance(text);
          patchAppearance(next).then(() => toast("外觀已套用"));
        } catch (e) {
          toast(e.message);
        }
      },
    }, "匯入"),
    el("span", { class: "spacer" }),
    el("button", {
      class: "btn small ghost", type: "button",
      onclick: () => {
        if (confirm("把外觀恢復成預設值？（背景圖片會保留在裝置上，可再選回來）")) patchAppearance(normalizeAppearance(null));
      },
    }, "恢復預設"));

  $("#appearance").replaceChildren(
    sgroup("外觀", [
      seg("主題", "theme", [["system", "系統"], ["light", "淺色"], ["dark", "深色"]]),
      srow("強調色", swatches, { stack: true }),
      seg("背景", "background", [["plain", "純色"], ["tint", "色調"], ["image", "圖片"]]),
      file, ...imageRows,
    ]),
    sgroup("版面", [
      seg("密度", "density", [["comfortable", "舒適"], ["compact", "緊湊"]]),
      seg("字級", "fontSize", [["s", "小"], ["m", "中"], ["l", "大"]]),
      range("圓角", "radius", 4, 20, "px"),
      seg("任務欄數", "columns", [["auto", "自動"], ["2", "2"], ["3", "3"], ["4", "4"]]),
    ]),
    sgroup("Top 與頁首", [
      seg("Top 圖示", "pinSize", [["s", "小"], ["m", "中"], ["l", "大"]]),
      toggle("顯示網站名稱", "pinLabels"),
      toggle("問候語", "greeting", "依時段顯示早安、午安…"),
      toggle("時鐘", "clock"),
    ], footer));
}

// ---------- render loop ----------

function render() {
  const { model, settings, openTabs, now, movedToArchive } = state;
  tickClock();
  // Do not overwrite a field the user is typing in (renders happen on any bookmark/tab event).
  if (document.activeElement !== $("#rootTitle")) $("#rootTitle").value = settings.rootTitle;
  if (document.activeElement !== $("#archiveDays")) $("#archiveDays").value = settings.archiveDays;
  const missing = Object.entries(model.folders).filter(([, v]) => !v).map(([k]) => ROLE_LABELS[k] ?? k);
  const complete = !!model.root && missing.length === 0;
  $("#structureInfo").textContent = !model.root ? `書籤裡找不到「${settings.rootTitle}」`
    : missing.length ? `缺少：${missing.join("、")}`
      : model.extras.length ? `另有 ${model.extras.length} 個項目不屬於任何區塊，會被忽略` : "Top、Groups、Inbox、Archive 都在";
  $("#structureOk").hidden = !complete;
  $("#ensure").hidden = complete;
  renderOpenMode(settings.openMode);
  renderCloseOnSwitch(settings.closeOnSwitch);
  renderInboxSort(settings.inboxSort);

  const app = $("#app");
  const parts = model.root
    ? [renderMissingRoles(model), renderTop(model), renderTasks(model, now), renderInbox(model, settings, now)]
    : [renderNoRoot(settings, state.candidates)];
  if (model.warnings.length) parts.push(el("p", { class: "warnings" }, model.warnings.join("；")));
  app.replaceChildren(...parts.filter(Boolean));
  $("#tabsCount").textContent = String(openTabs.length);
  $("#tabsBody").replaceChildren(renderOpenTabs(openTabs, model) ?? emptyState("tabs", "沒有其他開著的分頁。"));
  renderDrawer();
  if (movedToArchive) toast(`${movedToArchive} 個 Inbox 項目已到期，移到 Archive`);
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
    $("#app").replaceChildren(el("p", { class: "empty" }, `載入失敗：${e?.message ?? e}`));
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
$("#bookmarksBtn").addEventListener("click", () => setDrawer(!isOpen("#drawer")));
$("#drawerClose").addEventListener("click", () => setDrawer(false));
$("#managerBtn").addEventListener("click", (ev) =>
  run(() => actions.openBookmarkManager({ selfTabId: wantsBackground(ev) ? null : leaving() })));
$("#refreshBtn").addEventListener("click", async () => {
  await reload();
  toast("已重新整理");
});
// Right panel (D-018): open tabs by default, settings swap in while open and give the slot back.
// `sideBase` is what the panel shows when settings are not open: "tabs" or null (collapsed).
// Closed by default: on most windows an open drawer covers part of the page (D-020).
let sideBase = pref.get("side.base", null);
let sideMode = null;

function setSide(mode) {
  if (mode && narrow() && isOpen("#drawer")) setDrawer(false);
  sideMode = mode;
  showPanel($("#side"), !!mode);
  $("#tabsView").hidden = mode !== "tabs";
  $("#settings").hidden = mode !== "settings";
  $("#tabsBtn").setAttribute("aria-expanded", String(mode === "tabs"));
  $("#settingsBtn").setAttribute("aria-expanded", String(mode === "settings"));
}
function setSideBase(base) {
  sideBase = base;
  pref.set("side.base", base);
  setSide(base);
}
$("#tabsBtn").addEventListener("click", () => setSideBase(sideMode === "tabs" ? null : "tabs"));
$("#tabsClose").addEventListener("click", () => setSideBase(null));
$("#settingsBtn").addEventListener("click", () => setSide(sideMode === "settings" ? sideBase : "settings"));
$("#settingsClose").addEventListener("click", () => setSide(sideBase));

// Single-key shortcuts for the header buttons (D-021). Plain letters, Gmail-style: this page owns its
// keys, so they cannot clash with Chrome's (which all use ⌘/Ctrl/Alt). Ignored while typing in a field
// and when any modifier is held, so ⌘R, ⌘T and friends still do what Chrome does.
const SHORTCUTS = { b: "#bookmarksBtn", t: "#tabsBtn", r: "#refreshBtn", s: "#settingsBtn" };
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
  if (e.target.closest?.("input, select, textarea, [contenteditable]")) return;
  const sel = SHORTCUTS[e.key.toLowerCase()];
  if (!sel) return;
  e.preventDefault();
  $(sel).click();
});

// Esc closes whatever drawers are open. A rename field handles its own Esc (cancel) first, and Chrome
// only delivers keys to a new tab page after it has been clicked once (the address bar has focus).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || e.target.closest?.("input, select, textarea")) return;
  if (!isOpen("#drawer") && !isOpen("#side")) return;
  setDrawer(false);
  setSideBase(null);
});
function renderOpenMode(mode) {
  for (const b of document.querySelectorAll("#openMode button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  $("#openModeHint").textContent = mode === "stay"
    ? "在背景開新分頁，CairnTab 留著，可以連開好幾個。⌘ 點擊則切過去。"
    : "點了就切到網頁。⌘ 點擊則在背景開、留在這頁。";
}
function renderCloseOnSwitch(on) {
  $("#closeOnSwitch").checked = on;
  $("#closeOnSwitchHint").textContent = on
    ? "這個分頁直接變成網頁，不會越開越多。"
    : "網頁開在新分頁，CairnTab 留在原處，之後可以切回來。";
}
const INBOX_SORT_HINTS = {
  expiring: "最快被封存的在最上面。",
  newest: "剛存進來的在最上面。",
  manual: "照書籤順序，可拖曳排序。",
};
function renderInboxSort(mode) {
  for (const b of document.querySelectorAll("#inboxSort button")) b.setAttribute("aria-pressed", String(b.dataset.sort === mode));
  $("#inboxSortHint").textContent = INBOX_SORT_HINTS[mode] ?? "";
}
$("#inboxSort").addEventListener("click", (ev) => {
  const mode = ev.target.closest("button")?.dataset.sort;
  if (!mode || mode === state?.settings?.inboxSort) return;
  renderInboxSort(mode);
  run(() => actions.saveSettings({ inboxSort: mode }), "Inbox 排序已更新");
});

$("#closeOnSwitch").addEventListener("change", (ev) => {
  renderCloseOnSwitch(ev.target.checked);
  run(() => actions.saveSettings({ closeOnSwitch: ev.target.checked }),
    ev.target.checked ? "切過去時會關掉 CairnTab" : "切過去時會保留 CairnTab");
});

$("#openMode").addEventListener("click", (ev) => {
  const mode = ev.target.closest("button")?.dataset.mode;
  if (!mode || mode === state?.settings?.openMode) return;
  renderOpenMode(mode);
  run(() => actions.saveSettings({ openMode: mode }), mode === "stay" ? "點擊後會留在 CairnTab" : "點擊後會切到網頁");
});

// Folder settings save on change (Enter / leaving the field), like the appearance controls.
for (const id of ["#rootTitle", "#archiveDays"]) {
  $(id).addEventListener("change", () => run(() => actions.saveSettings({
    rootTitle: $("#rootTitle").value,
    archiveDays: $("#archiveDays").value,
  }), "已儲存"));
}
$("#ensure").addEventListener("click", () => run(() => actions.ensureStructure(), "已建立缺少的資料夾"));

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
applyAppearance(await actions.readAppearance().catch(() => null));
renderAppearance();
// The clock only needs minutes; a hidden page skips ticks and catches up on becoming visible.
setInterval(() => document.hidden || tickClock(), 15_000);
document.addEventListener("visibilitychange", () => document.hidden || tickClock());

selfTabId = (await chrome.tabs.getCurrent?.())?.id ?? null;
if (pref.get("drawer.open", false)) setDrawer(true);
setSide(sideBase);
await reload();
