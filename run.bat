@echo off
title Rhythm Input Lab
cd /d "%~dp0"
py app.py
if errorlevel 1 (
  echo.
  echo Rhythm Input Lab closed with an error.
  pause
)
