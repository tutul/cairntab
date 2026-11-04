// URL helpers. Pure: no chrome.*, no DOM.

const UNOPENABLE = /^(javascript|data|blob):/i;

/** Can tabs.create open this? Bookmarklets cannot run from an extension in MV3. */
export function isOpenable(url) {
  return typeof url === "string" && url.trim() !== "" && !UNOPENABLE.test(url.trim());
}

/**
 * Key for "is this the same page". Ignores scheme (http/https), a leading "www.",
 * default ports, the fragment and a trailing slash, because redirects and the
 * user's bookmarks disagree on exactly those.
 */
export function urlKey(url) {
  if (typeof url !== "string") return "";
  const raw = url.trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    u.hash = "";
    return u.href;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${port}${path}${u.search}`;
}

export function sameUrl(a, b) {
  const ka = urlKey(a);
  return ka !== "" && ka === urlKey(b);
}

// Path segments that are only a UI language ("/zh-hant/", "/en-us/"). Sites such as shop.example add
// one after login or a language switch, so the open tab's path no longer equals the bookmark's.
// A fixed list rather than "any two letters": "/go/", "/ai/" and "/ui/" are real paths.
const LOCALE = /^(en|zh|ja|ko|fr|de|es|pt|it|ru|vi|th|id|tr|ar|nl|pl|uk|hi|ms|he|sv|da|fi|no|nb|cs|ro|hu|el)([-_][a-z]{2,4})?$/i;

function siteParts(url) {
  let u;
  try {
    u = new URL(String(url ?? "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
  const segs = u.pathname.split("/").filter((s) => s && !LOCALE.test(s)).map((s) => s.toLowerCase());
  return { site: host + port, segs, params: u.searchParams };
}

/** Match strength between a bookmark and an open tab's URL. Higher is closer. */
export const MATCH = Object.freeze({
  NONE: 0,
  SITE: 1, // bookmark is a site's front page, tab is anywhere on that site
  INSIDE: 2, // tab is deeper inside the bookmarked path
  PAGE: 3, // same page, ignoring language segments and any query the bookmark itself does not have
  EXACT: 4, // urlKey equal
});

/** Every query parameter of the bookmark is in the tab with the same value (extras are fine). */
function queryCovered(bookmark, tab) {
  for (const [k, v] of bookmark.params) if (!tab.params.getAll(k).includes(v)) return false;
  return true;
}

/**
 * How well an open tab matches a bookmark.
 *  EXACT  shop.example/products/blue-mug         vs shop.example/products/blue-mug/
 *  PAGE   shop.example/products/blue-mug         vs shop.example/zh-hant/products/blue-mug?x=1
 *  NONE   google.com/search?q=a               vs google.com/search?q=b   (the query is the page)
 *  INSIDE notion.so/team                      vs notion.so/team/page-123
 *  SITE   shop.example/                            vs shop.example/zh-hant/account/assets
 * Non-web URLs (chrome://, file://) only match EXACT.
 */
export function matchScore(bookmarkUrl, tabUrl) {
  if (sameUrl(bookmarkUrl, tabUrl)) return MATCH.EXACT;
  const b = siteParts(bookmarkUrl);
  const t = siteParts(tabUrl);
  if (!b || !t || b.site !== t.site) return MATCH.NONE;
  const prefix = b.segs.every((s, i) => t.segs[i] === s);
  // A bookmark with a query (a search result, a filtered view) is that query. Ignoring it made one
  // bookmarked Google search swallow every Google search tab (2026-11-04).
  if (prefix && b.segs.length === t.segs.length) return queryCovered(b, t) ? MATCH.PAGE : MATCH.NONE;
  if (prefix && b.segs.length > 0) return MATCH.INSIDE;
  if (b.segs.length === 0) return MATCH.SITE;
  return MATCH.NONE;
}

/** Host shown under a title, e.g. "github.com". */
export function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
