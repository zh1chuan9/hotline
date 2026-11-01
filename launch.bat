@echo off
rem ============================================================
rem  Hotline 2.5D launcher
rem  double click      -> open Godot editor with this project
rem  launch.bat play   -> run the game directly
rem ============================================================
setlocal enabledelayedexpansion

set "GODOT="
for %%P in (
  "D:\Tools\Godot4.6.2\Godot_v4.6.2-stable_win64.exe"
  "D:\Tools\Godot4.6.2\Godot.exe"
  "D:\Tools\Godot\Godot_v4.6.2-stable_win64.exe"
  "C:\Program Files\Godot\Godot_v4.6.2-stable_win64.exe"
  "C:\Program Files\Godot\Godot.exe"
  "%LOCALAPPDATA%\Programs\Godot\Godot_v4.6.2-stable_win64.exe"
) do (
  if exist %%P if not defined GODOT set "GODOT=%%~P"
)

if not defined GODOT (
  echo.
  echo  [!] Godot 4.6 not found on this machine.
  echo.
  echo      Download the standard build ^(no .NET^) from:
  echo        https://godotengine.org/download/windows/
  echo      Unzip to:  D:\Tools\Godot4.6.2\
  echo      Then run this file again.
  echo.
  pause
  exit /b 1
)

echo  Using: %GODOT%
if /i "%~1"=="play" (
  start "" "%GODOT%" --path "%~dp0."
) else (
  start "" "%GODOT%" --path "%~dp0." --editor
)
endlocal
