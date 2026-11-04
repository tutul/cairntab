// Appearance (D-022): the stored object → CSS custom properties. Pure: no chrome.*, no DOM, so the
// page only has to copy the result onto :root, and boot.js can replay a cached copy before paint.

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
const RANGES = { imageDim: [0, 85], imageBlur: [0, 24], radius: [4, 20] };
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
  for (const k of ["pinLabels", "greeting", "clock"]) if (typeof src[k] === "boolean") out[k] = src[k];
  if (typeof src.accent === "string" && (ACCENTS[src.accent] || HEX.test(src.accent))) out.accent = src.accent.toLowerCase();
  return out;
}

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
      "--page-w": a.columns === "4" ? "1320px" : "1100px",
      "--image-dim": `${a.imageDim}%`,
      "--image-blur": `${a.imageBlur}px`,
    },
  };
}

/** Header greeting by local hour. */
export function greetingFor(hour) {
  if (hour >= 5 && hour < 11) return "早安";
  if (hour >= 11 && hour < 14) return "午安";
  if (hour >= 14 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
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
    throw new Error("不是有效的 JSON");
  }
  if (parsed?.cairntab !== "appearance") throw new Error("不是 CairnTab 的外觀檔");
  return normalizeAppearance(parsed);
}
