// Appearance (D-022): the stored object → CSS custom properties. Pure: no chrome.*, no DOM, so the
// page only has to copy the result onto :root, and boot.js can replay a cached copy before paint.

import { UserError } from "./i18n.js";

export const ACCENTS = Object.freeze({
  indigo: "#5b5bd6",
  blue: "#2f6fdf",
  teal: "#13896f",
  green: "#3f8a2a",
  amber: "#c27a0e",
  coral: "#d4572e",
  pink: "#c9407a",
  graphite: "#5f5e5a",
});

export const DEFAULT_APPEARANCE = Object.freeze({
  theme: "system", // system | light | dark
  accent: "indigo", // a key of ACCENTS, or "#rrggbb"
  background: "plain", // plain | tint | image
  imageDim: 35, // 0–85 %, how much of the page colour lies over the image
  imageBlur: 0, // 0–24 px
  density: "comfortable", // comfortable | compact
  radius: 12, // 4–20 px
  fontSize: "m", // s | m | l
  pinSize: "m", // s | m | l
  pinLabels: true,
  columns: "auto", // auto | 2 | 3 | 4
  pageWidth: 1100, // 760–2400 px, the middle column's maximum width (D-040)
  widthPresets: Object.freeze([]), // up to MAX_WIDTH_PRESETS named widths [{ name, width }] (D-041)
  greeting: true,
  clock: true,
});

const ENUMS = {
  theme: ["system", "light", "dark"],
  background: ["plain", "tint", "image"],
  density: ["comfortable", "compact"],
  fontSize: ["s", "m", "l"],
  pinSize: ["s", "m", "l"],
  columns: ["auto", "2", "3", "4"],
};
const RANGES = { imageDim: [0, 85], imageBlur: [0, 24], radius: [4, 20], pageWidth: [760, 2400] };
/** Step of the page-width slider; stored widths are rounded to it. */
export const PAGE_WIDTH_STEP = 20;
const HEX = /^#[0-9a-f]{6}$/i;

/** Any input (stored, imported, half-filled) → a complete, valid appearance. Unknown keys are dropped. */
export function normalizeAppearance(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = { ...DEFAULT_APPEARANCE };
  for (const [k, allowed] of Object.entries(ENUMS)) {
    const v = src[k] == null ? null : String(src[k]);
    if (v != null && allowed.includes(v)) out[k] = v;
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const n = Math.round(Number(src[k]));
    if (src[k] != null && src[k] !== "" && Number.isFinite(n)) out[k] = Math.min(hi, Math.max(lo, n));
  }
  // Before D-040 the width followed the column count (4 columns: 1320px); keep that look until set.
  if (src.pageWidth == null || src.pageWidth === "") out.pageWidth = out.columns === "4" ? 1320 : DEFAULT_APPEARANCE.pageWidth;
  else out.pageWidth = Math.round(out.pageWidth / PAGE_WIDTH_STEP) * PAGE_WIDTH_STEP;
  out.widthPresets = normalizeWidthPresets(src.widthPresets);
  for (const k of ["pinLabels", "greeting", "clock"]) if (typeof src[k] === "boolean") out[k] = src[k];
  if (typeof src.accent === "string" && (ACCENTS[src.accent] || HEX.test(src.accent))) out.accent = src.accent.toLowerCase();
  return out;
}

// ---------- width presets (D-041) ----------

export const MAX_WIDTH_PRESETS = 5;
const PRESET_NAME_MAX = 24;
const [WIDTH_MIN, WIDTH_MAX] = RANGES.pageWidth;

/** Any width → the nearest allowed one (clamped, on the slider step). */
export function clampPageWidth(n) {
  const v = Math.round(Number(n) / PAGE_WIDTH_STEP) * PAGE_WIDTH_STEP;
  return Number.isFinite(v) ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, v)) : DEFAULT_APPEARANCE.pageWidth;
}

const presetName = (name) => String(name ?? "").trim().slice(0, PRESET_NAME_MAX);

/** Stored or imported presets → at most MAX_WIDTH_PRESETS valid { name, width }, names unique. */
function normalizeWidthPresets(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    const name = presetName(p?.name);
    if (!name || !Number.isFinite(Number(p?.width)) || out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, width: clampPageWidth(p.width) });
    if (out.length === MAX_WIDTH_PRESETS) break;
  }
  return out;
}

