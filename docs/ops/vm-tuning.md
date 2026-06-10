# VM tuning — one-time ops checklist

Run these on the production VM (`93.77.161.62`, Ubuntu 24.04, 2 vCPU / 2 GB RAM).
You only need to do this **once** — it makes the existing box handle 1000 users without
breaking. None of these require code changes; they pair with the application-side
fixes already in the codebase (`db/connection.ts`, `ecosystem.config.js`, migration 016).

---

## 1. Postgres tuning for 2 GB RAM

Default Postgres ships with `shared_buffers = 128MB` — way too low for 2 GB. The
following picks safe values for your VM. Larger VM → rerun with bigger numbers.

```bash
sudo nano /etc/postgresql/15/main/postgresql.conf
```

Set / change these lines (find them with Ctrl-W):

```ini
# Memory
shared_buffers          = 512MB     # ~25% of RAM
effective_cache_size    = 1GB       # what PG assumes the OS will cache
work_mem                = 16MB      # per-sort/hash; keep modest with many connections
maintenance_work_mem    = 128MB     # for vacuum / index builds

# Connections
max_connections         = 100       # default; pool max=25 × 2 workers leaves headroom

# WAL / write performance
wal_buffers             = 16MB
checkpoint_completion_target = 0.9

# Parallelism (you have 2 vCPU)
max_parallel_workers_per_gather = 2
max_worker_processes    = 8
max_parallel_workers    = 4

# Logging — keep modest in size
log_min_duration_statement = 1000   # log queries slower than 1s
log_line_prefix         = '%t [%p]: '
```

Restart Postgres:

```bash
sudo systemctl restart postgresql
sudo systemctl status postgresql | head -3
```

Sanity check that it came up:

```bash
sudo -u postgres psql -c "SHOW shared_buffers; SHOW max_connections;"
```

---

## 2. Log rotation via `pm2-logrotate`

PM2 writes to `/var/log/gradeassist/{out,error}.log` with **no rotation**. Without this,
disk fills within weeks at scale and the server stops responding.

```bash
sudo pm2 install pm2-logrotate
sudo pm2 set pm2-logrotate:max_size 10M
sudo pm2 set pm2-logrotate:retain 7
sudo pm2 set pm2-logrotate:compress true
sudo pm2 set pm2-logrotate:rotateInterval '0 0 * * *'   # daily at midnight
sudo pm2 save
```

Confirm:

```bash
pm2 conf pm2-logrotate
```

---

## 3. Apply the PM2 cluster mode change

The `ecosystem.config.js` change to `instances: 2` requires a **full restart**
(`pm2 reload` does NOT switch fork → cluster mode).

```bash
cd /var/www/gradeassist/backend
sudo pm2 delete gradeassist-api
sudo pm2 start ecosystem.config.js --env production
sudo pm2 save
pm2 list   # should show 2 instances of gradeassist-api
```

---

## 4. Verify connection pool sees the migration

After deploying the code changes and applying migration 016:

```bash
psql "$(grep -m1 '^DATABASE_URL=' /var/www/gradeassist/.env | cut -d= -f2-)" -c \
  "\d assignments" | grep -i idx
```

You should see `assignments_teacher_created_idx`, `assignments_course_created_idx`,
`assignments_pending_idx` in the list.

---

## 5. (Optional, do later) Bump to 4 GB VM

Before you hit ~100 active concurrent users, bump the Yandex Cloud VM from 2 → 4 GB.
This is the single biggest scale win and costs ~$8/month more. Yandex Cloud is hourly
billing, so you can size up live without downtime (instance restart only).

When you do, rerun **section 1 above** with bigger values (e.g. `shared_buffers = 1GB`,
`effective_cache_size = 2.5GB`, `DB_POOL_MAX=40`).

---

## 6. Health check after the changes

```bash
# API
curl -s https://ispum.ru/api/health

# Both PM2 workers alive
pm2 list

# Postgres connections in use
psql "$(grep -m1 '^DATABASE_URL=' /var/www/gradeassist/.env | cut -d= -f2-)" -c \
  "SELECT count(*) FROM pg_stat_activity;"
```

If anything looks wrong, full rollback:

```bash
sudo pm2 delete gradeassist-api
# Edit ecosystem.config.js back to instances: 1, exec_mode: 'fork'
sudo pm2 start ecosystem.config.js --env production
```
