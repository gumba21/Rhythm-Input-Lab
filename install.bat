@echo off
title Install Rhythm Input Lab
cd /d "%~dp0"
echo Installing dependencies...
py -m pip install --upgrade -r requirements.txt
if errorlevel 1 (
  echo.
  echo Installation failed. Try: py -m pip install -r requirements.txt
  pause
  exit /b 1
)
echo.
echo Installation complete. Run run.bat.
pause
