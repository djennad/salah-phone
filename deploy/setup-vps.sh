#!/usr/bin/env bash
# Installation de Salah Phone sur un VPS Ubuntu 22.04 / 24.04 (ou Debian 12).
# Usage (en root) :  bash deploy/setup-vps.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installation de Docker"
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null 2>&1; then
  echo "==> Pare-feu : SSH, HTTP, HTTPS"
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

if [ ! -f .env ]; then
  cp .env.example .env
  read -rp "Nom de domaine (ex : salahphone.com) : " DOMAIN
  read -rp "Email administrateur : " ADMIN_EMAIL
  read -rsp "Mot de passe administrateur (8 caractères min.) : " ADMIN_PASSWORD; echo
  read -rp "Ajouter les produits de démonstration ? (o/N) : " DEMO
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|; s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|; s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" .env
  if [[ "${DEMO:-n}" =~ ^[oOyY] ]]; then sed -i 's/^SEED_DEMO=.*/SEED_DEMO=1/' .env; fi
  chmod 600 .env
fi

echo "==> Démarrage du site"
docker compose up -d --build

echo "==> Sauvegarde automatique chaque nuit à 3h"
CRON="0 3 * * * cd $APP_DIR && docker compose exec -T app node --no-warnings scripts/backup.js >> /var/log/salah-phone-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'salah-phone-backup' ; echo "$CRON" ) | crontab -

. ./.env
echo
echo "Terminé. Le site sera disponible sur https://${DOMAIN} dès que le DNS pointe vers ce serveur."
echo "Administration : https://${DOMAIN}/admin"
