@echo off
setlocal EnableExtensions EnableDelayedExpansion
title FEDDA AI Studio - One-Click Installer (Lite)

set "REPO_URL=https://github.com/Feddakalkun/Fedda_hub-v7"
set "REPO_BRANCH=main"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "INSTALL_DIR=%ROOT%\comfyuifeddafront-lite"
set "LOG_DIR=%ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\oneclick_setup.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul

echo. > "%LOG_FILE%"
echo [%date% %time%] FEDDA One-Click installer start >> "%LOG_FILE%"

echo.
echo  ==============================================================
echo   FEDDA AI Studio ^| One-Click Installer (LITE)
echo  ==============================================================
echo.
echo   This installer intentionally skips FULL mode for stability.
echo   It installs the tested LITE stack only.
echo.
echo   REQUIREMENTS:
echo    - Git
echo    - Node.js 18+
echo    - npm
echo    - NVIDIA GPU (for Comfy workflows)
echo.
echo   Install target:
echo    %INSTALL_DIR%
echo.
echo   Press any key to continue or close this window to cancel.
pause >nul

where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [ERROR] Git not found.
  echo  Install Git: https://git-scm.com/downloads
  echo [%date% %time%] ERROR: git missing >> "%LOG_FILE%"
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js not found.
  echo  Install Node.js LTS: https://nodejs.org/
  echo [%date% %time%] ERROR: node missing >> "%LOG_FILE%"
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [ERROR] npm not found.
  echo  Reinstall Node.js LTS so npm is included.
  echo [%date% %time%] ERROR: npm missing >> "%LOG_FILE%"
  pause
  exit /b 1
)

echo  [OK] Tool checks passed.
echo [%date% %time%] Tool checks passed >> "%LOG_FILE%"

if exist "%INSTALL_DIR%\.git" (
  echo.
  echo  [INFO] Existing LITE install detected. Updating repo...
  pushd "%INSTALL_DIR%"

  for /f "delims=" %%r in ('git remote get-url origin 2^>nul') do set "ORIGIN_URL=%%r"
  if /I not "!ORIGIN_URL!"=="%REPO_URL%" (
    echo.
    echo  [ERROR] Existing folder points to another repo:
    echo          !ORIGIN_URL!
    echo          expected: %REPO_URL%
    echo [%date% %time%] ERROR: remote mismatch !ORIGIN_URL! >> "%LOG_FILE%"
    popd
    pause
    exit /b 1
  )

  for /f %%s in ('git status --porcelain ^| find /c /v ""') do set "DIRTY=%%s"
  if not "!DIRTY!"=="0" (
    echo.
    echo  [ERROR] Existing install has local changes.
    echo  To protect your edits, auto-pull is blocked.
    echo  Commit or stash first, then run again.
    echo [%date% %time%] ERROR: dirty working tree >> "%LOG_FILE%"
    popd
    pause
    exit /b 1
  )

  git fetch origin %REPO_BRANCH% >> "%LOG_FILE%" 2>&1
  if errorlevel 1 (
    echo.
    echo  [ERROR] git fetch failed.
    echo [%date% %time%] ERROR: git fetch failed >> "%LOG_FILE%"
    popd
    pause
    exit /b 1
  )

  git checkout %REPO_BRANCH% >> "%LOG_FILE%" 2>&1
  git pull --ff-only origin %REPO_BRANCH% >> "%LOG_FILE%" 2>&1
  if errorlevel 1 (
    echo.
    echo  [ERROR] git pull failed (non fast-forward or network issue).
    echo [%date% %time%] ERROR: git pull failed >> "%LOG_FILE%"
    popd
    pause
    exit /b 1
  )

  popd
) else (
  echo.
  echo  [INFO] Cloning FEDDA repo...
  git clone --branch %REPO_BRANCH% %REPO_URL% "%INSTALL_DIR%" >> "%LOG_FILE%" 2>&1
  if errorlevel 1 (
    echo.
    echo  [ERROR] Clone failed.
    echo  Check internet/GitHub access and try again.
    echo [%date% %time%] ERROR: clone failed >> "%LOG_FILE%"
    pause
    exit /b 1
  )
)

if not exist "%INSTALL_DIR%\install.bat" (
  echo.
  echo  [ERROR] install.bat not found in install directory.
  echo [%date% %time%] ERROR: install.bat missing >> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo  [INFO] Running LITE installer...
echo [%date% %time%] Running install.bat LITE >> "%LOG_FILE%"

pushd "%INSTALL_DIR%"
call install.bat LITE
set "INSTALL_EXIT=%ERRORLEVEL%"
popd

if not "%INSTALL_EXIT%"=="0" (
  echo.
  echo  [ERROR] Installation failed with code %INSTALL_EXIT%.
  echo  Check log files in:
  echo    %INSTALL_DIR%\logs\
  echo [%date% %time%] ERROR: install failed code %INSTALL_EXIT% >> "%LOG_FILE%"
  pause
  exit /b %INSTALL_EXIT%
)

echo.
echo  ==============================================================
echo   FEDDA AI Studio installed successfully (LITE)
echo  ==============================================================
echo.
echo   Start app:
echo    %INSTALL_DIR%\run.bat
echo.
echo   Update later:
echo    %ROOT%\FEDDA_Update-v7.bat
echo.
echo [%date% %time%] SUCCESS >> "%LOG_FILE%"
pause
exit /b 0
