#!/usr/bin/env bash
# Zip extension/ for the Chrome Web Store or for sharing. Output: dist/cairntab-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./extension/manifest.json").version')
mkdir -p dist
out="dist/cairntab-${version}.zip"
rm -f "$out"
(cd extension && zip -qr "../$out" . -x '.*')
# Apache-2.0 §4: copies must carry the licence and the NOTICE attribution.
zip -qj "$out" LICENSE NOTICE
echo "$out"
