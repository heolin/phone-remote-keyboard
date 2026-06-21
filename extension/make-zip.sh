#!/usr/bin/env bash
# Build a Chrome Web Store-ready zip of the extension. Must be run so that
# manifest.json sits at the ROOT of the zip, so we zip from inside extension/.
# Output goes to extension/dist/ (gitignored). Excludes dev-only files.
set -euo pipefail
cd "$(dirname "$0")"   # extension/

ver=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' manifest.json | grep -oE '[0-9][0-9.]*' | head -1)
mkdir -p dist
out="dist/phone-keyboard-extension-${ver}.zip"
rm -f "$out"

zip -r "$out" \
  manifest.json \
  background \
  content \
  popup \
  icons \
  -x 'icons/generate-icons.js' '*/.DS_Store' >/dev/null

echo "Built extension/$out"
unzip -l "$out"
