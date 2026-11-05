import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS, DEFAULT_APPEARANCE, normalizeAppearance, themeTokens, greetingFor, dominantColor,
  exportAppearance, importAppearance, accentHex,
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
