#!/usr/bin/env bash
# deploy.sh — deploy GradeAssist to Yandex Cloud from your laptop.
#   ./deploy.sh
#
# Requires:
#   - SSH access to the VM as the `gradeassist` user (key-based)
#   - `yc` CLI installed & authenticated (https://yandex.cloud/docs/cli/)
#     OR `s3cmd`/aws CLI configured for the frontend bucket
#   - `gh` CLI installed & authenticated — this script now GATES on CI status
#     for the current commit before deploying (see below)
#   - The VM already provisioned via vm-setup.sh, with /var/www/gradeassist/.env
#     in place, Docker installed, and `docker login cr.yandex` already done
#     (docs/on-prem-deployment.md §16 Track 1.4b)
#   - YC_REGISTRY_ID set in .env (see .env.example) — the registry CI pushes
#     the backend image to
#   - (optional, for CDN purge) CDN_RESOURCE_ID set in the shell or .env — the id
#     of the CDN resource fronting ispum.ru. Find it with: `yc cdn resource list`.
#     Without it the deploy still works; clients just update on the SW's own
#     no-cache revalidation instead of an immediate edge purge.
#
# ── Backend deploy model changed (§16 Track 1.4b) ────────────────────────────
# The backend is no longer built here or on the VM — CI already built and
# tested it (see .github/workflows/ci.yml's "image" job) and this script pulls
# that exact, already-verified image by tag. Only the frontend (which isn't
# containerised — it still ships straight to Object Storage) is built locally.
#
# ── ONE-TIME CUTOVER, before the FIRST run of this version of the script ────
# The container binds port 3000 directly (network_mode: host — see
# deploy/docker-compose.cloud.yml), so PM2 must let go of it first, or the
# container fails to start. This is NOT baked into the script below on
# purpose: an unconditional `pm2 delete` on every future deploy would itself
# fail loudly once PM2 no longer manages anything, breaking every deploy
# after the first. Run once, by hand, before your first run of this script:
#     ssh boadtech@93.77.161.62
#     pm2 delete gradeassist-api && pm2 save
# Expect a brief outage during THIS ONE cutover — the container can't bind
# :3000 until PM2 releases it. Every deploy AFTER this one is zero-downtime,
# same as PM2's old `pm2 reload`: [6/8] below rolls api2 and api one at a
# time, waiting for Docker's own healthcheck on each before touching the
# other, so nginx's upstream (least_conn, deploy/nginx/gradeassist.conf)
# always has at least one live backend to route to (docs/on-prem-deployment.md
# §16 TODO #13 — two replicas, shipped once the single-replica pipeline had
# a track record of ordinary, independently-verified deploys).
#
# Rollback: deploy/rollback.sh <image-tag> — repoints the running container to
# a previously pushed tag without rebuilding or re-migrating.
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

# Unpushed commits used to be a soft problem (rsync shipped the working tree
# regardless of git state) — now it's a hard one. deploy.sh pulls a PRE-BUILT
# image tagged from this commit's SHA (§16 Track 1.4b); if CI never saw the
# commit, no such image exists and the pull below fails. Escalated from a
# warning to a block for exactly that reason.
if ! git rev-parse --verify --quiet @{u} >/dev/null; then
  echo "❌ No upstream tracking branch for $(git branch --show-current) — can't verify this commit is pushed."
  echo "   git push -u origin $(git branch --show-current)"
  exit 1
fi
UNPUSHED="$(git rev-list --count @{u}..HEAD)"
if [ "$UNPUSHED" != "0" ]; then
  echo "❌ ${UNPUSHED} commit(s) not pushed to origin — CI never built these, so no image exists yet."
  echo "   Push first: git push"
  exit 1
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

# SHORT_SHA is its own variable (not just inlined into BUILD_VERSION below)
# because IMAGE_TAG needs the exact same value — it must byte-for-byte match
# the tag ci.yml's "image" job computed and pushed for this commit
# (`${SEMVER}-${SHORT_SHA}`), or the pull two sections down 404s.
SHORT_SHA="$(git rev-parse --short HEAD)"
IMAGE_TAG="${SEMVER}-${SHORT_SHA}"

