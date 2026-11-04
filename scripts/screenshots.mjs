// Re-render the README screenshots from the public demo data (dev/demo.js), never a real profile.
// Needs `make preview` running and a local Chrome. Uses the DevTools protocol directly (Node's
// built-in WebSocket), because `chrome --headless --screenshot` captures before the module finishes.
//   node scripts/screenshots.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://127.0.0.1:8770/dev/preview.html?demo";
const SHOTS = [
  ["overview", "&theme=light"],
  ["dark", "&theme=dark&accent=teal"],
  ["settings", "&theme=light&panel=settings"],
  ["open-tabs", "&theme=light&bg=tint&accent=coral&panel=tabs"],
];
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--hide-scrollbars", "--no-first-run",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "cairntab-shots-"))}`, "about:blank",
], { stdio: "ignore" });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  // Warm-up load: the very first navigation in a fresh profile reports ready before fonts and modules
  // settle, which produced a blank "載入中" shot.
  await send("Page.navigate", { url: BASE });
  await sleep(2500);
  for (const [name, query] of SHOTS) {
    await send("Page.navigate", { url: BASE + query });
    // Wait until the page has rendered its sections, then let drawers finish sliding.
    for (let i = 0; i < 50; i++) {
      const { result } = await send("Runtime.evaluate", { expression: "!!document.querySelector('.tasks')", returnByValue: true });
      if (result.value) break;
      await sleep(100);
    }
    await sleep(900);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`docs/screenshots/${name}.png`, Buffer.from(data, "base64"));
    console.log(`docs/screenshots/${name}.png`);
  }
  ws.close();
} finally {
  chrome.kill();
}
