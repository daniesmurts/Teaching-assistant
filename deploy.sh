#!/usr/bin/env bash
# deploy.sh — deploy GradeAssist to Yandex Cloud from your laptop.
#   ./deploy.sh
#
# Requires:
#   - SSH access to the VM as the `gradeassist` user (key-based)
#   - `yc` CLI installed & authenticated (https://yandex.cloud/docs/cli/)
#     OR `s3cmd`/aws CLI configured for the frontend bucket
#   - The VM already provisioned via vm-setup.sh, with /var/www/gradeassist/.env in place
set -euo pipefail

# ── Config — EDIT THESE ──────────────────────────────────────────────────────
VM_HOST="gradeassist@YOUR.VM.IP.ADDRESS"
APP_DIR="/var/www/gradeassist"
FRONTEND_BUCKET="gradeassist-frontend"
# ─────────────────────────────────────────────────────────────────────────────

echo "▶ [1/5] Building frontend…"
npm run build --workspace=frontend

echo "▶ [2/5] Uploading frontend → s3://${FRONTEND_BUCKET}/ …"
# Uses yc CLI. (Alternative: aws s3 sync frontend/dist s3://$FRONTEND_BUCKET --endpoint-url https://storage.yandexcloud.net)
yc storage s3 cp --recursive frontend/dist/ "s3://${FRONTEND_BUCKET}/" --acl public-read
# Bust the service-worker / index cache: re-upload index.html + sw.js with no-cache
yc storage s3 cp frontend/dist/index.html "s3://${FRONTEND_BUCKET}/index.html" \
  --acl public-read --cache-control "no-cache, must-revalidate"
yc storage s3 cp frontend/dist/sw.js "s3://${FRONTEND_BUCKET}/sw.js" \
  --acl public-read --cache-control "no-cache, must-revalidate" || true

echo "▶ [3/5] Syncing backend source → VM…"
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.env' --exclude 'dist' --exclude 'uploads' \
  backend/ "${VM_HOST}:${APP_DIR}/backend/"
# shared/ types are imported by the backend at build time
rsync -avz --delete shared/ "${VM_HOST}:${APP_DIR}/shared/"

echo "▶ [4/5] Installing, building, migrating on VM…"
ssh "$VM_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/gradeassist/backend
npm ci
npm run build
# Apply any pending DB migrations (idempotent — tracked in migrations table)
node --env-file=../.env scripts/migrate.js
REMOTE

echo "▶ [5/5] Restarting API…"
ssh "$VM_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/gradeassist/backend
# Reload if already running, else start fresh
pm2 reload gradeassist-api --update-env 2>/dev/null \
  || pm2 start ecosystem.config.js --env production
pm2 save
REMOTE

echo "▶ Verifying health…"
sleep 2
ssh "$VM_HOST" 'curl -fsS http://127.0.0.1:3000/api/health' && echo

echo "✅ Deploy complete."
