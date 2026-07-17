@echo off
title Install Rhythm Input Lab 4.2
cd /d "%~dp0"
echo Installing the global keyboard listener dependency...
py -m pip install --upgrade pynput
if errorlevel 1 (
  echo.
  echo Installation failed. Try: py -m pip install pynput
  pause
  exit /b 1
)
echo.
echo Installation complete.
echo Run "Rhythm Input Lab 4.bat".
pause
