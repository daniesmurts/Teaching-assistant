---
id: pm2-crash-loop
symptoms:
  - log_pattern: "Uncaught exception"
  - log_pattern: "restart_count"
  - user_report: "сайт то работает, то нет" (intermittent, not fully down)
severity: high
auto_fixable: true
fix_commands:
  - "pm2 logs gradeassist-api --lines 100 --nostream"
  - "pm2 restart gradeassist-api"
verification: "pm2 status shows both workers online with a stable (non-incrementing) restart count for 5+ minutes; GET /api/health returns ok"
escalate_if: "restart count keeps climbing after a manual restart — the crash is deterministic (bad deploy), not transient"
---

## Diagnosis
`backend/src/index.ts` calls `process.exit(1)` on any `uncaughtException` —
by design, so PM2 restarts into a clean process rather than continuing with
corrupted state (`max_memory_restart: 512M` in `ecosystem.config.js` triggers
the same pattern on a memory leak). One restart is normal operation. A *loop*
(restart count climbing every few seconds/minutes) means something on startup
or on every request is throwing.

Read the actual exception before restarting again — `pm2 logs` output or
`/var/log/gradeassist/error.log` (pino JSON, one exception per crash).

## Fix
If the log shows a one-off (e.g. a transient LLM timeout that slipped past
error handling): `pm2 restart gradeassist-api` is sufficient.

If the log shows the same stack trace on every restart: this is a bad
deploy, not a transient issue — do **not** keep restarting, see `escalate_if`.

## Prevention
Whatever the deterministic exception was should get a proper `AppError` catch
in the route/service that threw it, so it becomes a normal request-level 500
instead of taking the whole worker down.
