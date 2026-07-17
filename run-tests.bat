@echo off
title Rhythm Input Lab Tests
cd /d "%~dp0"
py self_test.py
if errorlevel 1 (
  echo.
  echo Tests failed.
)
pause
