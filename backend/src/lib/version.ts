import { readFileSync } from 'fs'
import { join } from 'path'

// Populated by deploy.sh as `{date}+{git short SHA}` (e.g. 2026-07-14+a1b2c3d) and
// rsynced to the VM as a repo-root VERSION file — see deploy.sh. Read once at
// startup rather than per-request. Absent locally (dev), hence the fallback.
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
