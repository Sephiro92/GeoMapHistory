# Construit l'application et prépare un dossier de livraison autonome :
#   release\geomaphistory-<version>\
#     images.tar           images Docker (api, web, PostGIS) à charger avec « docker load »
#     docker-compose.yml   démarrage à partir de ces images, sans les sources
#     scripts\             initialisation, sauvegarde, restauration du contenu
#     LISEZMOI.md          mode d'emploi
# Le contenu (dossier data) n'est pas inclus : il se copie à part.
# Usage : .\scripts\export-images.ps1 [-Version 0.2.0]   (par défaut : version de backend\package.json)
param([string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not $Version) { $Version = (Get-Content 'backend\package.json' -Raw | ConvertFrom-Json).version }
$base = 'postgis/postgis:16-3.4'
$out = "release\geomaphistory-$Version"

Write-Host "Construction des images $Version…"
docker compose build
if ($LASTEXITCODE -ne 0) { throw 'La construction des images a échoué' }
# Les images sont construites sous le nom déclaré dans docker-compose.yml (ex. compte/geomaphistory-api) ;
# la livraison les renomme geomaphistory-<service>:<version>.
$services = (docker compose config --format json | ConvertFrom-Json).services
foreach ($service in 'api', 'web') {
  $built = $services.$service.image
  if (-not $built) { $built = "geomaphistory-$service" }
  docker tag $built "geomaphistory-${service}:$Version"
  if ($LASTEXITCODE -ne 0) { throw "Image $built introuvable" }
}
docker image inspect $base *> $null
if ($LASTEXITCODE -ne 0) { docker pull $base }

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\scripts" | Out-Null

Write-Host 'Export des images (quelques minutes)…'
docker save -o "$out\images.tar" "geomaphistory-api:$Version" "geomaphistory-web:$Version" $base
if ($LASTEXITCODE -ne 0) { throw 'docker save a échoué' }

$utf8 = New-Object Text.UTF8Encoding $false
foreach ($file in 'docker-compose.yml', 'LISEZMOI.md') {
  $text = [IO.File]::ReadAllText("$PWD\deploy\$file", $utf8).Replace('__VERSION__', $Version)
  [IO.File]::WriteAllText("$PWD\$out\$file", $text, $utf8)
}
Copy-Item 'scripts\init.ps1', 'scripts\init.sh', 'scripts\backup.ps1', 'scripts\restore.ps1' "$out\scripts"

$size = [math]::Round((Get-Item "$out\images.tar").Length / 1MB)
Write-Host "Livraison prête : $out (images.tar : $size Mo)"
