import { readFileSync } from 'fs'
import { join } from 'path'

// Populated by deploy.sh as `{semver} ({date}+{git short SHA})` — e.g.
// `1.5.0 (2026-07-14+a1b2c3d)` — and rsynced to the VM as a repo-root VERSION
// file. The semver comes from the root package.json and is the number
// customers and support matrices refer to; the date+SHA identifies the exact
// build (see docs/on-prem-deployment.md §7.4). Read once at startup rather
// than per-request. Absent locally (dev), hence the fallback.
//
// Uses process.cwd() rather than __dirname: both `npm run dev` (tsx) and the
// production start command (`node …/dist/backend/src/index.js`, pm2 `cwd` set
// to the backend/ dir) are invoked with cwd = backend/, so `../VERSION` is the
// repo root in both — unlike __dirname, which differs between the flat dev
// source layout and tsc's rootDir="../" nested dist/backend/src output.
let cached: string | null = null

export function getBuildVersion(): string {
  if (cached !== null) return cached
  try {
    cached = readFileSync(join(process.cwd(), '../VERSION'), 'utf8').trim()
  } catch {
    cached = 'dev'
  }
  return cached
}
