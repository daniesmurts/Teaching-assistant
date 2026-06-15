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

echo "▶ [1/6] Building frontend…"
npm run build --workspace=frontend

echo "▶ [2/6] Uploading frontend → s3://${FRONTEND_BUCKET}/ …"
# Uses S3 static keys (no yc/OAuth). Reads YANDEX_STORAGE_* from the local .env.
node --env-file=.env scripts/upload-frontend.mjs frontend/dist "${FRONTEND_BUCKET}"

echo "▶ [3/6] Syncing backend source → VM…"
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.env' --exclude 'dist' --exclude 'uploads' \
  backend/ "${VM_HOST}:${APP_DIR}/backend/"
# shared/ types are imported by the backend at build time
rsync -avz --delete shared/ "${VM_HOST}:${APP_DIR}/shared/"

echo "▶ [4/6] Installing, building, migrating on VM…"
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

echo "▶ [5/6] Restarting API…"
ssh "$VM_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/gradeassist/backend
# Reload if already running, else start fresh
pm2 reload gradeassist-api --update-env 2>/dev/null \
  || pm2 start ecosystem.config.js --env production
pm2 save
REMOTE

echo "▶ [6/6] nginx guard…"
# nginx is NOT restarted on deploy — there's no reason to. If you ever change
# its config, do it by hand:  sudo nginx -t && sudo systemctl reload nginx
# (reload keeps the old config serving if the new one is broken; restart does
# not — a bad restart took the site down for a day on 2026-06-11).
# This guard only ensures nginx is actually up, and revives it if not.
ssh "$VM_HOST" bash -s <<'REMOTE'
set -euo pipefail
if ! systemctl is-active --quiet nginx; then
  echo "⚠ nginx is down — config-testing and starting it…"
  sudo nginx -t
  sudo systemctl start nginx
fi
echo "nginx: $(systemctl is-active nginx)"
REMOTE

echo "▶ Verifying health…"
sleep 2

# AUTHORITATIVE check — runs ON the VM, so it can't be fooled by the laptop's
# network. This is the hard gate: if the public site is truly down, this fails.
#   - local Node health (the API process is up)
#   - public TLS from the VM itself (nginx → bucket/API path works)
ssh "$VM_HOST" 'set -e
  curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null && echo "  ✓ API (local)"
  curl -fsS --max-time 10 https://ispum.ru/api/health      >/dev/null && echo "  ✓ API (public, from VM)"
  curl -fsS --max-time 10 -o /dev/null https://ispum.ru/   && echo "  ✓ frontend (from VM)"
'

# BEST-EFFORT check from this laptop — confirms YOUR path to prod, but a flaky
# local network (DNS/VPN) must NOT fail an otherwise-good deploy. Retry a few
# times, then warn-only. The VM-side check above is what actually gates.
echo "▶ Public check from this machine (best-effort)…"
ok=""
for i in 1 2 3; do
  if curl -fsS --max-time 12 -o /dev/null https://ispum.ru/api/health 2>/dev/null; then
    ok=1; echo "  ✓ reachable from here"; break
  fi
  [ "$i" -lt 3 ] && sleep 4
done
[ -z "$ok" ] && echo "  ⚠ couldn't reach prod from THIS machine after 3 tries — likely your local network/DNS, not the server (VM-side checks above passed). Verify in a browser."

echo "✅ Deploy complete."
