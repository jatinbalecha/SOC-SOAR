@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\win\setup.ps1" %*
