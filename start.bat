@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo       TouchAMP PORTABLE SERVER
echo ==========================================
echo [*] Checking environment...

:: Check Node
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found! Please install it.
    pause
    exit /b 1
)

:: Check Node Modules
if not exist "node_modules" (
    echo [*] Dependencies missing, installing...
    call npm install
)

echo [*] Starting system...
echo [*] Please keep this window open.
echo.

:: Start Node
node server.js

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Server stopped unexpectedly.
    echo Error Code: %ERRORLEVEL%
)

echo.
echo Press any key to close this window...
pause >nul
