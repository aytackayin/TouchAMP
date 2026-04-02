@echo off
title EMERGENCY STOP - TouchAMP
color 4C
echo ===================================================
echo [!] WARNING: TERMINATING ALL BACKGROUND SERVICES
echo ===================================================
echo.
echo - Stopping Node.js processes...
taskkill /F /IM node.exe /T >nul 2>&1
echo.
echo - Stopping Apache (httpd.exe)...
taskkill /F /IM httpd.exe /T >nul 2>&1
echo.
echo - Stopping MySQL (mysqld.exe)...
taskkill /F /IM mysqld.exe /T >nul 2>&1
echo.
echo - Stopping Stuck PowerShell requests...
taskkill /F /IM powershell.exe /T >nul 2>&1
echo.
echo ===================================================
echo [OK] ALL PROCESSES SUCCESSFULLY STOPPED!
echo ===================================================
echo This window will close in 3 seconds...
timeout /t 3 >nul
