#!/bin/bash
# Builds the copy helper downloads attached to each GitHub release:
#   dist/clipsnatcher-helper-macos.zip    the macOS helper and its install/uninstall scripts
#   dist/clipsnatcher-helper-windows.zip  the same for Windows
# The files sit at the top of each zip, so unzipping in Finder, or "Extract All" in File
# Explorer, gives a folder named after the zip, which is the path Settings' command uses.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
WORK="$OUT/helper-build"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/extension/manifest.json" | head -1)
rm -rf "$WORK"
mkdir -p "$WORK/macos" "$WORK/windows"

cp "$ROOT/native-helper/clipsnatcher-helper.js" "$ROOT/native-helper/install.sh" "$ROOT/native-helper/uninstall.sh" "$WORK/macos/"
chmod 755 "$WORK/macos/"*.sh "$WORK/macos/clipsnatcher-helper.js"
cat > "$WORK/macos/README.txt" <<EOF
ClipSnatcher copy helper for macOS (from ClipSnatcher $VERSION)

It lets ClipSnatcher put a saved video on the clipboard, ready to paste into Discord.

To install, open ClipSnatcher's Settings and follow "Copy helper": it shows the exact
command for your copy of ClipSnatcher, which you paste into Terminal. It looks like:

  bash ~/Downloads/clipsnatcher-helper-macos/install.sh <your extension ID>

No admin password is needed. It only writes inside your home folder.
To remove it:  bash ~/Downloads/clipsnatcher-helper-macos/uninstall.sh

Source and details: https://github.com/AES256Afro/ClipSnatcher
EOF

for f in clipsnatcher-helper.ps1 clipsnatcher-helper.cmd install.ps1 install.cmd uninstall.ps1 uninstall.cmd; do
  cp "$ROOT/native-helper/windows/$f" "$WORK/windows/"
done
# Windows tools expect Windows line endings; Notepad copes either way, the scripts may not.
printf '%s\r\n' \
  "ClipSnatcher copy helper for Windows (from ClipSnatcher $VERSION)" \
  "" \
  "It lets ClipSnatcher put a saved video on the clipboard, ready to paste into Discord." \
  "" \
  "To install, open ClipSnatcher's Settings and follow \"Copy helper\": it shows the exact" \
  "command for your copy of ClipSnatcher, which you paste into PowerShell. It looks like:" \
  "" \
  "  powershell -ExecutionPolicy Bypass -File \"\$HOME\\Downloads\\clipsnatcher-helper-windows\\install.ps1\" <your extension ID>" \
  "" \
  "No admin rights are needed. It only writes to your user profile and HKEY_CURRENT_USER." \
  "It works for Chrome, Edge and Brave. To remove it, double-click uninstall.cmd." \
  "" \
  "Source and details: https://github.com/AES256Afro/ClipSnatcher" > "$WORK/windows/README.txt"

# The .cmd and .ps1 files must keep Windows line endings whatever the checkout used.
for f in "$WORK/windows/"*.cmd "$WORK/windows/"*.ps1; do
  if ! grep -q $'\r$' "$f"; then sed -i.bak 's/$/\r/' "$f" && rm "$f.bak"; fi
done

for os in macos windows; do
  zip="$OUT/clipsnatcher-helper-$os.zip"
  rm -f "$zip"
  (cd "$WORK/$os" && zip -q -X "$zip" ./*)
  echo "Built $zip ($(unzip -l "$zip" | tail -1 | awk '{print $2}') files)"
done
rm -rf "$WORK"
