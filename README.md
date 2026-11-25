# GeoMapHistory

Carte du monde éditable pour renseigner des événements géo-historiques de **3000 av. J.-C. à 2100**, avec une frise chronologique et un wiki de documentation.

- **Carte** : points (villes, batailles…) et zones (empires, régions…) avec infobulle en Markdown.
- **Frise** : faites glisser l'année (ou lecture automatique) ; la carte n'affiche que ce qui existe à cette date.
- **Versions dans le temps** : une entité (ex. « Empire romain ») possède plusieurs géométries, chacune valable sur une période.
- **Wiki** : pages Markdown avec images, historique des révisions et liens bidirectionnels avec la carte.
- **Accès** : lecture publique ; un seul compte administrateur peut modifier.
- **Logiciel et contenu séparés** : l'application tourne dans Docker, tout le contenu édité vit dans le dossier `data/`.

## Démarrage

Prérequis : Docker Desktop.

```bash
docker compose up -d
docker compose logs api        # au premier démarrage : identifiant et mot de passe admin générés
```

Sous Linux, lancer d'abord `./scripts/init.sh` pour que `data/` appartienne au bon utilisateur. Ouvrir http://localhost:8080 puis « Connexion ».

### Compte administrateur

Le compte est lu dans cet ordre :

1. **la commande** : `ADMIN_USERNAME=… ADMIN_PASSWORD=… docker compose up -d` (PowerShell : `$env:ADMIN_PASSWORD='…'` avant la commande) ;
2. **`data/.env`**, qui n'a besoin que de deux lignes :
   ```
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=mon-mot-de-passe
   ```
3. **génération automatique** : si l'identifiant ou le mot de passe manque partout, l'API le génère au démarrage (identifiant `admin`, mot de passe aléatoire), l'ajoute à `data/.env` et l'affiche dans les logs (`docker compose logs api`). Il est ensuite réutilisé aux démarrages suivants.

