@echo off
title Preview Hearth Remote first-run setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0preview-first-run.ps1"
if errorlevel 1 (
  echo.
  echo Preview stopped with an error. Copy the message above when reporting it.
)
echo.
pause
