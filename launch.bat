@echo off
setlocal
rem Double-click to open the Retro Hub control panel (start/stop, settings, apps, files, admin console).
rem With options it runs the console launcher instead, e.g.  launch.bat --tunnel   or   launch.bat --port 8081
cd /d "%~dp0"

rem Python and Node.js are needed before anything else runs. If either is missing, setup\deps.ps1 asks,
rem downloads it from the official site, checks it (checksum, signature, Defender) and installs it.
call :findpy
set "NEED="
set "NONODE="
if not defined PY set "NEED=python"
node --version >nul 2>nul || set "NONODE=1"
if defined NONODE if defined NEED set "NEED=%NEED%,node"
if defined NONODE if not defined NEED set "NEED=node"

if defined NEED (
  echo Retro Hub needs programs that aren't installed: %NEED%
  echo It can download them from their official sites, check each download ^(checksum, publisher
  echo signature, Microsoft Defender scan^) and install them. You'll be asked about each one.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\deps.ps1" -Need %NEED%
  rem Pick up the PATH the installers just changed, without needing a new window.
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
  call :findpy
)
if not defined PY (
  echo Python 3.8 or newer is still not installed, so Retro Hub can't start.
  echo Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then double-click this again.
  echo If a "python" command opens the Microsoft Store, that is only a shortcut, not Python itself.
  pause
  exit /b 1
)
node --version >nul 2>nul || (
  echo Node.js is still not installed, so the hub server can't run. Get the LTS from https://nodejs.org
  pause
  exit /b 1
)

if not "%~1"=="" goto console
%PY% -c "import tkinter" >nul 2>nul || (
  echo This Python has no window support ^(tkinter^). Starting the console launcher instead.
  goto console
)

rem pythonw shows the panel without a black console window behind it.
set "PYW="
for /f "usebackq delims=" %%i in (`%PY% -c "import sys, os; p = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe'); print(p if os.path.isfile(p) else '')"`) do set "PYW=%%i"
if defined PYW (
  start "" "%PYW%" "%~dp0RetroHub.pyw"
  exit /b 0
)
%PY% RetroHub.pyw
if errorlevel 1 pause
exit /b

:console
%PY% launch.py %*
pause
exit /b

rem Find a Python that really runs. "where python" is not enough: Windows has Microsoft Store
rem shortcuts named python.exe / py.exe that exist even when Python is not installed.
:findpy
set "PY="
py -3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>nul && set "PY=python"
if not defined PY python3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>nul && set "PY=python3"
exit /b 0
