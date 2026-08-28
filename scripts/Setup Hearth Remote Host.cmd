@echo off
title Set up Hearth Remote host
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-hearth-host.ps1"
if errorlevel 1 (
  echo.
  echo Setup stopped with an error. Leave this window open and copy the message above.
)
echo.
pause
