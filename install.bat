@echo off
rem Richtet den LoL Rank Tracker als unsichtbaren Autostart ein und startet ihn sofort.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo FEHLER: Node.js ist nicht installiert.
  echo Bitte von https://nodejs.org herunterladen und installieren, dann install.bat erneut ausfuehren.
  pause
  exit /b 1
)

set "SCRIPT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LoLRankTracker.vbs"
(
echo Set sh = CreateObject^("WScript.Shell"^)
echo sh.CurrentDirectory = "%~dp0"
echo sh.Run "node.exe server.js", 0, False
) > "%SCRIPT%"

wscript.exe "%SCRIPT%"

echo.
echo LoL Rank Tracker wurde installiert und laeuft jetzt unsichtbar im Hintergrund.
echo Er startet ab sofort automatisch mit Windows.
echo.
echo In OBS einbinden:  Quelle ^> Browser ^> URL: http://localhost:8090/  (Breite 650, Hoehe 140)
echo.
pause
