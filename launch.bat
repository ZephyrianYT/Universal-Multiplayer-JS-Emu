@echo off
rem Double-click to start Retro Hub on this computer.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 launch.py %* & goto :end)
where python >nul 2>nul && (python launch.py %* & goto :end)
echo Python 3 was not found. Install it from https://www.python.org/downloads/ and try again.
:end
pause
