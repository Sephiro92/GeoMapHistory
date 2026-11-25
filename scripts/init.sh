#!/bin/sh
# Crée le dossier de données avec le bon propriétaire. Recommandé sous Linux : sinon Docker crée
# ./data en root et l'API (utilisateur 1000 dans le conteneur) ne peut pas y écrire.
# Le compte admin est généré au premier démarrage s'il n'existe pas : voir « docker compose logs api ».
# Usage : ./scripts/init.sh
set -e
cd "$(dirname "$0")/.."

mkdir -p data/map data/wiki data/uploads
[ "$(id -u)" = "1000" ] || echo "Attention : si l'API ne peut pas écrire, lancez : sudo chown -R 1000:1000 data"
echo "Dossier data prêt. Lancez : docker compose up -d   (ajoutez --build si vous partez des sources)"
