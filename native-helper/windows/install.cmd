@echo off
rem Double-click to install the ClipSnatcher copy helper for the unpacked copy of the
rem extension. No admin rights needed. Any extension IDs given are passed on to install.ps1.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
