# Installs the ClipSnatcher copy helper on Windows for Chrome (and Edge, Brave and Chromium
# if present). Only writes inside your user profile (%LOCALAPPDATA%\ClipSnatcher) and your own
# part of the registry (HKEY_CURRENT_USER), so no admin rights are needed.
# Undo with uninstall.ps1 (or double-click uninstall.cmd).
#
# Which copies of the extension may use the helper:
#   install.ps1                  the unpacked copy loaded from this project
#   install.ps1 <id> [<id>...]   only the copies with these IDs, e.g. the Chrome Web Store
#                                copy (its Settings page shows the exact command)
# Anyone can load an unpacked extension that carries this project's public key, so the
# development ID is only allowed when you ask for it by passing no IDs.
#
# Run it from PowerShell like this (the execution policy flag lets this one script run):
#   powershell -ExecutionPolicy Bypass -File install.ps1 [<id> ...]

$ErrorActionPreference = 'Stop'

$DEV_ID = 'phdbcmaifcaagmfkmbdhokgmkldllajj'   # fixed by the "key" in extension/manifest.json
$HOST_NAME = 'com.clipsnatcher.helper'
$DEST = Join-Path $env:LOCALAPPDATA 'ClipSnatcher'
# Where each browser looks for native messaging helpers, under HKEY_CURRENT_USER.
$BROWSERS = [ordered]@{
  'Chrome'   = 'Software\Google\Chrome'
  'Edge'     = 'Software\Microsoft\Edge'
  'Brave'    = 'Software\BraveSoftware\Brave-Browser'
  'Chromium' = 'Software\Chromium'
}

$ids = @($args)
if ($ids.Count -eq 0) { $ids = @($DEV_ID) }
foreach ($id in $ids) {
  if ($id -cnotmatch '^[a-p]{32}$') {
    [Console]::Error.WriteLine("Not a Chrome extension ID (expected 32 letters a-p): $id")
    exit 1
  }
}

[void](New-Item -ItemType Directory -Force -Path $DEST)
foreach ($f in 'clipsnatcher-helper.ps1', 'clipsnatcher-helper.cmd') {
  $to = Join-Path $DEST $f
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $to -Force
  # A project downloaded as a zip marks every file as "from the internet". These two are
  # now yours, and Windows would otherwise warn about them.
  Unblock-File -LiteralPath $to
}

$manifestPath = Join-Path $DEST "$HOST_NAME.json"
$manifest = [ordered]@{
  name            = $HOST_NAME
  description     = 'ClipSnatcher copy helper: puts a saved video file on the clipboard'
  path            = (Join-Path $DEST 'clipsnatcher-helper.cmd')
  type            = 'stdio'
  allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
}
# Chrome wants plain UTF-8 here, without the byte-order mark PowerShell 5.1 adds by default.
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

$installed = 0
foreach ($name in $BROWSERS.Keys) {
  $base = $BROWSERS[$name]
  if ($name -ne 'Chrome' -and -not (Test-Path "HKCU:\$base")) { continue }
  # The key's default value names the manifest file. CreateSubKey keeps anything else there.
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$base\NativeMessagingHosts\$HOST_NAME")
  $key.SetValue('', $manifestPath)
  $key.Close()
  Write-Output "  installed for $name"
  $installed++
}

Write-Output "ClipSnatcher copy helper installed ($installed browser(s))."
Write-Output "Open ClipSnatcher settings and click 'Check again'."