Pour changer de mot de passe : modifier `data/.env` puis `docker compose restart api`. La clé de session est gérée seule dans `data/.session-secret` (la supprimer déconnecte l'admin) ; une variable `JWT_SECRET` reste prise en compte si elle est définie.

La carte démarre **vierge**. Pour partir des frontières réelles, voir [Frontières historiques](#frontières-historiques).

Le port se change avec un fichier `.env` à la racine contenant `WEB_PORT=8081` (réglage propre à la machine, pas au contenu).

## Le dossier `data/`

C'est le contenu de votre carte, indépendant du logiciel. Copiez-le pour sauvegarder, ou pour transporter la carte vers une autre installation (arrêtez l'application avant de remplacer le dossier).

```
data/
├── .env                              compte administrateur (ADMIN_USERNAME, ADMIN_PASSWORD)
├── .session-secret                   clé de session, générée automatiquement
├── map/<id>-<nom>.geojson            un élément de la carte et toutes ses versions dans le temps
├── wiki/<slug>.md                    une page du wiki
├── wiki/.history/<slug>/<date>.md    l'historique des révisions de la page
└── uploads/                          les images
```

- **`map/*.geojson`** : GeoJSON standard (ouvrable dans QGIS, geojson.io…). L'en-tête `entity` porte le nom, la couleur, l'infobulle et les pages wiki liées ; chaque `Feature` est une version, avec `startYear` / `endYear` dans ses `properties`. L'`id` est celui utilisé dans les liens `[[carte:12]]`.
- **`wiki/*.md`** : Markdown précédé d'un en-tête (`title`, `created`, `updated`). Le nom du fichier est l'adresse de la page (`/wiki/<slug>`).

Chaque modification faite dans l'application est écrite immédiatement dans ces fichiers. La base PostGIS n'est qu'un index : elle est **reconstruite depuis `data/` à chaque démarrage de l'API** (quelques secondes, ~8 s avec les 3 000 territoires historiques). On peut donc aussi modifier les fichiers à la main puis redémarrer l'API (`docker compose restart api`) ; un fichier invalide est ignoré avec un avertissement dans `docker compose logs api`.

Sous Linux, l'API écrit avec l'utilisateur 1000 : si besoin, `sudo chown -R 1000:1000 data`.

## Utilisation

**Créer** : en admin, « ＋ Point » ou « ＋ Zone ». Pour une zone, cliquez les sommets puis refermez sur le premier (ou Entrée). Remplissez la fiche (nom, période, infobulle, pages wiki liées).

**Faire évoluer une zone dans le temps** : dans la fiche, sur une version, « Nouvelle version » → saisissez l'année de changement. La version actuelle est close l'année précédente et une copie démarre à cette année, ouverte directement en édition de géométrie.

**Éditer une géométrie** : « Géométrie » sur une version → déplacez les sommets (points intermédiaires pour en ajouter), `Suppr` efface l'élément sélectionné, « Ajouter une partie » crée une zone en plusieurs morceaux (îles…).

**Années** : entiers, négatif = av. J.-C. (`-753`), pas d'an 0. Bornes incluses ; une fin vide = « jusqu'à la fin de la frise ». « Événement ponctuel » = visible uniquement l'année de début.

**Liens dans le Markdown** (infobulles et wiki) :

| Syntaxe | Résultat |
|---|---|
| `[[Titre de page]]` | lien vers la page wiki (proposée à la création si elle n'existe pas) |
| `[[Titre de page\|texte]]` | idem avec un texte personnalisé |
| `[[carte:12]]` | ouvre l'élément n°12 sur la carte |

## Frontières historiques

Optionnelles : menu **Administration → Importer les frontières historiques**. L'application télécharge les 49 instantanés de [historical-basemaps](https://github.com/aourednik/historical-basemaps) compris entre 3000 av. J.-C. et 2010 (version figée du dépôt, connexion Internet requise, ≈ 1 minute) et crée ≈ 3 000 territoires (≈ 5 000 versions, ≈ 17 Mo dans `data/map/`).

- Un territoire présent dans l'instantané d'une année vaut jusqu'à la veille de l'instantané suivant ; l'instantané de 2010 vaut jusqu'à 2100. Les instantanés consécutifs identiques sont fusionnés.
- Les géométries sont simplifiées (~1 km) et leurs trous comblés (l'éditeur ne gère pas les polygones à trous ; une enclave reste visible car les petites zones sont dessinées au-dessus des grandes).
- Les territoires sans nom sont ignorés. Les noms sont ceux du jeu de données (en anglais) et ne sont pas toujours constants d'une époque à l'autre.
- Une fois importés, ils sont modifiables comme vos propres zones (`"source": "historical-basemaps"` dans leur fichier).
- **Retirer les frontières historiques** supprime tous les territoires importés, **modifications comprises** ; vos propres éléments ne sont jamais touchés.

> **Licence** : ces données sont sous **GPL-3.0**. Usage personnel sans contrainte ; si vous diffusez la carte ou ses données, elles doivent rester sous GPL-3.0 avec attribution (la mention figure dans la description de chaque territoire importé).

## Sauvegarde et restauration

Sauvegarder = copier le dossier `data/`.

### Depuis l'application

Menu **Administration → Sauvegarde du contenu** :

- **Exporter le contenu (.zip)** télécharge `map/`, `wiki/` (avec l'historique) et `uploads/`. Le compte administrateur (`.env`, `.session-secret`) n'y figure pas.
- **Importer et remplacer** charge une archive et **remplace tout le contenu**, sans redémarrage. Avant le remplacement, le contenu actuel est sauvegardé dans `data/backups/avant-import-<date>.zip` ; si le chargement échoue, il est remis en place. Sont acceptés : un export de cette page, une archive de `scripts/backup.ps1` ou un zip du dossier `data`. Le compte administrateur de l'installation n'est jamais modifié par un import (un `.env` présent dans l'archive est ignoré), et les archives invalides (chemins en `../`, fichiers non zip, aucun contenu reconnu) sont refusées sans rien changer. Limite : 2 Go.

Les sauvegardes de `data/backups/` s'accumulent : supprimez les anciennes à la main si besoin.

### Par script

```powershell
.\scripts\backup.ps1                                          # -> backups\geomap-data-AAAA-MM-JJ_HHMMSS.zip
.\scripts\restore.ps1 backups\geomap-data-2026-10-31_120000.zip   # l'ancien data/ est gardé à côté
```

Contrairement à l'export de l'application, l'archive du script inclut `data/.env` (et donc le compte admin). (Linux/macOS : `tar czf geomap-data.tgz data`.)

## Livrer l'application sur une autre machine

### Par Docker Hub

`docker-compose.yml` déclare à la fois le nom des images publiées (`image: sephiro92/…`) et leurs sources (`build:`) :

```bash
docker compose build     # construit les images sous ces noms
docker compose push      # les publie sur Docker Hub (après « docker login »)
```

Sur une autre machine, seul `docker-compose.yml` est nécessaire (pas les sources) :

```bash
docker compose pull      # télécharge les images publiées
docker compose up -d     # le compte admin s'affiche dans « docker compose logs api »
```

### Par fichier, sans registre

Pour faire tourner GeoMapHistory ailleurs sans les sources, sans build et sans Internet :

```powershell
.\scripts\export-images.ps1            # version lue dans backend\package.json, ou -Version 0.2.0
```

Le script construit l'application et crée `release\geomaphistory-<version>\` (≈ 300 Mo), à copier tel quel :

```
images.tar            images Docker : geomaphistory-api, geomaphistory-web et postgis (fonctionne hors ligne)
docker-compose.yml    démarrage à partir de ces images (modèle : deploy/docker-compose.yml)
scripts/              init, backup, restore
LISEZMOI.md           mode d'emploi détaillé
```

Sur la machine cible :

```bash
docker load -i images.tar
# copier le dossier data/ à côté de docker-compose.yml (sinon une carte vierge est créée)
docker compose up -d
```

Pour une nouvelle version, on remplace `images.tar`, `docker-compose.yml` et `scripts/` en gardant `data/`. Pensez à augmenter `version` dans `backend/package.json` avant l'export pour distinguer les livraisons.

## Architecture

```
docker-compose.yml
backend/     API Fastify (TypeScript) : routes, migrations SQL, lecture/écriture de data/
frontend/    React + MapLibre GL + Terra Draw, servi par Caddy (qui proxifie /api et /uploads)
scripts/     initialisation, sauvegarde, restauration
data/        le contenu (hors du dépôt du logiciel, voir .gitignore)
```

| Service | Rôle |
|---|---|
| `db` | PostgreSQL 16 + PostGIS, index reconstruit au démarrage (volume `pgcache`) |
| `api` | API REST (port 3000 interne) ; monte `./data` sur `/data` |
| `web` | Caddy : fichiers du frontend + reverse proxy, exposé sur `WEB_PORT` (8080) |

Le fond de carte (terres émergées Natural Earth, sans frontières modernes) est embarqué dans l'application. Seules les polices des étiquettes sont chargées depuis `demotiles.maplibre.org` : hors ligne, la carte fonctionne mais sans les noms affichés.

### Développement du frontend

```bash
cd frontend && npm install && npm run dev   # Vite sur :5173, API de la stack Docker sur :8080
```
