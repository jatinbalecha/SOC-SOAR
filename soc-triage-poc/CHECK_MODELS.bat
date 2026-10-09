@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\win\check_models.ps1" %*
