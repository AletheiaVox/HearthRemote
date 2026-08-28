@echo off
title Hearth Remote Doctor
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0hearth-remote-doctor.ps1"
echo.
pause
