#!/bin/bash
# Installs the ClipSnatcher copy helper for Chrome (and Brave/Edge/Chromium if present).
# Only writes inside your home folder. Undo with: bash uninstall.sh
set -euo pipefail

EXT_ID="phdbcmaifcaagmfkmbdhokgmkldllajj"   # fixed by the "key" in extension/manifest.json
HOST="com.clipsnatcher.helper"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/ClipSnatcher"

mkdir -p "$DEST"
cp "$HERE/clipsnatcher-helper.js" "$DEST/clipsnatcher-helper.js"
chmod 755 "$DEST/clipsnatcher-helper.js"
xattr -d com.apple.quarantine "$DEST/clipsnatcher-helper.js" 2>/dev/null || true

MANIFEST=$(cat <<JSON
{
  "name": "$HOST",
  "description": "ClipSnatcher copy helper: puts a saved video file on the clipboard",
  "path": "$DEST/clipsnatcher-helper.js",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
)

installed=0
for browser in "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  base="$HOME/Library/Application Support/$browser"
  if [ -d "$base" ] || [ "$browser" = "Google/Chrome" ]; then
    mkdir -p "$base/NativeMessagingHosts"
    printf '%s\n' "$MANIFEST" > "$base/NativeMessagingHosts/$HOST.json"
    echo "  installed for $browser"
    installed=$((installed+1))
  fi
  # Remove the helper from before the rename (ClipStash), if present.
  rm -f "$base/NativeMessagingHosts/com.clipstash.helper.json"
done
rm -rf "$HOME/Library/Application Support/ClipStash"

echo "ClipSnatcher copy helper installed ($installed browser(s))."
echo "Open ClipSnatcher settings and click 'Check again'."
