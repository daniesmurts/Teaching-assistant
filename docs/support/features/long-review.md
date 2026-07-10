# Long review (ВКР / thesis map-reduce review)

**Route(s):** `POST /api/grading/review` (async, poll-based) → `services/longReview.ts`
**Queue:** pg-boss (`services/longReviewWorker.ts`), 2 retries with backoff, 30-min expiry per attempt
**Trigger threshold:** documents >120k chars route through this map-reduce pipeline instead of single-pass grading

## Common issues
- **Progress bar stuck / "проверка зависла"** — see `runbooks/long-review-stuck.md`. Usually a normal in-flight retry, not actually stuck; check `long_reviews.status` and the pg-boss job table before assuming a bug.
- **Drawing (чертёж) cross-check missing findings** — `analyzeDrawing()` is purely extractive (summary + verbatim key quantities); it does not itself flag contradictions. Contradictions come from Tier-2 (`findInconsistencies`) and Tier-5 (`findPremiseIssues`) consuming the drawing's pseudo-section alongside the ПЗ text — if a known dimension mismatch isn't flagged, check whether the OCR actually extracted the number correctly first (bad OCR on a drawing is far more common than a pipeline miss).
- **Review completes but a whole tier's findings are empty** — each tier operates on `analyses: SectionAnalysis[]`; an empty tier usually means the document didn't have content matching that tier's target (e.g. `findRecomputations` needs an actual derivable formula) rather than a failure — check the review's status is `completed`, not `failed`, before treating an empty section as a bug.

## Error codes this feature can surface
- Same `AI_SERVICE_ERROR` / `SPEND_CAP_EXCEEDED` as regular grading — long review makes many more LLM calls per run (6 tiers × N chapters), so it hits a spend cap far sooner than a single grade would if a teacher is close to their monthly limit.
- No dedicated error code for "failed after retries" — `long_reviews.status = 'failed'` with a stored message is how that surfaces; there's no AppError thrown to the client since this is async/poll-based, not a synchronous request.

## Plan-tier gotchas
- This is a Pro+ feature — Free-tier teachers uploading a >120k-char document should be blocked by the plan gate before reaching the queue at all; if a Free-tier long review somehow gets queued, that's a gating bug worth escalating, not a normal support issue.
