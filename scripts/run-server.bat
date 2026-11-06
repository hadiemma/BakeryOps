@echo off
set PROJECT_DIR=C:\Users\hadis\.switch\agents\localhost-57168\bakeryops-codex
set LOG_DIR=%PROJECT_DIR%\logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set LOG_FILE=%LOG_DIR%\bakeryops.log

cd /d "%PROJECT_DIR%"
echo [%date% %time%] Starting BakeryOps Next.js dev server >> "%LOG_FILE%"
"C:\Users\hadis\.bun\bin\bun.exe" run dev >> "%LOG_FILE%" 2>&1
echo [%date% %time%] BakeryOps Next.js dev server exited >> "%LOG_FILE%"
