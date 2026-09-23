@echo off
rem Starts Lumacut with the local AI server on Windows.
rem First run creates .venv and installs PyTorch (the CUDA build if an NVIDIA GPU
rem is present); the AI models (~830 MB) download on first start.
setlocal
cd /d "%~dp0"

rem PyTorch has no builds for Windows on ARM (e.g. Snapdragon laptops).
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" goto arm
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" goto arm

if exist ".venv\Scripts\python.exe" goto run

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3.10 or newer is required: https://www.python.org/downloads/
  echo Tick "Add python.exe to PATH" during installation, then run start.bat again.
  pause
  exit /b 1
)
%PY% -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)"
if errorlevel 1 (
  echo Lumacut needs Python 3.10 to 3.13. Found:
  %PY% --version
  pause
  exit /b 1
)

echo Creating Python environment...
%PY% -m venv .venv || goto fail
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip || goto fail

where nvidia-smi >nul 2>nul
if %errorlevel%==0 (
  echo NVIDIA GPU found - installing the CUDA build of PyTorch...
  ".venv\Scripts\python.exe" -m pip install --quiet torch==2.14.0 torchvision==0.29.0 --index-url https://download.pytorch.org/whl/cu126 || goto fail
) else (
  echo No NVIDIA GPU found - installing the CPU build of PyTorch ^(slower^).
)
echo Installing the rest ^(this can take a few minutes^)...
".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt || goto fail

:run
".venv\Scripts\python.exe" server.py
exit /b %errorlevel%

:arm
echo This PC runs Windows on ARM, which the local AI models don't support yet.
echo Use the online demo instead: https://ihatesas.github.io/lumacut/
pause
exit /b 1

:fail
echo.
echo Setup failed. Delete the .venv folder and run start.bat again.
pause
exit /b 1
