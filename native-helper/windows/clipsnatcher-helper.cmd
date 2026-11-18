@echo off
rem ClipSnatcher copy helper (Windows). Chrome starts this file, which runs the PowerShell
rem script next to it. Installed by install.ps1; nothing else should need to run it.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Sta -ExecutionPolicy Bypass -File "%~dp0clipsnatcher-helper.ps1"
