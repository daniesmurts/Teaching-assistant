#!/bin/bash
# deploy.sh — deploy latest code from your machine to the Yandex Cloud VM.
# Usage:   ./deploy/deploy.sh
# Needs:   SSH key configured for $VM_HOST, and `yc` CLI authenticated.
set -e

# ── Config — edit these ────────────────────────────────────────────────
VM_HOST="${VM_HOST:-gradeassist@YOUR.VM.IP.ADDRESS}"
APP_DIR="/var/www/gradeassist"
FRONTEND_BUCKET="${FRONTEND_BUCKET:-gradeassist-frontend}"

echo "▶ Building frontend"
( cd frontend && npm run build )

echo "▶ Uploading frontend → Object Storage (s3://$FRONTEND_BUCKET)"
# Requires Yandex CLI: https://yandex.cloud/docs/cli/quickstart
yc storage cp --recursive frontend/dist/ "s3://$FRONTEND_BUCKET/" --acl public-read

echo "▶ Syncing backend → VM"
rsync -avz \
  --exclude 'node_modules' --exclude '.env' --exclude 'dist' --exclude 'uploads' \
  backend/ "$VM_HOST:$APP_DIR/backend/"
rsync -avz shared/ "$VM_HOST:$APP_DIR/shared/"

echo "▶ Build + migrate + restart on VM"
ssh "$VM_HOST" bash -s <<'REMOTE'
  set -e
  cd /var/www/gradeassist/backend
  npm ci
  npm run build
  npm run migrate
  pm2 reload gradeassist-api --update-env || pm2 start ecosystem.config.js --env production
  pm2 save
REMOTE

echo "▶ Health check"
sleep 2
curl -fsS https://gradeassist.ru/api/health && echo "" && echo "✓ Deploy complete"
