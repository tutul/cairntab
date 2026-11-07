// Search over what CairnTab shows: Top, task pages, Inbox, and open tabs (D-030). Pure.
//
// Query: split on whitespace (and "*"); every token must appear in the title or the URL, in any
// order, ignoring case, full-/half-width and Traditional/Simplified Chinese differences. Matching is
// plain substring on Unicode text, so Chinese works the same way as Latin letters: no word
// boundaries, no tokenizer.

import { SIMP, TRAD } from "./hanzi-data.js";

const SEP = /[\s*]+/u;

let t2s = null;
/** Traditional → Simplified, one character at a time (OpenCC's default form). */
function toSimplified(s) {
  if (!t2s) {
    const t = [...TRAD];
    const v = [...SIMP];
    t2s = new Map(t.map((c, i) => [c, v[i]]));
  }
  let out = "";
  for (const c of s) out += t2s.get(c) ?? c;
  return out;
}

/**
 * One code point → its comparison form: NFKC (full-width → half-width, U+3000 → space), lower case,
 * and Traditional → Simplified, so 「發展」, 「发展」 and 「髮」 all compare as 「发…」 (D-031). Both the
 * query and the text are folded the same way and only ever compared, never shown.
 */
const fold = (ch) => toSimplified(ch.normalize("NFKC").toLowerCase());

/**
 * Normalised text plus, for each UTF-16 unit of it, the index in the original string it came from,
 * so a match found on the normalised text can be highlighted on the original.
 */
function foldWithMap(s) {
  let text = "";
  const map = [];
  let i = 0;
  for (const ch of s) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += ch.length;
  }
  map.push(i);
  return { text, map };
}

/** Query → tokens. "github  cairn", "github*cairn" and "ｇｉｔｈｕｂ　cairn" all give ["github","cairn"]. */
export function tokenize(query) {
  return [...String(query ?? "")].map(fold).join("").split(SEP).filter(Boolean);
}

/**
 * URL as shown and searched: no scheme, no "www.", percent-escapes decoded (so a Chinese path is
 * searchable as Chinese), no trailing slash. Non-web URLs keep their scheme.
 */
export function displayUrl(url) {
  let s = String(url ?? "").trim();
  try {
    s = decodeURI(s);
  } catch {
    // malformed escape: search the raw text
  }
  return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/**
 * Everything searchable, one entry per thing the user can open.
 * - Bookmarks from Top, every task, Inbox (not Archive). A bookmark with an open tab carries
 *   `openTabId`, and that tab is not listed again on its own.
 * - Open tabs not filed anywhere (describeTabs' `place` is null), as `kind: "tab"`.
 * @returns {{key, kind:"top"|"task"|"inbox"|"tab", id, title, url, label, taskId, openTabId, lastOpened}[]}
 */
export function searchEntries(model, openTabs = []) {
  const out = [];
  const add = (it, kind, label, taskId = null, color = null) => {
    if (!it.url) return;
    out.push({
      key: `b${it.id}`, kind, id: it.id, title: it.title || it.url, url: it.url, label, taskId,
      openTabId: it.openTabId ?? null, lastOpened: it.lastOpened ?? null, openable: it.openable !== false,
      iconPage: it.iconPage ?? it.url, color,
    });
  };
  for (const it of model.top ?? []) add(it, "top", "Pin");
  for (const t of model.tasks ?? []) for (const it of t.items) add(it, "task", t.title, t.loose ? null : t.id, t.color ?? null);
  for (const it of model.inbox ?? []) add(it, "inbox", "Inbox");
  const covered = new Set(out.map((e) => e.openTabId).filter((id) => id != null));
  for (const tab of openTabs) {
    if (tab.place || covered.has(tab.id) || !tab.url) continue;
    out.push({
      key: `t${tab.id}`, kind: "tab", id: tab.id, title: tab.title || tab.url, url: tab.url, label: null,
      taskId: null, openTabId: tab.id, windowId: tab.windowId, lastOpened: tab.lastAccessed ?? null, openable: true,
      iconPage: tab.url,
    });
  }
  return out;
}

/** Ranges [start, end) in `s` for each token found in it, merged and sorted. */
function ranges(folded, tokens) {
  const hits = [];
  for (const tok of tokens) {
    let from = 0;
    for (;;) {
      const at = folded.text.indexOf(tok, from);
      if (at < 0) break;
      hits.push([folded.map[at], folded.map[at + tok.length]]);
      from = at + tok.length;
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const h of hits) {
    const last = merged.at(-1);
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([...h]);
  }
  return merged;
}

/**
 * Entries matching the query, best first.
 *  rank 3: the title starts with the first token
 *  rank 2: every token is in the title
 *  rank 1: some token only matches the URL
 * Ties: open things first, then most recently opened, then the original order (Top, tasks, Inbox, tabs).
 * Each result carries `titleRanges` / `urlRanges` for highlighting `title` / `shownUrl`.
 */
export function search(entries, query, { limit = 50 } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const results = [];
  entries.forEach((e, order) => {
    const shownUrl = displayUrl(e.url);
    const t = foldWithMap(e.title ?? "");
    const u = foldWithMap(shownUrl);
    let inTitle = 0;
    for (const tok of tokens) {
      if (t.text.includes(tok)) inTitle++;
      else if (!u.text.includes(tok)) return;
    }
    const rank = t.text.trimStart().startsWith(tokens[0]) ? 3 : inTitle === tokens.length ? 2 : 1;
    results.push({
      ...e, shownUrl, rank, order,
      titleRanges: ranges(t, tokens),
      urlRanges: ranges(u, tokens),
    });
  });
  results.sort((a, b) => b.rank - a.rank
    || (b.openTabId != null) - (a.openTabId != null)
    || (b.lastOpened ?? 0) - (a.lastOpened ?? 0)
    || a.order - b.order);
  return results.slice(0, limit);
}

/** Split `s` into [{text, hit}] pieces by ranges, for rendering highlights without innerHTML. */
export function highlight(s, rs) {
  const out = [];
  let pos = 0;
  for (const [a, b] of rs) {
    if (a > pos) out.push({ text: s.slice(pos, a), hit: false });
    out.push({ text: s.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < s.length) out.push({ text: s.slice(pos), hit: false });
  return out;
}
