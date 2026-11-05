// UI language (D-033). Pure: dictionaries in, strings out.
//
// Every fixed UI string lives in extension/locales/<lang>.js as `key: "text {param}"` or
// `key: (params) => text` (for plurals and word order). Code outside locales/ holds no UI text:
// `make check` fails on CJK string literals elsewhere, and a test keeps the dictionaries' keys equal.
// Bookmark folder names (Top, Groups, Inbox, Archive, the root) are data, not UI, and never translated.

import en from "../locales/en.js";
import zhHant from "../locales/zh-Hant.js";

export const DICTS = Object.freeze({ "zh-Hant": zhHant, en });
export const LANGS = Object.freeze(Object.keys(DICTS));
export const LANGUAGE_SETTINGS = Object.freeze(["auto", ...LANGS]);

/**
 * The language to show. "auto" follows the browser: any Chinese → zh-Hant (the only Chinese
 * dictionary, and closer than English for Simplified readers too); anything else → en.
 */
export function resolveLang(setting, browserLangs = []) {
  if (LANGS.includes(setting)) return setting;
  const first = [browserLangs].flat().find(Boolean) ?? "";
  return /^zh\b/i.test(first) ? "zh-Hant" : "en";
}

/** BCP 47 tag for Intl date/time formatting. */
export const intlLocale = (lang) => (lang === "zh-Hant" ? "zh-TW" : "en-US");

/**
 * An error whose message is a dictionary key, so code that is not UI (actions, lib) can fail with
 * text the page translates. `message` stays the key, which is what tests match on.
 */
export class UserError extends Error {
  constructor(key, params = {}) {
    super(key);
    this.name = "UserError";
    this.key = key;
    this.params = params;
  }
}

const fill = (text, params) => text.replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));

/** A translate function for one language; falls back to English, then to the key itself. */
export function createT(lang) {
  const dict = DICTS[lang] ?? DICTS.en;
  return (key, params = {}) => {
    const v = dict[key] ?? DICTS.en[key];
    if (v == null) return key;
    return typeof v === "function" ? v(params) : fill(v, params);
  };
}
