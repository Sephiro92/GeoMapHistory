# Prépare une livraison hors ligne : images Docker + docker-compose.yml + scripts, sans les sources.
# Usage : .\scripts\export-images.ps1 [-Version 0.2.0]   -> release\geomaphistory-<version>\
param([string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$utf8 = New-Object Text.UTF8Encoding $false

if (-not $Version) { $Version = (Get-Content -Raw -Encoding utf8 'backend\package.json' | ConvertFrom-Json).version }
$out = "release\geomaphistory-$Version"

Write-Host "Construction des images..."
docker compose build
if ($LASTEXITCODE) { throw 'docker compose build a échoué' }

# Les images gardent les noms du docker-compose.yml : le même fichier sert en ligne et hors ligne.
$config = docker compose config --format json | ConvertFrom-Json
$images = $config.services.PSObject.Properties.Value | ForEach-Object { $_.image } | Sort-Object -Unique
foreach ($img in $images) {
  docker image inspect $img *> $null
  if ($LASTEXITCODE) { docker pull $img; if ($LASTEXITCODE) { throw "Image introuvable : $img" } }
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\scripts" | Out-Null

Write-Host "Enregistrement de $($images -join ', ')..."
docker save -o "$out\images.tar" @images
if ($LASTEXITCODE) { throw 'docker save a échoué' }

# docker-compose.yml sans les lignes « build: » (les sources ne sont pas livrées).
$compose = [IO.File]::ReadAllText("$PWD\docker-compose.yml", $utf8) -replace '(?m)^[ \t]*build:.*\r?\n', ''
[IO.File]::WriteAllText("$PWD\$out\docker-compose.yml", $compose, $utf8)

Copy-Item 'scripts\init.ps1', 'scripts\init.sh', 'scripts\backup.ps1', 'scripts\restore.ps1' "$out\scripts"

$readme = @"
# GeoMapHistory $Version — livraison hors ligne

``````
images.tar            images Docker : $($images -join ', ')
docker-compose.yml    démarrage à partir de ces images
scripts/              initialisation, sauvegarde, restauration du contenu
``````

## Installation

1. Charger les images (une fois par version) : ``docker load -i images.tar``
2. Contenu : copier un dossier ``data/`` existant à côté de ``docker-compose.yml``, sinon une carte vierge est créée
   (sous Linux, lancer d'abord ``./scripts/init.sh``).
3. Démarrer : ``docker compose up -d``, puis ouvrir http://localhost:8080.

Compte admin : lu dans ``data/.env`` (``ADMIN_USERNAME``, ``ADMIN_PASSWORD``) ; s'il manque, il est généré au premier
démarrage et affiché par ``docker compose logs api``.

## Mettre à jour

``docker compose down``, remplacer ``images.tar``, ``docker-compose.yml`` et ``scripts/`` en gardant ``data/``,
puis ``docker load -i images.tar`` et ``docker compose up -d``.
"@
[IO.File]::WriteAllText("$PWD\$out\LISEZMOI.md", $readme, $utf8)

$size = [math]::Round((Get-Item "$out\images.tar").Length / 1MB)
Write-Host "Livraison prête : $out (images.tar : $size Mo)"
