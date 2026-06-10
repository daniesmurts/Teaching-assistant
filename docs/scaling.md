# ИСПУМ — Scaling notes

Living doc tracking known bottlenecks and the threshold at which each becomes
a real problem. Update this when you hit a new tier of usage, or knock items off
as you fix them.

**Current capacity targets:**
- ≤ 100 active users — current setup handles fine
- ≤ 1000 users — handled by Tier 1 + VM tuning (see below)
- ≤ 10,000 users — needs the Tier 2 items below

---

## ✅ Done (Tier 1 — fixes already applied)

These ship in the unreleased batch as of 2026-06.

| Fix | Where | Why |
|---|---|---|
| Pool `max=25`, query/conn timeouts | `backend/src/db/connection.ts` | Default `max=10` saturates at ~50 concurrent users |
| Migration 016 — `(teacher_id, created_at DESC)` index on assignments | `backend/migrations/016_assignments_perf.sql` | Журнал history query did Seq Scan + Sort |
| PM2 cluster mode, `instances: 2` | `backend/ecosystem.config.js` | Single Node worker only used 1 of 2 vCPUs |
| Scheduler gated to worker 0 only | `backend/src/services/renewals.ts` | Cluster mode would otherwise fire renewals/reconciliation twice |
| Postgres config tuned for 2 GB | `docs/ops/vm-tuning.md` (one-time VM ops) | Default `shared_buffers=128MB` is too small |
| `pm2-logrotate` configured | `docs/ops/vm-tuning.md` (one-time VM ops) | Logs would fill the 20 GB disk |

---

## 🟡 Tier 2 — bites at 1000+ users, fix when you start to feel it

### Rate-limit store is in-process

**Symptom:** Now that PM2 runs 2 workers, rate-limit counters are per-worker.
Effective limits double (each user can do 60 AI requests/hour instead of 30 by
hitting different workers).

**Fix:** add `rate-limit-redis` + tiny Redis instance.
- Yandex Cloud Managed Redis (cheapest tier) or local Redis on the VM
- ~30 MB RAM footprint
- Change in `backend/src/middleware/rateLimits.ts`: `store: new RedisStore({ client })`

**Trigger:** when you see rate-limit-related complaints, OR before going to 3+ workers.

### Fire-and-forget emails have no retry

**Symptom:** Every email (welcome, password reset, invite, owner notification) is
`sendEmail(...).catch(() => null)`. If Unisender Go has a 30-minute outage, every
email in that window is silently lost. At 1000 users, that's dozens of failed
password resets per outage — users email you "почему не пришла ссылка?"

**Fix:** small outbox pattern:
1. New table `email_outbox` (to, subject, html, text, status, retries, last_error, created_at)
2. `sendEmail()` writes a row immediately, returns
3. Background worker (every 30s, on worker 0 only) sends pending rows, retries up to 5x
4. Rows older than 7 days get archived

~200 lines of code.

**Trigger:** as soon as you have any institutional clients depending on transactional email.

### pgvector ivfflat lists=100

**Symptom:** `assignments_embedding_idx` was set with `lists = 100` in migration 001.
Heuristic: `lists ≈ sqrt(num_rows)`. At 100k assignments this is too few → slow
nearest-neighbor on RAG retrieval (the few-shot examples for grading).

**Fix:**
```sql
REINDEX INDEX assignments_embedding_idx;
-- Or drop + recreate with new list count:
DROP INDEX assignments_embedding_idx;
CREATE INDEX assignments_embedding_idx ON assignments
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 316);
```

**Trigger:** when `SELECT count(*) FROM assignments WHERE embedding IS NOT NULL > 50000`.

### Grading is synchronous (60s)

**Symptom:** `/api/grading/grade` holds the HTTP request open until DeepSeek
returns. At 30 concurrent grades, that's 30 open sockets. Together with the
DB pool (now `max=25` per worker), bursts can deadlock.

**Mitigation in place:** pool fix #1 handles this for 1000-user scale.

**Fix later:** convert grading to async job + poll (like long-review). Bigger UX
change because the result screen needs to wait + show a spinner. Worth doing
when grading-during-peak becomes a complaint.

**Trigger:** if you see HTTP 5xx during exam season or 4xx rate-limit responses
from `/grade` specifically.

### Migration 011 missing index on feedback(teacher_id)

Same FK gotcha as assignments — `feedback(teacher_id)` has the FK constraint but
no index. The admin feedback view does `ORDER BY created_at DESC LIMIT 100`
across all teachers, which is fine. But a per-teacher feedback page (not built
yet) would Seq Scan.

**Fix:** add to a future migration if you ever build per-teacher feedback views.

**Trigger:** only when per-teacher feedback view is planned.

---

## 🔴 Tier 3 — architectural, ~10k users or first signs of trouble

### Postgres is on the same VM as the API

**Trigger:** when Postgres CPU or RAM is consistently >70%, or when API restarts
cause noticeable downtime for DB queries too.

**Fix:** move Postgres to **Yandex Cloud Managed PostgreSQL** (RU, automatic
backups, automatic failover). Update `DATABASE_URL` and rotate.

### Single VM = single point of failure

**Trigger:** when 5-minute downtime starts costing real money / customers.

**Fix:**
- API behind Yandex Load Balancer
- 2+ VMs (or use Yandex App Hosting / k8s)
- Shared Redis (already in place if you did Tier 2 fix #1)
- Managed Postgres (Tier 3 fix #1)

### File uploads buffered in RAM (`multer.memoryStorage()`)

**Symptom:** 20 MB max × 30 simultaneous uploads = 600 MB transient RAM.

**Fix:** switch to `multer.diskStorage()` writing to `/tmp`, or stream-pipe directly
to Yandex Object Storage. Bigger change but eliminates the memory spike.

**Trigger:** if you see Node memory restarts during peak upload times.

---

## 📊 What to monitor as you grow

Set up alerts on:

| Metric | Threshold | Tool |
|---|---|---|
| API response time p95 | > 2s | uptime monitor (e.g. UptimeRobot, BetterStack) |
| Postgres `pg_stat_activity` connection count | > 80 | Yandex Cloud Monitoring or custom dashboard |
| VM RAM usage | > 80% | Yandex Cloud Monitoring |
| Disk usage | > 70% | Yandex Cloud Monitoring |
| `assignments` table size | > 50k rows | manual quarterly check, pgvector reindex trigger |
| Daily DeepSeek cost | > $5 | check admin overview daily during ramp-up |
| Failed login rate | > 10/min | could indicate brute force despite rate limiter |

---

## Architectural wins that age well (already in place)

- **JWT stateless auth** — scales horizontally without session store
- **Fire-and-forget patterns** for non-critical side effects (emails, embeddings, usage logs)
- **Idempotent payment fulfillment** — webhook + reconciliation can both fire safely
- **Async long-review pipeline** — already job-based with polling
- **External AI provider** (DeepSeek) — no GPU bills, no model maintenance
- **Static frontend on CDN** — no API load for marketing pages
- **All hot tables indexed on primary access pattern** (after migration 016)

These mean the bottlenecks above are mostly **config and infrastructure**, not
architectural debt. The codebase will get you to 10k users with the Tier 2 fixes.
