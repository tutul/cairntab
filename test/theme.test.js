import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS, DEFAULT_APPEARANCE, normalizeAppearance, themeTokens, greetingFor, dominantColor,
  exportAppearance, importAppearance, accentHex, MAX_WIDTH_PRESETS, removeWidthPreset, saveWidthPreset,
} from "../extension/lib/theme.js";

test("normalizeAppearance fills defaults and drops junk", () => {
  assert.deepEqual(normalizeAppearance(undefined), DEFAULT_APPEARANCE);
  const a = normalizeAppearance({ theme: "neon", radius: 99, imageDim: "-5", columns: 3, pinLabels: "no", extra: 1 });
  assert.equal(a.theme, "system");
  assert.equal(a.radius, 20);
  assert.equal(a.imageDim, 0);
  assert.equal(a.columns, "3"); // numbers from a <select> or an import are accepted
  assert.equal(a.pinLabels, true);
  assert.equal("extra" in a, false);
});

test("accent accepts presets and hex, rejects anything else", () => {
  assert.equal(normalizeAppearance({ accent: "teal" }).accent, "teal");
  assert.equal(normalizeAppearance({ accent: "#AABBCC" }).accent, "#aabbcc");
  assert.equal(normalizeAppearance({ accent: "red; background:url(x)" }).accent, "indigo");
  assert.equal(accentHex("teal"), ACCENTS.teal);
  assert.equal(accentHex("nope"), ACCENTS.indigo);
});

test("themeTokens maps settings to attrs and vars", () => {
  const t = themeTokens({ theme: "dark", density: "compact", columns: "auto", radius: 10, pinLabels: false });
  assert.equal(t.attrs["data-theme"], "dark");
  assert.equal(t.attrs["data-pin-labels"], "off");
  assert.equal(t.vars["--radius"], "10px");
  assert.equal(t.vars["--radius-sm"], "6px");
  assert.equal(t.vars["--row-pad"], "3px");
  assert.match(t.vars["--task-cols"], /auto-fill/);
  assert.equal(themeTokens({}).attrs["data-theme"], null, "system theme sets no attribute");
  assert.equal(themeTokens({ columns: "4" }).vars["--task-cols"], "repeat(4, minmax(0, 1fr))");
});

test("greetingFor covers the whole day", () => {
  assert.equal(greetingFor(7), "greet.morning");
  assert.equal(greetingFor(12), "greet.noon");
  assert.equal(greetingFor(15), "greet.afternoon");
  assert.equal(greetingFor(20), "greet.evening");
  assert.equal(greetingFor(2), "greet.night");
  for (let h = 0; h < 24; h++) assert.ok(greetingFor(h));
});

test("dominantColor ignores grey, transparent and black pixels", () => {
  const px = (r, g, b, a = 255) => [r, g, b, a];
  const red = Array.from({ length: 8 }, () => px(200, 40, 40)).flat();
  const noise = [...px(255, 255, 255), ...px(0, 0, 0), ...px(10, 200, 10, 0), ...px(128, 128, 128)];
  assert.equal(dominantColor([...red, ...noise]), "#c82828");
  assert.equal(dominantColor(Array.from({ length: 16 }, () => px(90, 90, 90)).flat()), null);
});

test("export → import round-trips; foreign JSON is refused", () => {
  const a = { ...DEFAULT_APPEARANCE, accent: "#123456", radius: 6, background: "tint" };
  assert.deepEqual(importAppearance(exportAppearance(a)), a);
  assert.throws(() => importAppearance("{}"), /err\.importNotCairn/);
  assert.throws(() => importAppearance("nope"), /err\.importJson/);
});

test("page width: default, clamp, step, and the old 4-column width (D-040)", () => {
  assert.equal(themeTokens({}).vars["--page-w"], "1100px");
  assert.equal(themeTokens({ pageWidth: 1500 }).vars["--page-w"], "1500px");
  assert.equal(normalizeAppearance({ pageWidth: 99999 }).pageWidth, 2400);
  assert.equal(normalizeAppearance({ pageWidth: 10 }).pageWidth, 760);
  assert.equal(normalizeAppearance({ pageWidth: 1311 }).pageWidth, 1320, "rounded to the slider step");
  assert.equal(normalizeAppearance({ columns: "4" }).pageWidth, 1320, "unset + 4 columns keeps the old width");
  assert.equal(normalizeAppearance({ columns: "4", pageWidth: 1000 }).pageWidth, 1000);
});

test("width presets: save, overwrite by name, limit, remove, normalise (D-041)", () => {
  let p = saveWidthPreset([], " Laptop ", 1111);
  assert.deepEqual(p, [{ name: "Laptop", width: 1120 }]);
  p = saveWidthPreset(p, "laptop", 1300);
  assert.deepEqual(p, [{ name: "Laptop", width: 1300 }], "same name, any case, overwrites in place");
  for (let i = 1; i < MAX_WIDTH_PRESETS; i++) p = saveWidthPreset(p, `S${i}`, 800 + i * 100);
  assert.equal(p.length, MAX_WIDTH_PRESETS);
  assert.throws(() => saveWidthPreset(p, "one more", 900), /err\.presetsFull/);
  assert.throws(() => saveWidthPreset([], "  ", 900), /err\.presetNameEmpty/);
  assert.equal(saveWidthPreset(p, "S1", 2000).find((x) => x.name === "S1").width, 2000, "overwriting works when full");
  assert.deepEqual(removeWidthPreset(p, "LAPTOP").map((x) => x.name), ["S1", "S2", "S3", "S4"]);
  const n = normalizeAppearance({ widthPresets: [{ name: "a", width: 99999 }, { name: "A", width: 900 }, { name: "", width: 900 }, "junk"] });
  assert.deepEqual(n.widthPresets, [{ name: "a", width: 2400 }]);
  assert.deepEqual(normalizeAppearance({}).widthPresets, []);
});
