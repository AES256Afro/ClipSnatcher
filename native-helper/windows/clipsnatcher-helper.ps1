# ClipSnatcher copy helper (Windows). Chrome starts this, through clipsnatcher-helper.cmd,
# when you press "Copy" in ClipSnatcher. It reads one message from Chrome and can only do
# three things:
#   ping                -> reply with version
#   copyFile {path}     -> put that file on the clipboard (like Ctrl+C in File Explorer)
#   reveal   {path}     -> show that file in File Explorer
# It only accepts video files that exist on a drive of this computer. Links are followed to
# the real file first, and the checks apply to that. No network access, nothing is logged.
# Any folder is accepted, not only Downloads: Chrome's download location can be changed to
# anywhere, and only the extension IDs named at install time can call this helper.
# Keep this file plain ASCII: Windows PowerShell 5.1 reads it as ANSI.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$VERSION = '1.1.0'
$VIDEO_EXT = '\.(mp4|m4v|mov|webm|mkv)$'
# A full path on a drive, like C:\Users\you\Downloads\clip.mp4. Network (\\server\...) and
# device (\\?\...) paths don't match, and nor do characters Windows doesn't allow in file
# names, which also rules out alternate streams ("clip.mp4:other").
$DRIVE_PATH = '^[A-Za-z]:\\[^<>:"/|?*\x00-\x1f\x7f]+$'
$NOT_FOUND = 'File not found. It may have been moved or deleted.'

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

# Returns @{ error } or @{ path }: $p with every link along it (a symbolic link or a
# junction, whether the file itself or a folder on the way) replaced by what it points to,
# like the macOS helper. Each new path is checked before anything in it is looked at, so a
# link that points at another computer is refused without contacting it. The path is
# returned as far as it could be followed; whether the file exists is checked afterwards.
function Resolve-Links([string]$p) {
  for ($hops = 0; $hops -lt 32; $hops++) {
    if ($p -cnotmatch $DRIVE_PATH) { return @{ error = 'Bad path.' } }
    $p = [IO.Path]::GetFullPath($p)   # settles any "..", so the checks see the real place
    $parts = @($p.Substring(3).Split([char]'\') | Where-Object { $_ })
    $cur = $p.Substring(0, 3)         # the drive, like C:\
    $next = $null
    for ($i = 0; $i -lt $parts.Count; $i++) {
      $parent = $cur
      $cur = [IO.Path]::Combine($cur, $parts[$i])
      $item = Get-Item -LiteralPath $cur -Force -ErrorAction SilentlyContinue
      if ($null -eq $item) { return @{ path = $p } }
      if ($item.LinkType -ne 'SymbolicLink' -and $item.LinkType -ne 'Junction') { continue }
      $target = [string](@($item.Target)[0])
      # A folder where another disk is mounted is part of this computer, not a link to follow.
      if ($target -match '^Volume\{') { continue }
      if (-not $target) { return @{ error = $NOT_FOUND } }
      if ($target -match '^UNC\\') { return @{ error = 'Bad path.' } }   # \??\UNC\server\...
      if ($target -match '^([A-Za-z]:\\|\\\\)') { $next = $target }      # a full path
      elseif ($target.StartsWith('\')) { $next = $p.Substring(0, 2) + $target }   # from this drive's root
      else { $next = $parent.TrimEnd('\') + '\' + $target }             # beside the link
      if ($i + 1 -lt $parts.Count) { $next = $next.TrimEnd('\') + '\' + ($parts[($i + 1)..($parts.Count - 1)] -join '\') }
      break
    }
    if ($null -eq $next) { return @{ path = $p } }
    $p = $next
  }
  return @{ error = $NOT_FOUND }   # links that go round in a circle
}

# Returns @{ error } or @{ path }: the real full path of an existing video file.
function Test-VideoPath($p) {
  if ($p -isnot [string] -or $p.Length -gt 4096) { return @{ error = 'Bad path.' } }
  $real = Resolve-Links $p
  if ($real.error) { return $real }
  $full = $real.path
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
  if ($found.Count -ne 1) { return @{ error = $NOT_FOUND } }
  $item = $found[0]
  if ($item.Name -notmatch $VIDEO_EXT) { return @{ error = 'Only video files can be copied.' } }
  # Links were followed above, so a link here points nowhere (or was put there just now).
  if ($item.LinkType -eq 'SymbolicLink' -or $item.LinkType -eq 'Junction') { return @{ error = $NOT_FOUND } }
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
