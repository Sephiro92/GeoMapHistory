# Archive le dossier de données (tout le contenu + compte admin) dans backups\.
# Usage : .\scripts\backup.ps1     -> backups\geomap-data-AAAA-MM-JJ_HHMMSS.zip
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Test-Path 'data')) { throw 'Dossier data introuvable' }

New-Item -ItemType Directory -Force 'backups' | Out-Null
$target = "backups\geomap-data-$(Get-Date -Format 'yyyy-MM-dd_HHmmss').zip"
# Les fichiers sont écrits de façon atomique : l'archive peut se faire application démarrée.
# Entrées nommées avec « / » (Compress-Archive met des « \ », illisibles sous Linux et macOS).
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = (Resolve-Path 'data').Path
$zip = [IO.Compression.ZipFile]::Open((Join-Path $PWD $target), 'Create')
try {
  Get-ChildItem -Recurse -File -Force $root | Where-Object Extension -ne '.tmp' | ForEach-Object {
    $name = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    # Les sauvegardes automatiques et les dossiers de travail de l'import ne sont pas du contenu.
    if ($name -like 'backups/*' -or $name -like '.import*') { return }
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name)
  }
} finally {
  $zip.Dispose()
}
Write-Host "Sauvegarde créée : $target"
