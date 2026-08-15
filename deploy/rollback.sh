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
docker compose pull api api2

# Rolling, not simultaneous — same reasoning as deploy.sh: recreating both
# replicas at once means a window with NEITHER healthy, exactly the outage a
# second replica exists to avoid. A rollback is not the moment to skip this.
wait_healthy() {
  local name="\$1"
  for i in \$(seq 1 24); do   # up to 24 × 5s = 120s
    status="\$(docker inspect "\$name" --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)"
    if [ "\$status" = "healthy" ]; then return 0; fi
    sleep 5
  done
  echo "❌ \$name did not become healthy within 120s (last status: \$status). Recent logs:"
  docker logs "\$name" --tail=30 2>&1 | sed 's/^/    /'
  return 1
}

docker compose up -d --force-recreate api2
wait_healthy ispum-api-2
echo "  ✓ api2 healthy — recreating api…"
docker compose up -d --force-recreate api
wait_healthy ispum-api
echo "  ✓ api healthy"

EXPECTED_IMAGE="cr.yandex/${YC_REGISTRY_ID}/ispum-backend:${TAG}"
for name in ispum-api ispum-api-2; do
  ACTUAL_IMAGE="\$(docker inspect "\$name" --format '{{.Config.Image}}')"
  if [ "\$ACTUAL_IMAGE" != "\$EXPECTED_IMAGE" ]; then
    echo "❌ \$name is running \$ACTUAL_IMAGE, expected \$EXPECTED_IMAGE — rollback did not take effect."
    exit 1
  fi
  echo "  ✓ \$name running image confirmed: \$ACTUAL_IMAGE"
done
docker image prune -f >/dev/null
REMOTE

echo "▶ Verifying…"
ssh "$VM_HOST" 'set -e
  for port in 3000 3001; do
    ok=""
    for i in 1 2 3 4 5 6; do
      if curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" >/dev/null; then
        ok=1; break
      fi
      sleep 5
    done
    if [ -z "$ok" ]; then
      echo "  ✗ API on :${port} — FAILED after 30s. Recent container logs:"
      name=$([ "$port" = "3000" ] && echo ispum-api || echo ispum-api-2)
      docker logs "$name" --tail=30 2>&1 | sed "s/^/    /"
      exit 1
    fi
    echo "  ✓ API on :${port}:"
    curl -fsS "http://127.0.0.1:${port}/api/health"
    echo ""
  done
'

echo "✅ Rolled back to ${TAG} on both replicas."
