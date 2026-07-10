# Support — how production issues get caught and fixed

This is the operational counterpart to `FEATURES.md` / `CHANGELOG.md` / `TODO.md`.
Those track what's built; this tracks what breaks and how it gets handled.

## Signal sources

| Signal | Detects | Where it goes |
|---|---|---|
| **Uptime Kuma** | VM/process down, `/api/health` failing (DB unreachable) | Telegram (Kuma's own notifier) |
| **`errorHandler` → Telegram** (`backend/src/lib/telegramAlert.ts`) | Unhandled 500s and `DB_UNAVAILABLE` from any request, per-code, rate-limited to 1 per 15 min | Telegram |
| **`production_incidents` table** (migration `072`) | Same events as above, persisted with path/method/teacher/stack | Queryable — per-client blast radius, future agent input |
| **Client-reported issues** | Whatever a teacher emails/messages about | Not yet structured — see TODO below |
| **Nightly backup script** (`npm run backup:db`) | Confirms the backup itself succeeded/failed | Telegram — treat a missing nightly "✅" as an incident |

Kuma catches "the app is down." The Telegram alerter + incidents table catch
"the app is up but this one route/feature is broken," which black-box uptime
probing can't see. Both currently point at the same Telegram chat — keep it
that way so there's one inbox, not several to check.

**Health endpoint:** `GET /api/health` (checks DB with `SELECT 1`, skipped by
the general rate limiter) — point a Kuma HTTP(s) monitor at
`https://ispum.ru/api/health` with a keyword check for `"status":"ok"`.

## Triage flow

1. Telegram alert or Kuma notification arrives.
2. Check `production_incidents` for the code (`SELECT * FROM production_incidents WHERE code = '<code>' ORDER BY created_at DESC LIMIT 20;`) — is this a one-off or hitting multiple teachers/institutions?
3. Check `runbooks/` for a matching file (match on `error_code`, `log_pattern`, or symptom description in the frontmatter).
4. If a runbook exists and its fix applies, follow it, then mark the incident resolved:
   `UPDATE production_incidents SET resolved_at = NOW() WHERE id = '<id>';`
5. If no runbook exists, fix it, then **write the runbook** — see `runbooks/README.md` for the format. Every escalation should leave the known-issue surface a little bigger; this is what makes automation (see below) tractable later.

## Known issues

See `KNOWN_ISSUES.md` for currently-open issues and their workarounds — check
this before triaging a new report in case it's a duplicate.

## Feature docs

`features/` holds one file per shipped feature: what it does, common
teacher-facing errors, and plan-tier gotchas. Not a duplicate of `FEATURES.md`
(which tracks *what's built*) — this tracks *what goes wrong and why* from a
support perspective. Fill these in as issues come up rather than trying to
front-load all ~45 pages/features at once; a runbook you needed is worth more
than a feature doc you didn't.

## Where this is headed (not built yet)

The end goal is an agent that watches `production_incidents` (or is triggered
directly by the Telegram alert / Kuma webhook), matches the failure against
`runbooks/*.md` frontmatter, and either:
- runs the runbook's whitelisted `fix_commands` and verifies, or
- escalates to Telegram with a diagnosis and a drafted new runbook.

Do not build the auto-fix half until there's a real backlog of runbooks with
`auto_fixable: true` — an agent with no known fixes to apply is just a
worse version of the Telegram alert that already exists.
