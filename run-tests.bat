@echo off
title Rhythm Input Lab Tests
cd /d "%~dp0"

py self_test.py
if errorlevel 1 goto :failed

py ril_package_self_test.py
if errorlevel 1 goto :failed

py osu_importer_self_test.py
if errorlevel 1 goto :failed

echo.
echo All Rhythm Input Lab tests passed.
pause
exit /b 0

:failed
echo.
echo Tests failed.
pause
exit /b 1
