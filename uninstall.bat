@echo off
rem Beendet den LoL Rank Tracker und entfernt den Autostart.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LoLRankTracker.vbs" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo LoL Rank Tracker wurde beendet und aus dem Autostart entfernt.
pause
