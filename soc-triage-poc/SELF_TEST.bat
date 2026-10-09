@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\win\self_test.ps1" %*
