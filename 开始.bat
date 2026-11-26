@echo off
rem Fanqie Novel - launch the desktop app
cd /d "%~dp0"

set "NODE_EXE=%~dp0node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"

start "" /min "%NODE_EXE%" "%~dp0server.mjs"
exit /b