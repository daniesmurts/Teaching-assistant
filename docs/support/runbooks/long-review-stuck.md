---
id: long-review-stuck
symptoms:
  - log_pattern: "Long review job failed"
  - user_report: "проверка ВКР зависла" / progress bar not moving for 30+ minutes
severity: medium
auto_fixable: false
fix_commands: []
verification: "SELECT status, updated_at FROM long_reviews WHERE id = '<id>'; status should be advancing or already 'failed' with a message, not silently stuck 'running'"
escalate_if: "job shows 'failed' in long_reviews but the teacher wasn't shown an error — a gap between failLongReview and the UI"
---

## Diagnosis
The long-review queue (`backend/src/services/longReviewWorker.ts`) is
pg-boss backed with **2 automatic retries** (3 attempts total, exponential
backoff) — a transient LLM blip or a PM2 restart mid-job is expected to
self-heal without any manual action. `expireInSeconds: 1800` (30 min) means
a still-running job isn't marked expired/requeued until 30 minutes in, so a
large ВКР legitimately sitting at "processing" for 10–15 minutes is not
itself a bug.

Check the actual queue state:
```sql
SELECT id, name, state, retrycount, createdon, completedon
FROM pgboss.job WHERE name = 'long-review' ORDER BY createdon DESC LIMIT 10;
```
`failLongReview()` is only called on the **last** retry attempt — so
`long_reviews.status = 'failed'` with a message means all 3 attempts
genuinely failed; anything before that is a normal in-flight retry, not
stuck.

## Fix
If retries are genuinely exhausted (`long_reviews.status = 'failed'`), read
the stored error message — it's usually a document-extraction issue (bad
OCR, corrupted upload) surfaced from `runLongReview`. Ask the teacher to
re-upload; there's no queue-level fix, since pg-boss already retried.

If the job has been in `state = 'active'` for well past 30 minutes with no
`completedon`, pg-boss's own expiry should have already requeued it — if it
hasn't, check pg-boss's maintenance job is still running (`boss.start()` in
`services/jobQueue.ts` — confirm the process didn't die between start and
`registerLongReviewWorker`).

## Prevention
None currently planned — `TODO.md` Improvement #1 tracks the durable-queue
work this already benefits from (PM2-restart-safe via pg-boss).
