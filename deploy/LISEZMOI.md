# GeoMapHistory __VERSION__ — livraison

Ce dossier contient tout ce qu'il faut pour faire tourner GeoMapHistory avec Docker, sans les sources :

```
images.tar            images Docker de l'application (api, web) et de la base (PostGIS)
docker-compose.yml    démarrage à partir de ces images
scripts/              initialisation, sauvegarde, restauration du contenu
```

Le contenu de la carte n'est pas inclus : il vit dans un dossier `data/` à placer à côté de `docker-compose.yml`.

## Installation

Prérequis : Docker (Docker Desktop sous Windows/macOS).

1. Charger les images (une fois par version) :

   ```bash
   docker load -i images.tar
   ```

2. Préparer le contenu, au choix :
   - **reprendre une carte existante** : copier son dossier `data/` ici (à côté de `docker-compose.yml`) ;
   - **nouvelle carte vierge** : rien à faire sous Windows/macOS ; sous Linux, lancer `./scripts/init.sh` pour créer `data/` avec le bon propriétaire.

3. Démarrer :

   ```bash
   docker compose up -d
   ```

Ouvrir http://localhost:8080 (port modifiable avec un fichier `.env` contenant `WEB_PORT=8081` à côté de `docker-compose.yml`).

**Compte admin** : lu dans la commande (`ADMIN_USERNAME=… ADMIN_PASSWORD=… docker compose up -d`), sinon dans `data/.env` (deux lignes `ADMIN_USERNAME=` et `ADMIN_PASSWORD=`). S'il manque, il est généré au premier démarrage, enregistré dans `data/.env` et affiché par `docker compose logs api`.

Les conteneurs redémarrent automatiquement avec Docker (`restart: unless-stopped`) : si Docker Desktop est configuré pour se lancer au démarrage de la machine, l'application aussi.

## Au quotidien

| Action | Commande |
|---|---|
| Arrêter | `docker compose down` |
| Redémarrer après modification manuelle de `data/` | `docker compose restart api` |
| Voir les journaux | `docker compose logs -f api` |
| Sauvegarder le contenu | `.\scripts\backup.ps1` (ou copier le dossier `data/`) |
| Restaurer | `.\scripts\restore.ps1 backups\<archive>.zip` |

## Mettre à jour vers une nouvelle version

Le contenu ne bouge pas : arrêter (`docker compose down`), remplacer `images.tar`, `docker-compose.yml` et `scripts/` par ceux de la nouvelle livraison en gardant `data/`, puis `docker load -i images.tar` et `docker compose up -d`.
