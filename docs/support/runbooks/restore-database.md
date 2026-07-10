---
id: restore-database
symptoms:
  - error_code: DB_UNAVAILABLE
  - user_report: "данные пропали" / bad migration / accidental DROP or DELETE
severity: critical
auto_fixable: false
fix_commands: []
verification: "GET /api/health returns ok; spot-check a few known teachers/assignments exist and look correct"
escalate_if: "always — restoring production from backup is a judgment call every time, never run unattended"
---

## What backs this up

`scripts/backupDatabase.ts` (`npm run backup:db`, cron nightly — see setup below)
runs `pg_dump -Fc --no-owner --no-privileges` and uploads the dump to a
**dedicated** Object Storage bucket (`BACKUP_STORAGE_BUCKET` — not the same
bucket as file uploads; separate failure domain). It reports success or
failure to Telegram every run — **if you stop seeing the nightly "✅
резервная копия" message, treat that as an incident itself**, not just a
missed backup.

Retention is **not** application logic — the upload credentials should be
write-only (Yandex `storage.uploader` role, no delete permission) so that a
compromised VM can't destroy backup history along with the live data.
Instead, set a **bucket lifecycle rule** once in the Yandex Cloud console
(Object Storage → bucket → Lifecycle rules → expire objects after N days,
e.g. 35) to bound storage cost. This means old backups age out on their own;
if you need longer retention than the lifecycle rule allows, manually copy a
dump you want to keep to a different prefix/bucket before it expires.

## One-time setup (do this before you need it)

1. Create the backup bucket + a write-only service account in the Yandex
   Cloud console (separate from the uploads bucket's account).
2. Set `BACKUP_STORAGE_BUCKET` / `BACKUP_STORAGE_ACCESS_KEY` /
   `BACKUP_STORAGE_SECRET_KEY` in the VM's `.env` (see `.env.example`).
3. Set the bucket lifecycle rule (expire after ~35 days).
4. Cron it:
   ```
   crontab -e
   0 3 * * * cd /var/www/gradeassist/backend && npm run backup:db >> /var/log/gradeassist/backup.log 2>&1
   ```
5. **Run it once manually** (`npm run backup:db`) and confirm the Telegram
   message arrives — don't wait for 3am to find out it's misconfigured.
6. Also set a **Yandex Compute Cloud disk snapshot schedule** (Compute Cloud
   → VM → Disks → snapshot schedule, weekly, keep 2–3) — this covers "the
   whole VM died," which a database-only dump doesn't; the two are
   complementary, not redundant.

## Restore procedure

**Never restore directly onto the live production database as your first
move.** Restore into a scratch database, verify it looks right, and only
then decide how to bring it into production (which is usually "swap
`DATABASE_URL`," not "restore over the live DB").

1. **Pull the dump** you want from the backup bucket (via `yc` CLI, the
   Yandex console, or any S3-compatible client pointed at
   `BACKUP_STORAGE_ENDPOINT`/`BACKUP_STORAGE_BUCKET`).

2. **Create a scratch database** and restore into it:
   ```
   createdb -U gradeassist_user gradeassist_restore_test
   pg_restore -U gradeassist_user -d gradeassist_restore_test --no-owner --no-privileges ispum-<timestamp>.dump
   ```
   `pg_restore` must be the same major version as the `pg_dump` that made the
   file (both are v15 on the production VM per `deploy/vm-setup.sh` — this
   only bites you if you're testing from a dev machine with a different
   Postgres version installed).

3. **Sanity-check the restore** before trusting it:
   ```sql
   SELECT COUNT(*) FROM teachers;
   SELECT COUNT(*) FROM assignments WHERE status = 'approved';
   SELECT MAX(created_at) FROM assignments;   -- confirms how stale this dump is
   ```

4. **Decide the recovery path** based on what actually happened:
   - *Whole DB corrupted/lost*: stop the app (`pm2 stop gradeassist-api`),
     rename or drop the broken `gradeassist` database, rename
     `gradeassist_restore_test` to `gradeassist`, restart the app.
   - *One bad migration/DELETE*: don't restore the whole DB — instead,
     `pg_restore -t <table_name>` the affected table(s) only from the
     scratch DB into production, or hand-write a corrective SQL statement
     using the scratch DB as a reference. Restoring the whole database loses
     every legitimate write since the backup, which is very often worse than
     the original problem.

5. **After any restore**, check `production_incidents` and
   `activation_nudges` for gaps during the outage window, and post to the
   Telegram channel what was restored and the data-loss window (backups are
   nightly, so worst case is ~24h of lost writes — grades, approvals,
   payments — teachers affected in that window may need to be told directly).

6. Drop the scratch database once you're done:
   `dropdb gradeassist_restore_test`.

## Prevention

Run this restore procedure as a **quarterly drill**, not just when something
breaks — an untested backup is a hope, not a backup. Note how long the drill
takes; that's your real recovery time, not an estimate.

A recurring reminder for this is already scheduled (Claude scheduled task
`ispum-quarterly-restore-drill`, fires Jan/Apr/Jul/Oct 1st) — it walks through
this exact procedure interactively. If that task is ever deleted or the
schedule changes, update this note.

## Status

- ✅ Nightly backup live on the production VM (cron: `0 3 * * *`,
  `npm run backup:db`), reporting to Telegram.
- ✅ `gradeassist-backups` bucket created with a write-only service account
  and a 35-day lifecycle expiry rule.
- ✅ First restore drill completed 2026-07-10: 14 teachers, 30 approved
  assignments, dump verified restorable into a scratch DB created from
  `template0` (not the default template — see note below).
- ✅ Yandex Compute disk snapshot schedule confirmed (`default-daily-schedule`,
  daily at 02:45, retention: last 14 snapshots) **with the production VM's
  boot disk actually attached** as of 2026-07-10 — covers whole-VM loss,
  which the DB dump alone doesn't. Caught in passing: the schedule showed
  status **Active** with **zero disks attached**, i.e. it had never actually
  snapshotted anything despite looking configured — don't trust the
  "Active" badge alone on a snapshot schedule, check the disk list on its
  Обзор page.
- Note from the first drill: always create the scratch database with
  `createdb -T template0 ...`, not the plain default template — a restore
  into a fresh `createdb gradeassist_restore_test` hit ~364 "already exists"
  conflicts the first time, most likely from a stale/duplicate scratch DB
  left over from an earlier attempt rather than genuine `template1`
  contamination (confirmed clean on inspection). Using `template0`
  sidesteps the ambiguity entirely and restored cleanly.
