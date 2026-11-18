#!/bin/bash
# Installs the ClipSnatcher copy helper for Chrome (and Brave/Edge/Chromium if present).
# Only writes inside your home folder. Undo with: bash uninstall.sh
set -euo pipefail

DEV_ID="phdbcmaifcaagmfkmbdhokgmkldllajj"   # the unpacked copy: fixed by the "key" in extension/manifest.json
HOST="com.clipsnatcher.helper"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/ClipSnatcher"

mkdir -p "$DEST"
cp "$HERE/clipsnatcher-helper.js" "$DEST/clipsnatcher-helper.js"
chmod 755 "$DEST/clipsnatcher-helper.js"
xattr -d com.apple.quarantine "$DEST/clipsnatcher-helper.js" 2>/dev/null || true

# Which copies of the extension may use the helper.
#   bash install.sh                  the unpacked copy loaded from this folder
#   bash install.sh <id> [<id>...]   only the copies with these IDs, e.g. the Chrome Web
#                                    Store copy (its Settings page shows the exact command)
# Anyone can load an unpacked extension that carries this project's public key, so the
# development ID is only allowed when you ask for it by passing no IDs.
if [ "$#" -eq 0 ]; then set -- "$DEV_ID"; fi
ORIGINS=""
for id in "$@"; do
  if [[ ! "$id" =~ ^[a-p]{32}$ ]]; then
    echo "Not a Chrome extension ID (expected 32 letters a-p): $id" >&2
    exit 1
  fi
  ORIGINS="${ORIGINS:+$ORIGINS, }\"chrome-extension://$id/\""
done

MANIFEST=$(cat <<JSON
{
  "name": "$HOST",
  "description": "ClipSnatcher copy helper: puts a saved video file on the clipboard",
  "path": "$DEST/clipsnatcher-helper.js",
  "type": "stdio",
  "allowed_origins": [$ORIGINS]
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
# Only our own old file: a "ClipStash" folder could belong to a different app.
rm -f "$HOME/Library/Application Support/ClipStash/clipstash-helper.js"
rmdir "$HOME/Library/Application Support/ClipStash" 2>/dev/null || true

echo "ClipSnatcher copy helper installed ($installed browser(s))."
echo "Open ClipSnatcher settings and click 'Check again'."
