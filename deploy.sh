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

# ── Config ───────────────────────────────────────────────────────────────────
VM_HOST="boadtech@93.77.161.62"          # ← VM public IP (ephemeral — update if it changes)
APP_DIR="/var/www/gradeassist"
FRONTEND_BUCKET="gradeassist-frontend"
# ─────────────────────────────────────────────────────────────────────────────

echo "▶ [1/5] Building frontend…"
npm run build --workspace=frontend

echo "▶ [2/5] Uploading frontend → s3://${FRONTEND_BUCKET}/ …"
# Uses S3 static keys (no yc/OAuth). Reads YANDEX_STORAGE_* from the local .env.
node --env-file=.env scripts/upload-frontend.mjs frontend/dist "${FRONTEND_BUCKET}"

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
# backend/package.json is self-contained (workspaces lockfile is at the repo root,
# which we don't ship), so use install, not ci. Force-include devDeps —
# the TypeScript compiler is a devDependency needed by `npm run build`.
npm install --include=dev
# Compile TypeScript → dist/ (clean first so no stale artifacts linger).
rm -rf dist
npm run build
# Fail loudly if the entry point didn't get built (catches silent build issues).
test -f dist/backend/src/index.js || { echo "❌ Build did not produce dist/backend/src/index.js"; exit 1; }
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