# Build/deploy identifier — `{semver} ({date}+{git short SHA})`,
# e.g. 1.5.0 (2026-07-14+a1b2c3d).
# Distinct from the hand-curated "Версия 1.4" marketing changelog
# (frontend/src/pages/Changelog.tsx): that one is bumped by hand when we want
# to announce a release; this one stamps every deploy automatically so
# /api/health and the sidebar footer always show exactly what's live, with
# zero chance of forgetting to bump it. Read by vite.config.ts (frontend) and
# backend/src/lib/version.ts (backend) — both fall back to 'dev' if the
# VERSION file is absent, which is the normal state outside of a deploy.
#
# Frontend-only now: the backend image already carries its own VERSION,
# baked in at CI build time from this same SEMVER+SHORT_SHA formula (see
# ci.yml's "Compute version" step) — deploy.sh no longer writes or rsyncs a
# VERSION file for the backend, only for the frontend build below, which
# isn't containerised and still needs vite.config.ts's readBuildVersion()
# to find one on disk.
BUILD_VERSION="${SEMVER} ($(date -u +%Y-%m-%d)+${SHORT_SHA}${DIRTY_SUFFIX})"
echo "$BUILD_VERSION" > VERSION
echo "▶ [0/9] Build version: ${BUILD_VERSION}  (image tag: ${IMAGE_TAG})"

# ── CI gate (docs/on-prem-deployment.md §16 Track 1.4b) ──────────────────────
# The whole point of building images in CI is that a tag is a promise about
# what's inside it — never deploy a tag that hasn't actually passed. Poll
# rather than assume: CI takes ~2 minutes end to end, so a push-then-
# immediately-deploy is a real race, not a hypothetical one.
echo "▶ [1/9] Waiting for CI to confirm ${SHORT_SHA} is safe to deploy…"
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ gh CLI not found — can't verify CI status. Install: https://cli.github.com"
  exit 1
fi
CI_ATTEMPTS=0
CI_MAX_ATTEMPTS=40   # 40 × 15s = 10 minutes
while true; do
  read -r CI_STATUS CI_CONCLUSION <<< "$(gh run list --commit "$(git rev-parse HEAD)" --workflow=CI --limit 1 \
    --json status,conclusion --jq '(.[0].status // "not_found") + " " + (.[0].conclusion // "none")' 2>/dev/null || echo "not_found none")"

  if [ "$CI_STATUS" = "completed" ] && [ "$CI_CONCLUSION" = "success" ]; then
    echo "  ✓ CI passed for ${SHORT_SHA}"
    break
  elif [ "$CI_STATUS" = "completed" ]; then
    echo "❌ CI did not pass for ${SHORT_SHA} (conclusion: ${CI_CONCLUSION}). Refusing to deploy."
    echo "   gh run list --commit $(git rev-parse HEAD)"
    exit 1
  fi

  CI_ATTEMPTS=$((CI_ATTEMPTS + 1))
  if [ "$CI_ATTEMPTS" -ge "$CI_MAX_ATTEMPTS" ]; then
    echo "❌ Timed out after 10 minutes waiting for CI on ${SHORT_SHA}."
    echo "   gh run list --commit $(git rev-parse HEAD)"
    exit 1
  fi
  echo "  … ${CI_STATUS} (attempt ${CI_ATTEMPTS}/${CI_MAX_ATTEMPTS}), waiting 15s"
  sleep 15
done

# Deploy-only — id of the registry the image lives in. See .env.example.
# Resolved here rather than just before the VM steps because the image
# guard below needs it, and that guard has to run before anything ships.
YC_REGISTRY_ID="${YC_REGISTRY_ID:-$(sed -n 's/^YC_REGISTRY_ID=//p' .env 2>/dev/null | tr -d '"'\''' | head -n1)}"
if [ -z "${YC_REGISTRY_ID:-}" ]; then
  echo "❌ YC_REGISTRY_ID not set — add it to .env (see .env.example). Find it on the registry's console page."
  exit 1
fi

# ── Backend image guard ──────────────────────────────────────────────────────
# ORDERING IS THE POINT. The frontend goes live at step [4/9] (Object Storage
# upload + CDN purge); the backend image is not pulled until [7/9]. Anything
# that fails in between leaves the new UI calling an old API — every route the
# new build added answers 404, and nothing in the browser explains why.
#
# Not hypothetical: on 2026-09-05 production served a frontend four commits
# ahead of its backend, and «Проверить усвоение» / «Раздатка» 404'd for real
# users until the next deploy. The CI gate above did not catch it, and cannot:
# CI can go green while no image is pushed at all, because ci.yml's image job
# only pushes when the registry credentials are present AND the event is a
# push. A green run is a promise about the tests, not about the artifact.
#
# So prove the exact tag exists before shipping anything. Pulling rather than
# inspecting has a useful side effect — the image is already on the VM when
# [7/9] runs, which shrinks the window where the two halves disagree from
# minutes to seconds.
echo "▶ [2/9] Verifying backend image ${IMAGE_TAG} is in the registry…"
if ssh "$VM_HOST" "docker pull cr.yandex/${YC_REGISTRY_ID}/ispum-backend:${IMAGE_TAG} >/dev/null 2>&1"; then
  echo "  ✓ image present, and now pre-pulled on the VM"
