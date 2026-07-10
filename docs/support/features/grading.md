# Grading

**Route(s):** `frontend/src/pages/Grading.tsx` → `POST /api/grading` (`backend/src/routes/grading.ts`)
**Core logic:** `services/grading.ts` (`gradeOnce` is pure — no DB writes, shared with the eval harness)
**Plan gate:** base grading is available on all tiers; `thorough` (confidence check) and `check_citations` are gated per-call via `canUseFeature(plan_tier, 'confidenceCheck' | 'citationCheck')` — silently disabled (not an error) if the tier doesn't have them, so a Free-tier teacher checking those boxes just won't get the extra passes, with no visible error.

## Common issues
- **"ИИ-сервис временно недоступен" (`AI_SERVICE_ERROR`)** — see `runbooks/llm-provider-down.md`. Only surfaces when DeepSeek itself (the final fallback) fails.
- **Grade never becomes a training signal / doesn't show in RAG retrieval** — expected until the teacher explicitly approves it (`approved_at` set). Per [Non-Negotiable Rule #3](../../../CLAUDE.md), an unapproved AI grade is never used as a retrieval example or write-back signal. Not a bug if the teacher hasn't clicked approve.
- **Citations missing from feedback despite `check_citations` being on** — by design (Rule #2): any quote that can't be validated verbatim against the submission (case/whitespace-insensitive, 8–200 chars) is nulled out rather than shown hallucinated. If citations are *consistently* absent for a specific submission, check the raw submission text extraction first (see `documents.md`, once written) before assuming the citation validator is broken.
- **Feedback references content not in the submission** — should be structurally impossible per Rule #2; if seen, this is a real bug in `validateCitation()`, escalate immediately rather than looking for a runbook.

## Error codes this feature can surface
- `SPEND_CAP_EXCEEDED` (429) — monthly AI-dollar cap hit for the account (`services/spendCap.ts`). Not a plan-tier gate (`upgrade` flag is false) — it's a cost-protection circuit breaker. Fix: a platform admin raises the cap, or it resets next calendar month.
- `AI_SERVICE_ERROR` (503) — see above.
- `VALIDATION_ERROR` (400) — malformed request (missing submission text, invalid criteria).

## Plan-tier gotchas
- Free tier: limited grades/month (`usage_counters.grades_this_month`, enforced in `checkPlan.ts`) — a teacher hitting the cap sees a `PLAN_LIMIT_REACHED`-style error with `upgrade: true`; this is working as intended, not a bug to fix.
- `thorough` / `check_citations` silently no-op on tiers without them rather than erroring — a teacher on Free reporting "I checked the box but nothing extra happened" is expected behavior, not a bug.
