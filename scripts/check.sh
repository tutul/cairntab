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

exit $fail
