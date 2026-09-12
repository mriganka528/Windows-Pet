@echo off
cd /d "%~dp0"
echo Opening the Nudge product website server.
echo Visit http://127.0.0.1:4176 in your browser.
echo Press Ctrl+C in this window to stop the server.
call npm.cmd run dev
pause
