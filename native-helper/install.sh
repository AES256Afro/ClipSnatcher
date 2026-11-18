#!/bin/bash
# Installs the ClipStash copy helper for Chrome (and Brave/Edge/Chromium if present).
# Only writes inside your home folder. Undo with: bash uninstall.sh
set -euo pipefail

EXT_ID="phdbcmaifcaagmfkmbdhokgmkldllajj"   # fixed by the "key" in extension/manifest.json
HOST="com.clipstash.helper"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/ClipStash"

mkdir -p "$DEST"
cp "$HERE/clipstash-helper.js" "$DEST/clipstash-helper.js"
chmod 755 "$DEST/clipstash-helper.js"
xattr -d com.apple.quarantine "$DEST/clipstash-helper.js" 2>/dev/null || true

MANIFEST=$(cat <<JSON
{
  "name": "$HOST",
  "description": "ClipStash copy helper: puts a saved video file on the clipboard",
  "path": "$DEST/clipstash-helper.js",
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
done

echo "ClipStash copy helper installed ($installed browser(s))."
echo "Open ClipStash settings and click 'Check again'."
