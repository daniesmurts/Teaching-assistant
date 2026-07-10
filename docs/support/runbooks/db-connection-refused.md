---
id: db-connection-refused
symptoms:
  - error_code: DB_UNAVAILABLE
  - log_pattern: "ECONNREFUSED"
  - user_report: "сайт не отвечает" / "ошибка на всех страницах"
severity: critical
auto_fixable: false
fix_commands: []
verification: "GET https://ispum.ru/api/health returns status: ok"
escalate_if: "always — this is a full outage, needs human eyes even if PostgreSQL restart fixes it"
---

## Diagnosis
`backend/src/middleware/errorHandler.ts` catches `ECONNREFUSED` from the pg
pool and returns 503 `DB_UNAVAILABLE` on every request that touches the DB —
in practice, all of them. Confirm with:
```
ssh <vm> "systemctl status postgresql"
```
Most likely causes on the one-VM setup: Postgres crashed/OOM'd, or the VM
itself ran out of memory and the OOM killer took Postgres first (it's usually
the largest resident process).

## Fix
```
ssh <vm> "sudo systemctl restart postgresql"
```
Then check `pm2 status` — the API workers will have been logging
`ECONNREFUSED` in a loop but don't crash-restart themselves (pool errors are
caught, not thrown), so no PM2 restart should be needed once Postgres is back.

## Prevention
If this recurs, check `free -h` on the VM during the incident window — if
Postgres is getting OOM-killed, `docs/ops/vm-tuning.md` has the memory sizing
guidance; the fix is lowering `shared_buffers`/`work_mem` or bumping the VM,
not restarting Postgres repeatedly.
