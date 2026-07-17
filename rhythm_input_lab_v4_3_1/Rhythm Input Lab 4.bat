@echo off
title Rhythm Input Lab 4.3.2
cd /d "%~dp0"
py rhythm_input_lab_v4.py
if errorlevel 1 (
  echo.
  echo Rhythm Input Lab closed with an error.
  pause
)
