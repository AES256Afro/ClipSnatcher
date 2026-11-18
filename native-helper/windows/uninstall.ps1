# Removes the ClipSnatcher copy helper from Windows. Only deletes what install.ps1 added:
# one registry key per browser under HKEY_CURRENT_USER and three files in
# %LOCALAPPDATA%\ClipSnatcher.
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1

$ErrorActionPreference = 'Stop'

$HOST_NAME = 'com.clipsnatcher.helper'
$DEST = Join-Path $env:LOCALAPPDATA 'ClipSnatcher'
$BROWSERS = 'Software\Google\Chrome', 'Software\Microsoft\Edge', 'Software\BraveSoftware\Brave-Browser', 'Software\Chromium'

foreach ($base in $BROWSERS) {
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey("$base\NativeMessagingHosts\$HOST_NAME", $false)
}

foreach ($f in 'clipsnatcher-helper.ps1', 'clipsnatcher-helper.cmd', "$HOST_NAME.json") {
  Remove-Item -LiteralPath (Join-Path $DEST $f) -Force -ErrorAction SilentlyContinue
}
# Only remove the folder if nothing else is in it.
if ((Test-Path -LiteralPath $DEST) -and -not (Get-ChildItem -LiteralPath $DEST -Force)) {
  Remove-Item -LiteralPath $DEST -Force
}

Write-Output 'ClipSnatcher copy helper removed.'