else
  echo "❌ No backend image cr.yandex/${YC_REGISTRY_ID}/ispum-backend:${IMAGE_TAG}"
  echo "   Nothing was deployed — the frontend has NOT been uploaded, so production is unchanged."
  echo "   Most likely CI passed but its image job did not push (check that job, and the registry"
  echo "   credentials), or the VM cannot authenticate to the registry."
  exit 1
fi

echo "▶ [3/9] Building frontend…"
npm run build --workspace=frontend

echo "▶ [4/9] Uploading frontend → s3://${FRONTEND_BUCKET}/ …"
# Uses S3 static keys (no yc/OAuth). Reads YANDEX_STORAGE_* from the local .env.
node --env-file=.env scripts/upload-frontend.mjs frontend/dist "${FRONTEND_BUCKET}"

echo "▶ [5/9] Purging CDN cache for the no-cache entrypoints…"
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

echo "▶ [6/9] Syncing compose file → VM…"
# The backend's SOURCE no longer goes to the VM at all — the image built and
# tested in CI is the artifact now (§16 Track 1.3/1.4b), not the working
# tree. Only this one small config file ships.
rsync -avz "deploy/docker-compose.cloud.yml" "${VM_HOST}:${APP_DIR}/docker-compose.yml"

echo "▶ [7/9] Pulling ${IMAGE_TAG}, migrating, rolling restart on VM…"
# Unquoted heredoc delimiter (REMOTE, not 'REMOTE') is deliberate here, unlike
# the other ssh blocks in this file — IMAGE_TAG/YC_REGISTRY_ID must be
# substituted by THIS shell before the commands reach the VM; the remote
# shell has no way to know them otherwise.
ssh "$VM_HOST" bash -s <<REMOTE
set -euo pipefail
cd "${APP_DIR}"
export YC_REGISTRY_ID="${YC_REGISTRY_ID}"
export IMAGE_TAG="${IMAGE_TAG}"
docker compose pull api api2 migrate
# One-shot migration container, same image about to serve traffic — not the
# code that happened to be sitting on the VM at rsync time (there isn't any
# anymore). Idempotent, tracked in the migrations table. Runs ONCE regardless
# of replica count — migrations aren't per-container state.
#
# -T (--no-TTY) + </dev/null — ROOT CAUSE, found 2026-08-15 after THREE
# separate deploys each silently failed to recreate the api container with
# no error at all. \`docker compose run\` forwards its OWN stdin into the
# container by default, even without a real TTY — and here, that stdin IS
# the rest of THIS heredoc (bash -s reads its script from stdin). Every
# command after this line was being silently consumed/discarded as
# migrate's stdin before its container exited, so \`docker compose up -d
# api\` (and, once added, --force-recreate + the image-match assertion
# below) never actually ran — not a Compose change-detection quirk as first
# suspected, the commands simply never reached bash at all. \`-T\` disables
# TTY allocation (the documented flag for scripted/automated use); the
# explicit redirect makes it physically impossible for the container to
# read any of the remaining heredoc regardless of that flag's exact
# behaviour — belt-and-suspenders on the fix that actually matters here.
docker compose run --rm -T migrate < /dev/null

# Rolling restart, not simultaneous — the entire point of a second replica
# (§16 TODO #13) is zero-downtime deploys. Recreating both containers at once
# would recreate the SAME all-at-once outage a single replica has, just with
# extra infrastructure. Bring up api2 first and wait for DOCKER'S OWN
# healthcheck (not just a single curl) to report healthy before touching
# api — nginx's upstream (least_conn, deploy/nginx/gradeassist.conf) always
# has at least one live backend to route to throughout.
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

# --force-recreate: never rely on Compose's own diffing deciding a recreate
# is warranted; force it unconditionally (found 2026-08-15 that Compose's
# change-detection was NOT actually the mechanism at fault that day, but this
# stays as defense-in-depth regardless — see the stdin-eating fix above for
# what the real bug was).
docker compose up -d --force-recreate api2
wait_healthy ispum-api-2
echo "  ✓ api2 healthy — recreating api…"
docker compose up -d --force-recreate api
wait_healthy ispum-api
echo "  ✓ api healthy"

# Belt-and-suspenders: assert BOTH containers are ACTUALLY running what we
# just told them to run, and fail loudly rather than silently serve stale
# code on one replica if it somehow still doesn't match.
EXPECTED_IMAGE="cr.yandex/${YC_REGISTRY_ID}/ispum-backend:${IMAGE_TAG}"
for name in ispum-api ispum-api-2; do
  ACTUAL_IMAGE="\$(docker inspect "\$name" --format '{{.Config.Image}}')"
  if [ "\$ACTUAL_IMAGE" != "\$EXPECTED_IMAGE" ]; then
    echo "❌ \$name is running \$ACTUAL_IMAGE, expected \$EXPECTED_IMAGE — deploy did not take effect."
    exit 1
  fi
  echo "  ✓ \$name running image confirmed: \$ACTUAL_IMAGE"
