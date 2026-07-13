# Aktualisiert den LoL Rank Tracker auf die neueste GitHub-Version.
# Einstellungen (config.json) und Statistiken (state.json) bleiben erhalten.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Lade neueste Version von GitHub..."
$zip = Join-Path $env:TEMP "loltracker-update.zip"
Invoke-WebRequest -Uri "https://codeload.github.com/zadoosttv-maker/loltracker/zip/refs/heads/main" -OutFile $zip -UseBasicParsing

$dest = Join-Path $env:TEMP "loltracker-update"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Expand-Archive $zip $dest -Force
$src = (Get-ChildItem $dest -Directory | Select-Object -First 1).FullName

Write-Host "Beende Tracker..."
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 1

Write-Host "Kopiere neue Dateien (config.json und state.json bleiben unberuehrt)..."
Get-ChildItem $src -File |
  Where-Object { $_.Name -ne "config.json" } |
  ForEach-Object { Copy-Item $_.FullName -Destination $root -Force }

Write-Host "Starte Tracker neu..."
Start-Process wscript.exe -ArgumentList "`"$root\start-hidden.vbs`""

Remove-Item $zip -Force
Remove-Item $dest -Recurse -Force
Write-Host ""
Write-Host "Update abgeschlossen!"
