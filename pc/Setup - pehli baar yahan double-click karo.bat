@echo off
title Da Vinci Scanner setup
echo.
echo   Da Vinci Scanner setup ho raha hai...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\install.ps1"
if errorlevel 1 (
  echo.
  echo   Setup mein masla aaya. Upar wala error message Claude ko bhej do.
  pause
)
