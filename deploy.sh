#!/usr/bin/env bash
# deploy.sh — deploy GradeAssist to Yandex Cloud from your laptop.
#   ./deploy.sh
#
# Requires:
#   - SSH access to the VM as the `gradeassist` user (key-based)
#   - `yc` CLI installed & authenticated (https://yandex.cloud/docs/cli/)
#     OR `s3cmd`/aws CLI configured for the frontend bucket
#   - The VM already provisioned via vm-setup.sh, with /var/www/gradeassist/.env in place
#   - (optional, for CDN purge) CDN_RESOURCE_ID set in the shell or .env — the id
#     of the CDN resource fronting ispum.ru. Find it with: `yc cdn resource list`.
#     Without it the deploy still works; clients just update on the SW's own
#     no-cache revalidation instead of an immediate edge purge.
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
VM_HOST="boadtech@93.77.161.62"          # ← VM public IP (ephemeral — update if it changes)
APP_DIR="/var/www/gradeassist"
FRONTEND_BUCKET="gradeassist-frontend"
# ─────────────────────────────────────────────────────────────────────────────

echo "▶ [1/7] Building frontend…"
npm run build --workspace=frontend

echo "▶ [2/7] Uploading frontend → s3://${FRONTEND_BUCKET}/ …"
# Uses S3 static keys (no yc/OAuth). Reads YANDEX_STORAGE_* from the local .env.
node --env-file=.env scripts/upload-frontend.mjs frontend/dist "${FRONTEND_BUCKET}"

echo "▶ [3/7] Purging CDN cache for the no-cache entrypoints…"
# index.html / sw.js / registerSW.js / manifest.webmanifest ship with
# `no-cache, must-revalidate` from Object Storage (upload-frontend.mjs), but the
# CDN edge can still hold an old copy — which is exactly what leaves PWA clients
# on a stale service worker after a deploy. Purge just those entrypoints; the
# hashed /assets/* are immutable (new names every build) and must NOT be purged.
# Best-effort: a purge hiccup, a missing id, or no `yc` never fails the deploy.
CDN_RESOURCE_ID="${CDN_RESOURCE_ID:-$(sed -n 's/^CDN_RESOURCE_ID=//p' .env 2>/dev/null | tr -d '"'\''' | head -n1)}"
if [ -z "${CDN_RESOURCE_ID:-}" ]; then
  echo "  ⚠ CDN_RESOURCE_ID not set — skipping purge. Find it via 'yc cdn resource list' and add it to .env."
elif ! command -v yc >/dev/null 2>&1; then
  echo "  ⚠ yc CLI not found — skipping CDN purge. Purge manually in the console, or install/auth yc."
elif yc cdn cache purge --resource-id "$CDN_RESOURCE_ID" \
       --path '/' --path '/index.html' --path '/sw.js' \
       --path '/registerSW.js' --path '/manifest.webmanifest' >/dev/null 2>&1; then
  echo "  ✓ CDN cache purged (index.html + sw.js + registerSW.js + manifest)"
else
  echo "  ⚠ CDN purge failed (non-fatal) — clients still update within the SW's no-cache revalidation window."
fi

echo "▶ [4/7] Syncing backend source → VM…"
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.env' --exclude 'dist' --exclude 'uploads' \
  backend/ "${VM_HOST}:${APP_DIR}/backend/"
# shared/ types are imported by the backend at build time
rsync -avz --delete shared/ "${VM_HOST}:${APP_DIR}/shared/"

echo "▶ [5/7] Installing, building, migrating on VM…"
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

echo "▶ [6/7] Restarting API…"
ssh "$VM_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/gradeassist/backend
# Reload if already running, else start fresh
pm2 reload gradeassist-api --update-env 2>/dev/null \
  || pm2 start ecosystem.config.js --env production
pm2 save
REMOTE

echo "▶ [7/7] nginx guard…"
# nginx is NOT restarted on deploy — there's no reason to. If you ever change
# its config, do it by hand:  sudo nginx -t && sudo systemctl reload nginx
# (reload keeps the old config serving if the new one is broken; restart does
# not — a bad restart took the site down for a day on 2026-06-11).
# This guard only ensures nginx is actually up, and revives it if not.
#
# NGINX TIMEOUT NOTE (2026-07-04) — the /programs analyse endpoint runs an
# embedding pass over every discipline (50+) + two LLM passes, which for a
# large plan can exceed nginx's default `proxy_read_timeout 120s`. When that
# fires, the browser sees a 504 while the backend finishes and saves the
# result — classic "it errored but then the analysis appeared". The API
# client already waits 180s (frontend/src/api/programs.ts). On the VM, add
# to the /api/institution/programs/ location block:
#     proxy_read_timeout 240s;
#     proxy_send_timeout 240s;
# then `sudo nginx -t && sudo systemctl reload nginx`. This is a one-time
# manual change — deploy does not touch nginx config.
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
