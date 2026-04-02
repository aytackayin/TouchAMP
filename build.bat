@echo off
:: Çalışan .bat dosyasının bulunduğu dizine geç (Admin yetkisiyle açılınca System32'de başlamaması için)
cd /d "%~dp0"

echo =======================================
echo    TouchAMP Portable Build Script
echo =======================================
echo.
echo Starting build-custom.js...
node build-custom.js
echo.
pause
