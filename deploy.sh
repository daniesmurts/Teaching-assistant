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

# ── Working-tree guard (docs/on-prem-deployment.md §7.1, §16 Track 1.2) ──────
# This script rsyncs the WORKING TREE, but stamps VERSION from `git rev-parse
# HEAD`. Deploying with uncommitted changes therefore puts code in production
# that no commit contains, labelled with a commit that doesn't describe it —
# so the version string can't be trusted to attribute a bug report to a build.
# Survivable with one server; fatal once telemetry from multiple deployments
# is keyed on version. Refuse by default; ALLOW_DIRTY_DEPLOY=1 overrides for a
# genuine emergency and marks the version `+dirty` so the lie is at least visible.
DIRTY_SUFFIX=""
if [ -n "$(git status --porcelain)" ]; then
  if [ "${ALLOW_DIRTY_DEPLOY:-}" = "1" ]; then
    echo "⚠ DIRTY working tree deployed on purpose (ALLOW_DIRTY_DEPLOY=1) — version marked +dirty:"
    git status --short | sed 's/^/    /'
    DIRTY_SUFFIX="+dirty"
  else
    echo "❌ Working tree has uncommitted changes — refusing to deploy."
    git status --short | sed 's/^/    /'
    echo ""
    echo "   Commit them first, or re-run with ALLOW_DIRTY_DEPLOY=1 for an emergency deploy."
    exit 1
  fi
fi

# Unpushed commits aren't a correctness problem — the SHA is real and the code
# genuinely matches it — but production would be running something nobody else
# can check out. Warn, don't block.
UNPUSHED="$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"
if [ "$UNPUSHED" != "0" ]; then
  echo "⚠ ${UNPUSHED} commit(s) not pushed to origin — prod will run code that isn't on the remote."
fi

# ── Release identity (docs/on-prem-deployment.md §7.4, §16 Track 1.2) ────────
# The SEMANTIC version is the single source of truth in the ROOT package.json
# ("1.5.0"), not in the workspaces — it's the number a customer says out loud
# and the one a support matrix and a licence file refer to. The date+SHA build
# stamp stays as metadata: it identifies the exact build, the semver identifies
# the release.
SEMVER="$(node -p "require('./package.json').version")"

# A release should be tagged. Warn rather than block — bumping package.json and
# tagging are separate acts, and a hotfix deploy shouldn't be held hostage to
# tag hygiene. Track 4.1 turns this into a hard gate for the `stable` channel.
if ! git rev-parse --verify --quiet "refs/tags/v${SEMVER}" >/dev/null; then
  echo "⚠ No git tag v${SEMVER} — this release isn't tagged. Create it with: git tag v${SEMVER}"
fi

# Build/deploy identifier — `{semver} ({date}+{git short SHA})`,
# e.g. 1.5.0 (2026-07-14+a1b2c3d).
# Distinct from the hand-curated "Версия 1.4" marketing changelog
# (frontend/src/pages/Changelog.tsx): that one is bumped by hand when we want
# to announce a release; this one stamps every deploy automatically so
# /api/health and the sidebar footer always show exactly what's live, with
# zero chance of forgetting to bump it. Read by vite.config.ts (frontend) and
# backend/src/lib/version.ts (backend) — both fall back to 'dev' if the
# VERSION file is absent, which is the normal state outside of a deploy.
BUILD_VERSION="${SEMVER} ($(date -u +%Y-%m-%d)+$(git rev-parse --short HEAD)${DIRTY_SUFFIX})"
echo "$BUILD_VERSION" > VERSION
echo "▶ [0/7] Build version: ${BUILD_VERSION}"

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
# VERSION lives at the repo root next to .env — backend/src/lib/version.ts reads
# it as `../VERSION` relative to its cwd (backend/), same convention as .env.
rsync -avz VERSION "${VM_HOST}:${APP_DIR}/VERSION"

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
