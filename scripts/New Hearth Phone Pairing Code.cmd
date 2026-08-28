@echo off
title New Hearth Phone Pairing Code
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0new-hearth-pairing-code.ps1"
if errorlevel 1 echo Pairing code creation failed. Copy the message above when asking for help.
echo.
pause
