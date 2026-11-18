#!/bin/bash
# Removes the ClipSnatcher copy helper.
HOST="com.clipsnatcher.helper"
for browser in "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  rm -f "$HOME/Library/Application Support/$browser/NativeMessagingHosts/$HOST.json"
  rm -f "$HOME/Library/Application Support/$browser/NativeMessagingHosts/com.clipstash.helper.json"
done
rm -rf "$HOME/Library/Application Support/ClipSnatcher" "$HOME/Library/Application Support/ClipStash"
echo "ClipSnatcher copy helper removed."