done

# Dangling-only (untagged intermediate layers) — never removes a still-tagged
# release, so the previous image tag stays pullable for a manual rollback.
docker image prune -f >/dev/null
REMOTE

echo "▶ [8/9] nginx guard…"
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

echo "▶ [9/9] Verifying health…"

# AUTHORITATIVE check — runs ON the VM, so it can't be fooled by the laptop's
# network. This is the hard gate: if the public site is truly down, this fails.
#   - local Node health (the API process is up)
#   - public TLS from the VM itself (nginx → bucket/API path works)
#
# FOUND 2026-08-15, during the first live container cutover: `curl ... &&
# echo` looks like it gates under `set -e`, but it doesn't — POSIX explicitly
# exempts "any command of an AND-OR list other than the last" from -e, so a
# failing curl here (not the last command in its `&&` list — echo is) never
# aborted the script. deploy.sh printed "✅ Deploy complete" while the API
# was actually down (a PM2/container port conflict that morning) and curl
# was failing outright. Rewritten as explicit `if ! cmd; then exit 1; fi` —
# the one construct `set -e` genuinely does NOT trigger on (a command inside
# an `if` condition), used here on purpose and correctly, rather than by the
# accident the old `&&` form was.
#
# The local check RETRIES (up to 30s) rather than firing once immediately —
# `docker compose up -d` returns as soon as the container is CREATED, not
# once the Node process inside has actually bound the port; a single
# immediate curl can false-negative on a legitimately slow cold start (DB
# pool connect, migrations already ran but the process itself still has
# module-load work to do). On genuine failure it now dumps the container's
# own recent logs INLINE — today's incident took ~10 back-and-forth messages
# to get from "curl failed" to "here's the actual crash reason"; that
# diagnosis should happen automatically, in the deploy's own output, not in
# a follow-up SSH round trip.
#
# Checks BOTH replicas directly (127.0.0.1:3000 and :3001), not just via
# nginx's upstream — nginx would happily report healthy off ONE working
# replica while the other silently failed its own rolling recreate earlier in
# [6/8]. This is the check that would actually catch that.
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
      echo "  ✗ API on :${port} (local) — FAILED after 30s. Recent container logs:"
      name=$([ "$port" = "3000" ] && echo ispum-api || echo ispum-api-2)
      docker logs "$name" --tail=30 2>&1 | sed "s/^/    /"
      exit 1
    fi
    echo "  ✓ API on :${port} (local)"
  done
  if ! curl -fsS --max-time 10 https://ispum.ru/api/health >/dev/null; then
    echo "  ✗ API (public, from VM) — FAILED"; exit 1
  fi
  echo "  ✓ API (public, from VM)"
  if ! curl -fsS --max-time 10 -o /dev/null https://ispum.ru/; then
    echo "  ✗ frontend (from VM) — FAILED"; exit 1
  fi
  echo "  ✓ frontend (from VM)"
'

# ── Version assertion ────────────────────────────────────────────────────────
# The checks above prove the API *answers*. They do not prove it is the API we
# just deployed — and that is the difference between "the site is up" and "the
# deploy worked". A container that was never recreated answers every one of
# them perfectly while serving last week's code.
#
# That is not a hypothesis. On 2026-09-05 the frontend was live four commits
# ahead of both API replicas (still on 1.5.0-4ec30f9, "Up 10 hours"), and the
# routes the new UI called returned 404 to real users. Every health check
# passed throughout, because the old API was perfectly healthy.
#
# The image guard at [2/9] catches the "image was never built" cause. This
# catches all the others — an interrupted run, a recreate that silently didn't
# take, a stale tag — by asking the one question that actually matters: is the
# thing serving traffic the thing we just shipped?
echo "▶ Confirming both replicas are serving ${SHORT_SHA}…"
if ! ssh "$VM_HOST" "set -e
  for port in 3000 3001; do
    live=\$(curl -fsS --max-time 5 \"http://127.0.0.1:\${port}/api/health\" | sed -n 's/.*\"version\":\"\([^\"]*\)\".*/\1/p')
    case \"\$live\" in
      *${SHORT_SHA}*) echo \"  ✓ :\${port} serving \$live\" ;;
      *) echo \"  ✗ :\${port} is serving '\$live', expected ${SHORT_SHA}\"; exit 1 ;;
    esac
  done"; then
  echo "❌ A replica is not running the version this deploy shipped."
  echo "   The frontend IS live and now calls an API that may not have its routes —"
  echo "   users will see 404s. Re-run the deploy, or roll the frontend back:"
  echo "     deploy/rollback.sh"
  exit 1
fi

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
