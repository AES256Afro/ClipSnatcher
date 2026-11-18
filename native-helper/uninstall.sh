#!/bin/bash
# Removes the ClipStash copy helper.
HOST="com.clipstash.helper"
for browser in "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  rm -f "$HOME/Library/Application Support/$browser/NativeMessagingHosts/$HOST.json"
done
rm -rf "$HOME/Library/Application Support/ClipStash"
echo "ClipStash copy helper removed."
