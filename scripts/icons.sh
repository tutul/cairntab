#!/usr/bin/env bash
# Render assets/*.svg to the PNG sizes Chrome uses. Needs rsvg-convert (brew install librsvg).
# 16/32/48 come from the full-bleed icon-small.svg; only 128 uses the padded master icon.svg,
# because Chrome's padding guideline is for the 128 px store icon and makes 48 px look shrunken.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v rsvg-convert >/dev/null || { echo "rsvg-convert missing: brew install librsvg"; exit 1; }
mkdir -p extension/icons
for s in 16 32 48; do rsvg-convert -w "$s" -h "$s" assets/icon-small.svg -o "extension/icons/icon-$s.png"; done
for s in 128; do rsvg-convert -w "$s" -h "$s" assets/icon.svg -o "extension/icons/icon-$s.png"; done
ls -1 extension/icons
