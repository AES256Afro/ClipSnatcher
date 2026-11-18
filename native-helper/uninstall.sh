#!/bin/bash
# Removes the ClipSnatcher copy helper. Only deletes files this project installed.
set -eu

HOST="com.clipsnatcher.helper"
SUPPORT="$HOME/Library/Application Support"

for browser in "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  rm -f "$SUPPORT/$browser/NativeMessagingHosts/$HOST.json"
  rm -f "$SUPPORT/$browser/NativeMessagingHosts/com.clipstash.helper.json"   # name before the rename
done

rm -f "$SUPPORT/ClipSnatcher/clipsnatcher-helper.js"
rmdir "$SUPPORT/ClipSnatcher" 2>/dev/null || true
# Old name: remove only our file, since a "ClipStash" folder could belong to a different app.
rm -f "$SUPPORT/ClipStash/clipstash-helper.js"
rmdir "$SUPPORT/ClipStash" 2>/dev/null || true

echo "ClipSnatcher copy helper removed."
