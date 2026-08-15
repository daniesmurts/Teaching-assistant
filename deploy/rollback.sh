#!/usr/bin/env bash
# deploy/rollback.sh — repoint the running container to a PREVIOUSLY PUSHED
# image tag, without rebuilding, re-migrating, or touching the frontend.
#   ./deploy/rollback.sh 1.5.0-abc1234
#
# Find candidate tags in the registry console, or from a recent deploy's own
# output (deploy.sh prints "image tag: ..." at [0/8]) or `git log --oneline`
# (tag is {semver}-{short-sha}).
#
# Deliberately does NOT run migrations — migrations are forward-only and
# additive by policy (docs/on-prem-deployment.md §7.7, expand/contract), so
# an OLDER app build is expected to run correctly against a NEWER schema.
# Rolling the schema itself back is a separate, much rarer decision this
# script does not make for you.
#
# This is the fast path promised back in §16 Track 1.3/1.4b ("rollback =
# repoint tag"), that until now existed only as a sentence, not a script.
set -euo pipefail

VM_HOST="boadtech@93.77.161.62"
APP_DIR="/var/www/gradeassist"

TAG="${1:?Usage: ./deploy/rollback.sh <image-tag>   e.g. 1.5.0-abc1234}"

YC_REGISTRY_ID="${YC_REGISTRY_ID:-$(sed -n 's/^YC_REGISTRY_ID=//p' .env 2>/dev/null | tr -d '"'\''' | head -n1)}"
if [ -z "${YC_REGISTRY_ID:-}" ]; then
  echo "❌ YC_REGISTRY_ID not set — add it to .env (see .env.example)."
  exit 1
fi

echo "▶ Rolling back to ${TAG}…"
ssh "$VM_HOST" bash -s <<REMOTE
set -euo pipefail
cd "${APP_DIR}"
export YC_REGISTRY_ID="${YC_REGISTRY_ID}"
export IMAGE_TAG="${TAG}"
# --force-recreate + a post-check that the running image actually matches —
# see the matching comment in deploy.sh. FOUND 2026-08-15: plain \`up -d\`
# left a container running its OLD image across two consecutive deploys with
# different, already-pulled tags, no error from compose. A rollback is the
# one place this silently not taking effect matters most — never trust it
# implicitly here.
docker compose pull api
docker compose up -d --force-recreate api
ACTUAL_IMAGE="\$(docker inspect ispum-api --format '{{.Config.Image}}')"
EXPECTED_IMAGE="cr.yandex/${YC_REGISTRY_ID}/ispum-backend:${TAG}"
if [ "\$ACTUAL_IMAGE" != "\$EXPECTED_IMAGE" ]; then
  echo "❌ Running image is \$ACTUAL_IMAGE, expected \$EXPECTED_IMAGE — rollback did not take effect."
  exit 1
fi
echo "  ✓ Running image confirmed: \$ACTUAL_IMAGE"
docker image prune -f >/dev/null
REMOTE

echo "▶ Verifying…"
ssh "$VM_HOST" 'set -e
  ok=""
  for i in 1 2 3 4 5 6; do
    if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null; then
      ok=1; break
    fi
    sleep 5
  done
  if [ -z "$ok" ]; then
    echo "  ✗ API (local) — FAILED after 30s. Recent container logs:"
    docker logs ispum-api --tail=30 2>&1 | sed "s/^/    /"
    exit 1
  fi
  curl -fsS http://127.0.0.1:3000/api/health
  echo ""
'

echo "✅ Rolled back to ${TAG}."
