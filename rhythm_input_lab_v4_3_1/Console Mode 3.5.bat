@echo off
title Rhythm Input Lab Console Fallback
cd /d "%~dp0"
py rhythm_input_lab_core.py
if errorlevel 1 pause
