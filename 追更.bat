@echo off
rem Fanqie Novel - check every ongoing book for new chapters
cd /d "%~dp0"

set "NODE_EXE=%~dp0node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"

if not exist logs mkdir logs
"%NODE_EXE%" "%~dp0fanqie.mjs" update > "logs\update.log" 2>&1
"%NODE_EXE%" "%~dp0fanqie.mjs" shelf >nul 2>&1
exit /b