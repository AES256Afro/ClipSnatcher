# ClipSnatcher copy helper (Windows). Chrome starts this, through clipsnatcher-helper.cmd,
# when you press "Copy" in ClipSnatcher. It reads one message from Chrome and can only do
# three things:
#   ping                -> reply with version
#   copyFile {path}     -> put that file on the clipboard (like Ctrl+C in File Explorer)
#   reveal   {path}     -> show that file in File Explorer
# It only accepts video files that exist on a drive of this computer. No network access,
# nothing is logged. Keep this file plain ASCII: Windows PowerShell 5.1 reads it as ANSI.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$VERSION = '1.0.0'
$VIDEO_EXT = '\.(mp4|m4v|mov|webm|mkv)$'

# Chrome's messages are a 4-byte length (little-endian) followed by that much UTF-8 JSON.
function Read-Exactly($stream, [int]$count) {
  $buf = New-Object byte[] $count
  $got = 0
  while ($got -lt $count) {
    $n = $stream.Read($buf, $got, $count - $got)
    if ($n -le 0) { return $null }
    $got += $n
  }
  return , $buf
}

function Read-Message {
  $stdin = [Console]::OpenStandardInput()
  $head = Read-Exactly $stdin 4
  if ($null -eq $head) { return $null }
  $len = [BitConverter]::ToInt32($head, 0)
  if ($len -le 0 -or $len -gt 1MB) { return $null }
  $body = Read-Exactly $stdin $len
  if ($null -eq $body) { return $null }
  return [Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
}

function Write-Message($obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

# Returns @{ error } or @{ path }: the full path of an existing video file.
function Test-VideoPath($p) {
  if ($p -isnot [string] -or $p.Length -gt 4096) { return @{ error = 'Bad path.' } }
  # A full path on a drive, like C:\Users\you\Downloads\clip.mp4. Network (\\server\...) and
  # device (\\?\...) paths are refused, and so are characters Windows doesn't allow in file
  # names, which also rules out alternate streams ("clip.mp4:other").
  if ($p -cnotmatch '^[A-Za-z]:\\[^<>:"/|?*\x00-\x1f\x7f]+$') { return @{ error = 'Bad path.' } }
  $full = [IO.Path]::GetFullPath($p)   # settles any "..", so the checks below see the real place
  if ($full -notmatch $VIDEO_EXT) { return @{ error = 'Only video files can be copied.' } }
  $dir = [IO.Path]::GetDirectoryName($full)
  $leaf = [IO.Path]::GetFileName($full)
  # Look the file up in its folder rather than trusting the name given: this returns the
  # file's real (long) name, so a short 8.3 name like CLIP~1.MP4 can't stand in for a file
  # that isn't a video.
  $found = @()
  if ($dir -and $leaf -and [IO.Directory]::Exists($dir)) {
    $found = @(Get-ChildItem -LiteralPath $dir -Filter $leaf -File -Force -ErrorAction SilentlyContinue)
  }
  if ($found.Count -ne 1) { return @{ error = 'File not found. It may have been moved or deleted.' } }
  $item = $found[0]
  if ($item.Name -notmatch $VIDEO_EXT) { return @{ error = 'Only video files can be copied.' } }
  # A link named "x.mp4" could point at some other kind of file. Chrome never saves links.
  if ($item.LinkType -eq 'SymbolicLink') { return @{ error = 'That file is a link to another file, so it isn''t copied.' } }
  return @{ path = $item.FullName }
}

function Invoke-Message($msg) {
  if ($msg -isnot [Management.Automation.PSCustomObject]) { return @{ ok = $false; error = 'Bad message.' } }
  if ($msg.action -ceq 'ping') { return @{ ok = $true; version = $VERSION } }
  $checked = Test-VideoPath $msg.path
  if ($checked.error) { return @{ ok = $false; error = $checked.error } }
  $path = $checked.path
  if ($msg.action -ceq 'copyFile') {
    Add-Type -AssemblyName System.Windows.Forms
    $files = New-Object System.Collections.Specialized.StringCollection
    [void]$files.Add($path)
    $data = New-Object System.Windows.Forms.DataObject
    $data.SetFileDropList($files)
    # Mark it as a copy, not a cut, the same as Ctrl+C in File Explorer.
    $data.SetData('Preferred DropEffect', (New-Object IO.MemoryStream (, [byte[]](5, 0, 0, 0))))
    try {
      # $true keeps it on the clipboard after this script ends. Another app may hold the
      # clipboard for a moment, so try for up to a second.
      [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
    } catch {
      return @{ ok = $false; error = 'Windows refused the clipboard write. Try again.' }
    }
    return @{ ok = $true }
  }
  if ($msg.action -ceq 'reveal') {
    # The path has no quotes in it (checked above), so it can't break out of this argument.
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList "/select,`"$path`""
    return @{ ok = $true }
  }
  return @{ ok = $false; error = 'Unknown action.' }
}

try { $reply = Invoke-Message (Read-Message) } catch { $reply = @{ ok = $false; error = [string]$_.Exception.Message } }
Write-Message $reply
