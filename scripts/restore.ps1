# Remplace le dossier de données par une archive créée par backup.ps1.
# L'ancien dossier est conservé à côté (data.avant-restauration-<date>).
# Usage : .\scripts\restore.ps1 backups\geomap-data-2026-10-31_120000.zip   (-Force : sans confirmation)
param([Parameter(Mandatory = $true)][string]$Archive, [switch]$Force)
$ErrorActionPreference = 'Stop'
$Archive = (Resolve-Path $Archive).Path
Set-Location (Join-Path $PSScriptRoot '..')

if (-not $Force) {
  $answer = Read-Host "Le contenu actuel sera remplacé par $Archive. Taper 'oui' pour continuer"
  if ($answer -ne 'oui') { Write-Host 'Annulé.'; exit 1 }
}

docker compose stop api
if (Test-Path 'data') { Rename-Item 'data' "data.avant-restauration-$(Get-Date -Format 'yyyy-MM-dd_HHmmss')" }
Expand-Archive -Path $Archive -DestinationPath 'data'
docker compose start api
Write-Host 'Restauration terminée (la base est reconstruite depuis data au démarrage).'