/**
 * Save a named width. The same name (ignoring case) is overwritten in place; a new name is appended.
 * Throws UserError when the name is empty or all MAX_WIDTH_PRESETS slots are taken.
 */
export function saveWidthPreset(presets, name, width) {
  const clean = presetName(name);
  if (!clean) throw new UserError("err.presetNameEmpty");
  const list = normalizeWidthPresets(presets);
  const i = list.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase());
  const entry = { name: clean, width: clampPageWidth(width) };
  if (i >= 0) return list.map((p, k) => (k === i ? { ...entry, name: p.name } : p)); // keep its original spelling
  if (list.length >= MAX_WIDTH_PRESETS) throw new UserError("err.presetsFull", { n: MAX_WIDTH_PRESETS });
  return [...list, entry];
}

export const removeWidthPreset = (presets, name) =>
  normalizeWidthPresets(presets).filter((p) => p.name.toLowerCase() !== presetName(name).toLowerCase());

export const accentHex = (a) => ACCENTS[a] ?? (HEX.test(a ?? "") ? a.toLowerCase() : ACCENTS.indigo);

const FONT = { s: 13, m: 14, l: 15.5 };
const PIN = { s: 36, m: 44, l: 56 };

/**
 * CSS variables and root attributes for an appearance. `attrs` go on <html> as data-* (theme and
 * background switch whole token blocks in CSS); `vars` are custom properties.
 */
export function themeTokens(raw) {
  const a = normalizeAppearance(raw);
  const compact = a.density === "compact";
  return {
    attrs: {
      "data-theme": a.theme === "system" ? null : a.theme,
      "data-bg": a.background,
      "data-density": a.density,
      "data-pin-labels": a.pinLabels ? null : "off",
    },
    vars: {
      "--accent-base": accentHex(a.accent),
      "--radius": `${a.radius}px`,
      "--radius-sm": `${Math.max(4, Math.round(a.radius * 0.6))}px`,
      "--fs": `${FONT[a.fontSize]}px`,
      "--pin": `${PIN[a.pinSize]}px`,
      "--card-pad": compact ? "9px" : "14px",
      "--row-pad": compact ? "3px" : "6px",
      "--block-gap": compact ? "18px" : "30px",
      "--task-cols": a.columns === "auto" ? "repeat(auto-fill, minmax(300px, 1fr))" : `repeat(${a.columns}, minmax(0, 1fr))`,
      "--page-w": `${a.pageWidth}px`,
      "--image-dim": `${a.imageDim}%`,
      "--image-blur": `${a.imageBlur}px`,
    },
  };
}

/** Header greeting by local hour, as a dictionary key. */
export function greetingFor(hour) {
  if (hour >= 5 && hour < 11) return "greet.morning";
  if (hour >= 11 && hour < 14) return "greet.noon";
  if (hour >= 14 && hour < 18) return "greet.afternoon";
  if (hour >= 18 && hour < 23) return "greet.evening";
  return "greet.night";
}

/**
 * A tile tint from favicon pixels (RGBA bytes, as from canvas getImageData). Averages the opaque,
 * reasonably saturated pixels so a white or black logo outline does not wash it out; returns null
 * when the icon is (nearly) colourless, and the caller falls back to a neutral tile.
 */
export function dominantColor(rgba) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const [pr, pg, pb, pa] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    if (pa < 160) continue;
    const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
    if (max - min < 40 || max < 40) continue; // grey, white, black
    r += pr; g += pg; b += pb; n++;
  }
  if (n < 4) return null;
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Export text for the user to keep or move to another browser. The background image is not included. */
export function exportAppearance(raw) {
  return JSON.stringify({ cairntab: "appearance", version: 1, ...normalizeAppearance(raw) }, null, 2);
}

/** Inverse of exportAppearance. Throws on text that is not a CairnTab appearance export. */
export function importAppearance(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UserError("err.importJson");
  }
  if (parsed?.cairntab !== "appearance") throw new UserError("err.importNotCairn");
  return normalizeAppearance(parsed);
}
