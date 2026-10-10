@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or later is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

node server.mjs
if errorlevel 1 pause
