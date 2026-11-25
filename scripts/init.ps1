# Facultatif sous Windows : crée le dossier de données vide (l'API le crée aussi au démarrage).
# Le compte admin est généré au premier démarrage s'il n'existe pas : voir « docker compose logs api ».
# Usage : .\scripts\init.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

foreach ($dir in 'data\map', 'data\wiki', 'data\uploads') { New-Item -ItemType Directory -Force $dir | Out-Null }
Write-Host 'Dossier data prêt. Lancez : docker compose up -d   (ajoutez --build si vous partez des sources)'
