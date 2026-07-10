---
id: disk-full
symptoms:
  - log_pattern: "ENOSPC"
  - error_code: INTERNAL_ERROR
  - user_report: "не могу загрузить файл" (uploads specifically start failing)
severity: high
auto_fixable: true
fix_commands:
  - "df -h"
  - "du -sh /var/log/gradeassist/* /var/www/gradeassist/backend/uploads/* 2>/dev/null | sort -rh | head -20"
  - "pm2 flush gradeassist-api"
verification: "df -h shows headroom again; a test upload succeeds"
escalate_if: "the largest consumer is the uploads directory itself, not logs — that's real usage growth, not a leak, and needs a storage-size decision, not a cleanup"
---

## Diagnosis
Two things on this VM can fill the disk over time: PM2/pino logs
(`/var/log/gradeassist/`) growing unbounded, or local file uploads if
`YANDEX_STORAGE_ACCESS_KEY` was ever unset (`config.ts` warns about this at
startup — "object storage (files saved to local ./uploads)" — meaning
uploads that should be going to Yandex Object Storage are landing on local
disk instead).

## Fix
If logs are the culprit: `pm2 flush gradeassist-api` clears PM2's own log
buffers. For the raw files in `/var/log/gradeassist/`, truncate rather than
delete while PM2 has them open (`: > /var/log/gradeassist/out.log`), and set
up `logrotate` for `/var/log/gradeassist/*.log` if it isn't already
configured, so this doesn't recur.

If local uploads are the culprit: confirm `YANDEX_STORAGE_ACCESS_KEY` /
`YANDEX_STORAGE_SECRET_KEY` are actually set in the VM's `.env` — if they're
missing, every upload has been falling back to local disk since whenever
that was unset, and it'll keep filling up until Object Storage is configured.

## Prevention
`logrotate` config for `/var/log/gradeassist/*.log` if not already present;
a Kuma disk-usage monitor (if supported) or a cron `df` check would catch
this before it becomes an outage.
