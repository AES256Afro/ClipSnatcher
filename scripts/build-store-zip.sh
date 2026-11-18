#!/bin/bash
# Builds the zip to upload to the Chrome Web Store.
# The store rejects manifests that contain "key", so this copies the extension,
# removes that one line, and zips the result into dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/dist/store-build"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/extension/manifest.json" | head -1)
ZIP="$ROOT/dist/clipsnatcher-$VERSION.zip"

rm -rf "$BUILD" "$ZIP"
mkdir -p "$BUILD"
cp -R "$ROOT/extension/." "$BUILD/"
find "$BUILD" -mindepth 1 -name ".*" -prune -exec rm -rf {} +   # no hidden files or folders in the upload

sed -i.bak '/^[[:space:]]*"key":/d' "$BUILD/manifest.json" && rm "$BUILD/manifest.json.bak"
if grep -q '"key"' "$BUILD/manifest.json"; then echo "ERROR: key is still in the manifest" >&2; exit 1; fi

(cd "$BUILD" && zip -q -r -X "$ZIP" .)
echo "Built $ZIP"
unzip -l "$ZIP" | tail -1
