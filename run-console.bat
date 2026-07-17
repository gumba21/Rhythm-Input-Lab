@echo off
title Rhythm Input Lab Console
cd /d "%~dp0"
py console.py
if errorlevel 1 pause
