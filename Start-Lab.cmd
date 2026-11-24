@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 from https://nodejs.org/ and run this launcher again.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  call npm.cmd ci
  if errorlevel 1 exit /b 1
  call npm.cmd run build
  if errorlevel 1 exit /b 1
)
node scripts\serve.mjs --open
if errorlevel 1 pause
