#!/usr/bin/env bash
# Structural checks that fail fast before the tests run:
# every JS file parses, manifest.json is valid JSON, and every file it points at exists.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
while IFS= read -r f; do
  node --check "$f" >/dev/null || { echo "syntax: $f"; fail=1; }
done < <(find extension test dev -name '*.js' -not -path '*/node_modules/*')

node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs";
const m = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
const refs = [m.chrome_url_overrides?.newtab, m.background?.service_worker, ...Object.values(m.icons ?? {})].filter(Boolean);
const missing = refs.filter((p) => !existsSync(`extension/${p}`));
if (m.manifest_version !== 3) { console.error("manifest_version must be 3"); process.exit(1); }
if (missing.length) { console.error("manifest points at missing files:", missing.join(", ")); process.exit(1); }
' || fail=1

# Every local file newtab.html loads must exist (boot.js, newtab.css, icons…).
for ref in $(grep -oE '(src|href)="[^"#:]+"' extension/newtab.html | sed -E 's/^(src|href)="(.*)"$/\2/'); do
  [ -e "extension/$ref" ] || { echo "newtab.html points at missing file: $ref"; fail=1; }
done

# lib/ must stay pure: no chrome.* and no DOM (docs/conventions.md, "Code layout").
# Comment lines are skipped; they legitimately mention chrome.bookmarks etc.
if grep -nE '\bchrome\.[a-z]|\bdocument\.|\bwindow\.[a-z]' extension/lib/*.js | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/?\*)'; then
  echo "extension/lib must not touch chrome.* or the DOM"
  fail=1
fi

# UI text lives only in extension/locales (D-033): no CJK text in code or HTML anywhere else.
# Comment lines are skipped; locales/, _locales/ and the generated hanzi table are exempt.
# Node rather than grep -P, which BSD grep (macOS) does not have.
node --input-type=module -e '
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const exempt = /^extension\/(locales\/|_locales\/|lib\/hanzi-data\.js$)/;
const cjk = /[\u3400-\u9fff\uff01-\uff5e\u3000-\u303f]/;
const comment = /^\s*(\/\/|\/?\*|<!--)/;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const bad = walk("extension").filter((f) => /\.(js|html)$/.test(f) && !exempt.test(f))
  .flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l]))
  .filter(([, , l]) => cjk.test(l) && !comment.test(l));
for (const [f, n, l] of bad) console.error(`${f}:${n}: ${l.trim()}`);
if (bad.length) { console.error("UI text outside extension/locales — add a dictionary key instead (D-033)"); process.exit(1); }
' || fail=1

exit $fail
