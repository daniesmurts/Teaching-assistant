# TODO

Outstanding recommendations from the project review on 2026-06-11. Items
already shipped this session (test suite, quiz generator) live in
[CHANGELOG.md](CHANGELOG.md). Items kept here are ordered by
impact-per-effort, not chronologically.

Each item carries:
- **Why** — what it's actually protecting or unlocking.
- **Effort** — rough sizing (S ≤ 1 day, M ≈ 2–4 days, L ≈ 1–2 weeks).
- **Touches** — top-level files / surfaces that will move.

When you pick one up, move it under `## In progress`. When it ships, move
the line to `CHANGELOG.md` and delete here.

---

## Improvements

### ~~1. Move long reviews onto a real job queue~~ — already done

Shipped: `POST /api/grading/review` now enqueues onto pg-boss
(`services/jobQueue.ts`, `services/longReviewWorker.ts`) instead of running
`runLongReview` fire-and-forget in-process — a PM2 restart mid-job no longer
orphans the work; pg-boss persists the job as a Postgres row before the 202
response and picks a still-running job back up via retry (retryLimit 2,
30-minute expiry) if the process dies mid-attempt, with a dead-letter queue
after retries are exhausted. `runLongReview` now throws on failure (was:
swallowed internally) so pg-boss's retry machinery actually sees it;
`long_reviews.status = 'failed'` is written only on the last attempt, so the
UI doesn't flash "failed" before a silent retry. Retries re-run the whole
pipeline from scratch — no section-level checkpointing in v1; a natural
follow-up if retry-from-scratch proves too costly for the common failure
modes (transient provider blip, restart) it's actually solving for. pg-boss
v10.4.2 pinned (not the current v12, which is ESM-only and incompatible with
this CommonJS-compiled backend); no new migration needed — pg-boss manages
its own schema. Same infra now powers bulk grading (feature below) without
bespoke plumbing when that ships. See CHANGELOG for the full design.

### ~~2. Audit grade changes after approval~~ — already done

Already shipped: `approved_revisions` table (migration `038_asset_hardening.sql`)
gets a new row on every `approveAssignment()` call, written in the same
transaction as the update (app-level, not a Postgres trigger, but same
guarantee). Exposed via `GET /api/grading/assignment/:id/approval-history`
(`findApprovalHistory` in
[db/queries/assignments.ts](backend/src/db/queries/assignments.ts)) and
already rendered in
[AssignmentDetailModal.tsx](frontend/src/components/grading/AssignmentDetailModal.tsx).
No further action needed.

### ~~3. Switch embeddings to a Russian-tuned model~~ — already done

Already shipped: migration `024_yandex_embeddings.sql` moved every embedding
call to Yandex `text-search-doc` (discovered DeepSeek had no `/embeddings`
endpoint at all — every call had been 404ing silently). `llm/registry.ts:embed()`
now routes through Yandex unconditionally, regardless of institution LLM
preference (CLAUDE.md rule #9). No further action needed here.

### ~~4. localStorage hardening for the grading persistence layer~~ — already done

Shipped: took the "encrypt with a key derived from the JWT" option. New
[lib/draftCrypto.ts](frontend/src/lib/draftCrypto.ts) — AES-GCM, key is
SHA-256 of the current JWT (rotates on re-login; old encrypted drafts become
silently unreadable, which is fine since `clearGradingDrafts()` already wipes
them on logout — this is defense-in-depth for the window before that runs,
e.g. a token that expired without an explicit logout). `usePersistedState.ts`
now encrypts on write and decrypts on read; a leftover plaintext entry from
before this shipped is treated as undecryptable and dropped, not crash-read.
No further action needed.

### ~~5. Document re-ingestion lifecycle~~ — already done

Shipped: took the "cascade-delete chunks when replaced" option (simple,
matches `courses.syllabus_text`'s existing overwrite-not-append design).
New `deleteChunksForOtherSyllabusDocuments()`
([db/queries/chunks.ts](backend/src/db/queries/chunks.ts)), called from
[services/documents.ts](backend/src/services/documents.ts)'s
`processDocument` once a replacement syllabus has produced at least one
chunk of its own (never deletes the old ones first — a total embedding
failure on the new upload should leave the stale-but-present old chunks,
not zero). Scoped to `document_type = 'syllabus'` only; `'material'`
documents are untouched — a course accumulates many of those on purpose,
unlike syllabus which is single-source-of-truth by design. No migration
needed — no schema change, just a DELETE query. Old presentations/quizzes
are unaffected since their citations are text snapshots captured at
generation time, not live FKs into `document_chunks`. See CHANGELOG for
the full design.

### ~~6. Onboarding signposting for the criteria model~~ — already done

Shipped: new `components/onboarding/CriteriaHint.tsx`, mirroring the existing
`NoCourseHint.tsx` pattern exactly — a subtle amber link to `/criteria`,
rendered in `GradingForm.tsx` right under the criterion-add select, only when
the teacher has never created a criterion of their own (templates don't
count) and hasn't picked one for the current grade. Deliberately left the
dashboard checklist and `/criteria`'s own empty state untouched — `/criteria`
already had a `FeatureIntro` + template picker + empty-state copy, so the real
gap was purely the missing signpost at the point of contact; a 4th checklist
step risked re-surfacing the dashboard checklist for existing users who'd
already completed and hidden it. See CHANGELOG for the full reasoning.

### ~~7. Real testing for DB-backed paths~~ — already done

Shipped: new `vitest.integration.config.ts` (separate from the pure-function
`vitest.config.ts` — `npm test` stays DB-free) runs 33 tests across 6 files
against a real dedicated test database (`gradeassist_test`), not
Testcontainers or `pg-mem` — Docker isn't available in this environment, and
`pg-mem` doesn't support `pgvector`, a hard blocker for the RAG tests.
`DB_POOL_MAX=1` + `BEGIN`/`ROLLBACK` per test gives transaction-isolated
tests with zero cleanup code. Covers all four named paths: plan-limit
enforcement (`checkPlan.integration.test.ts`, `usageCounters.integration.test.ts`),
the T-Bank webhook (`webhook.integration.test.ts` — the one flow tested at
the true HTTP level via `supertest`, since its wire format is a third-party
contract; `payments.integration.test.ts` for `confirmPayment()` idempotency),
auth/JWT lifecycle (`authenticate.integration.test.ts`, plus pure JWT edge
cases moved to `lib/jwt.test.ts`), and RAG retrieval
(`assignments.rag.integration.test.ts` — including the institution-pool's
double opt-in gating across all four flag combinations). One-time setup:
`npm run test:integration:setup`, then `npm run test:integration`. See
CHANGELOG for the full design and a caught-mid-implementation gotcha (the
`*.integration.test.ts` suffix also matches the default config's glob —
now explicitly excluded).

### ~~8. Token / spend caps per teacher~~ — already done

Shipped: `services/spendCap.ts` enforces a per-teacher monthly USD cap
(not a raw token cap — cost maps directly to the actual risk and varies by
model) centrally in `llm/registry.ts` (`chat`/`chatJSON`), covering every
route and background job through one choke point. Default caps per tier in
[planLimits.ts](backend/src/config/planLimits.ts) (`monthlySpendCapUsd`),
optional per-teacher override (`teachers.monthly_spend_cap_usd`, migration
`062_spend_caps.sql`) settable from the `AdminTeachers.tsx` "Расходы/лимит"
column. See CHANGELOG for the full design (fail-open on infra errors, 60s
cache, `SpendCapExceededError`). No further action needed.

### ~~9. Criterion-level RAG retrieval~~ — already done

Shipped: new `criterion_rag_examples` table (migration `065_criterion_rag_examples.sql`)
— one row per (assignment, criterion), mirroring the `document_chunks`/`chunks.ts`
pattern (own table, own query file `db/queries/criterionExamples.ts`) rather than
denormalizing into `assignments`. Cost-conscious design: criterion feedback is
embedded once at **approval time** (`services/embeddings.ts`'s
`generateCriterionEmbeddings()`, fire-and-forget alongside the existing
whole-assignment embedding call), and grading time reuses the **already-computed
submission embedding** as the query vector — zero new embedding-provider calls per
grade, only cheap local Postgres queries run in parallel across criteria. Matching
is by `LOWER(criterion_name)` (criteria are ephemeral per-assignment snapshots, not
FK-based), rendered as a capped "Похожие прошлые оценки по этому критерию" snippet
under the relevant criterion line in `buildCriteriaPrompt`. No new plan flag — rides
the existing `ragFlywheel` gate. v1 is own-course only (no institution-pool
cross-teacher union) and not threaded through the eval harness's offline replay,
matching the calc-verification precedent of documenting a scope cut rather than
silently expanding it. See CHANGELOG for the full design.

### 10. Don't retry token-truncated LLM responses · Effort: S

`chatJSON`'s parse-and-retry loop (`services/llm/deepseek.ts`, mirrored in
`qwen.ts`/`yandex.ts`) can't tell "model emitted malformed JSON — retry may
help" from "output hit the token ceiling — retrying the identical request is
guaranteed to fail". The presentations incident (2026-07-15, see CHANGELOG)
burned a full doomed second call (~60s + double token cost) on every
truncation before failing. The root cause there is fixed at the source
(`presentationMaxTokens()` + the slide_count_target 40→30 cap), so today this
is a latency/cost optimization for a now-rare path, not a correctness bug.

- **Why** — a truncated response currently costs one wasted LLM call and
  ~30–60s of extra user-facing latency before the error surfaces; it also
  muddies incident forensics (two identical pinned-at-ceiling usage_log rows
  instead of one clearly-labeled truncation error).
- **Cheap v1 (recommended)** — in the DeepSeek provider only: check
  `choices[0].finish_reason === 'length'` and throw a distinct
  `TruncatedResponseError` immediately instead of returning content that
  `chatJSON` will parse-fail and retry. ~10 lines, one file, no interface
  change. Do it opportunistically next time someone's in that file.
- **Full version (only if truncations recur)** — thread `finish_reason`
  through the `LLMProvider` interface so the registry and all three providers
  expose it uniformly. High blast radius: touches every AI feature routing
  through `llm/registry.ts` (grading, ВКР, quizzes, program analysis, …) —
  not worth it while the CLIENT_ABORT/INTERNAL_ERROR monitors would flag any
  new route developing the same pattern within hours.
- **Touches** — `services/llm/deepseek.ts` (v1); `services/llm/types.ts` +
  `registry.ts` + `qwen.ts`/`yandex.ts` (full version).

### 11. Мониторинг РПД — email the reminder letters, don't just download them · Effort: S

v1 (see CHANGELOG) generates per-institute reminder letters (.docx + copy-text)
but the head of УМЦ still has to send them herself. `services/emailTransport.ts`
+ `lib/emailTemplates.ts` already exist for exactly this (teacher invites use
the same shape) — wiring a «Отправить» button just needs institute-contact
emails somewhere (not currently modelled; org_units has no contact-email
field) and a confirmation step before anything goes out, per the
explicit-permission rule for outbound messages.

- **Why** — closes the loop v1 deliberately left open (user chose "letters,
  not send" for the first cut); the marginal engineering cost is low since
  the drafting/table logic is already built.
- **Touches** — `services/rpdReminders.ts` (add a send path), `routes/rpdMonitor.ts`,
  `rpd_dept_groups` (contact email column), `RpdMonitor.tsx`.

### 12. Мониторинг РПД — auto-fetch from АСУ Университет instead of manual upload · Effort: L (needs АСУ API access)

v1 requires the weekly manual download-then-upload because there's no known
programmatic access to АСУ Университет from outside. If the university's IT
department can provide an API or a scheduled-export mechanism, the upload
step could become a nightly `services/renewals.ts`-style cron job
(`startRenewalScheduler` is the existing precedent for this kind of
scheduler) — dropping the "download from АСУ" step out of her workflow
entirely, not just the "rebuild in Excel" step v1 already removed.

- **Why** — the biggest remaining manual step; blocked on an external
  integration point that doesn't exist yet, not on anything in this codebase.
- **Update (2026-07-21):** superseded-in-scope by **Feature AC** — the same
  АСУ access wall now covers a two-way story (this read leg + the
  parse-and-push leg). An IT meeting is being arranged (AC v0); take this
  item's read-direction ask into that same conversation.
- **Touches** — new `services/asuSync.ts`, a scheduler registration in
  `backend/src/index.ts`, `rpd_snapshots.source_filename` becomes nullable
  (no upload) or gets a `source: 'upload' | 'auto'` discriminator.

---

## Features

### A. Bulk grading · Effort: L (depends on #1 — job queue)

Drop a folder of PDFs/DOCX into the grading page → parse student name from
filename pattern (configurable per course) → queue all of them → results
land in History.

- **Why:** #1 most-requested feature once teachers grade more than five
  individually. Especially valuable for finals weeks where one professor
  grades 60+ ВКР in two days.
- **Touches:** new `BulkGrading.tsx` page, drag-and-drop component, queue
  integration (needs Improvement #1 first), `routes/grading.ts` batch
  endpoint, progress polling.
- **Pricing hook:** worth gating to Pro; institution tier could add
  per-batch templates.

### ~~B. Per-student trajectory panel~~ — already done

Shipped: new "За семестр" tab in
[GradingResult.tsx](frontend/src/components/grading/GradingResult.tsx),
visible only when the current submission has a `student_name`. New
`findStudentTrajectory()` in
[db/queries/assignments.ts](backend/src/db/queries/assignments.ts) — last 3
grades for the same (student_name, student_group) pair, scoped to the
current course when one is selected (criteria are only comparable within a
course), excluding the assignment being viewed. New
[StudentTrajectory.tsx](frontend/src/components/grading/StudentTrajectory.tsx)
renders the score/grade history plus **per-criterion movement**: each
current criterion is matched by normalised name against the most recent
prior occurrence, showing `72 → 85 (+13)` with a colored delta, or "впервые"
when the criterion has no history yet. New route
`GET /api/grading/student-trajectory`. No new AI calls — pure history
lookup, matching the original design note.

**Also added to [AssignmentDetailModal.tsx](frontend/src/components/grading/AssignmentDetailModal.tsx)** (the История/past-grades detail view), not just the live grading screen — user testing surfaced that checking on a student's trajectory happens at least as often from browsing history as from a fresh grading, and the original scope had only wired the live screen. Reuses the same `StudentTrajectory` component and `getStudentTrajectory` query, anchored on the historical assignment's own score/grade instead of an in-progress edit. 6 integration tests
(`assignments.trajectory.integration.test.ts`) covering course scoping,
NULL-group matching, cross-teacher isolation, and the limit/ordering
contract.

### ~~C. Cohort / group analytics for the Students page~~ — already done

Shipped: new **«По группе»** tab on [Students.tsx](frontend/src/pages/Students.tsx)
next to the existing roster list. New pure `computeCohortAnalytics()`
([services/cohortAnalytics.ts](backend/src/services/cohortAnalytics.ts)) over a
flat per-assignment row set — overall grade histogram, per-group breakdown
(count + avg score, sorted alphabetically with ungrouped last), **top 3
weakest criteria** (lowest average score, criteria matched case-insensitively
by name, requires ≥3 samples so one harsh grading of one student can't read
as "the whole cohort struggles here"), and **«Требуют внимания»** — students
whose last-2-submissions average dropped ≥8 points vs. their prior average
(minimum 4 submissions to have a meaningful split), sorted worst-first,
capped at 10, clickable straight into their profile. New
`findCohortRows()` ([db/queries/assignments.ts](backend/src/db/queries/assignments.ts),
capped at 5000 rows) + `GET /api/grading/cohort-analytics`. **No AI calls** —
pure aggregation, distinct from the AI-driven cohort synthesis on published
assignments ([services/cohortSynthesis.ts](backend/src/services/cohortSynthesis.ts)),
which is scoped to one published assignment and produces qualitative
gaps/topics via LLM rather than a roster-wide histogram. 10 unit tests
(`cohortAnalytics.test.ts`) + 2 integration tests
(`assignments.cohort.integration.test.ts`). CSV export not built — no
demand signal yet, easy fast-follow via the existing `toCsv` helper if
asked for.

### D. Real PPTX export · Effort: M

Explicitly excluded by CLAUDE.md for MVP, but every demo ends with "and can
I get it as PowerPoint?"

- **Why:** Removes the #1 objection in sales conversations. Pro feature
  with real perceived value.
- **Touches:** `services/presentations.ts` adds export path,
  [routes/presentations.ts](backend/src/routes/presentations.ts) new
  `GET /api/presentations/:id/pptx` endpoint, `pptxgenjs` (Node lib),
  Yandex-academic template asset.

### E. Public read-only feedback links · Effort: S

Teacher approves → "Скопировать ссылку для студента" → time-boxed signed
URL they paste into Moodle/email. Avoids the "draft email + send from own
client" friction.

- **Why:** Existing email-draft flow has measurable friction; this skips
  it entirely without building a student portal.
- **Touches:** new `routes/public.ts` with signed-token middleware (no JWT
  required), new `pages/public/Feedback.tsx` read-only page, "share link"
  button in [GradingResult.tsx](frontend/src/components/grading/GradingResult.tsx).

### F. Calendar / due-dates layer · Effort: M

Tie assignments to due dates. "Grade due by Friday." Surfaces in dashboard.

- **Why:** Brings the platform closer to being the teacher's daily
  workspace, not just a tool they open when they remember to grade.
- **Touches:** schema migration (`due_at` on `assignments` + optional
  `course_schedule` table), dashboard widget, optional reminder emails
  (reuse existing transport).

### G. Voice / audio feedback · Effort: M

Teacher records a 30-second voice note alongside the grade. Students get
a more personal touch, teacher saves typing.

- **Why:** Differentiates emotionally — and many teachers actively prefer
  speaking feedback over writing it.
- **Touches:** Yandex Object Storage already wired (used for documents),
  add `audio_feedback_path` to `assignments`. Browser MediaRecorder API.
  Email template includes the playable link.

### H. Cross-course analytics for institution admins · Effort: M

Which professors have the highest/lowest grade dispersion? Which courses
are under-using the platform? Useful institutional decisions data.

- **Why:** Sells the institution tier upward. Department heads / vice-rectors
  want this view; it's not the same as a per-teacher dashboard.
- **Touches:** [routes/institution.ts](backend/src/routes/institution.ts)
  new aggregation endpoints, new admin pages under `/institution/analytics`.

### ~~I. "Спроси документ" — grounded chat over reference materials~~ — already done

Shipped: **per-subject** scope (the lean option from the original design
choice) — reuses the `course_id` chunk scoping presentations/quizzes already
use, rather than a per-document picker. New `askDocument()`
([services/docChat.ts](backend/src/services/docChat.ts)) embeds the question,
retrieves the top 5 chunks via a new `findRelevantChunksScored()`
([db/queries/chunks.ts](backend/src/db/queries/chunks.ts) — a distance-aware
twin of the existing `findRelevantChunks`), and answers with `chat()` (plain
prose, `[N]` bracket citations mirroring `presentations.ts`'s citation
convention, parsed by a small `extractCitedIndices()` that also strips
markers pointing at nonexistent sources).

**Both non-negotiable design constraints landed as designed:**
- **Refuse-when-ungrounded is deterministic, not prompt-only.** If the course
  has no chunks at all, or the best-matching chunk's cosine distance exceeds
  `0.35` (a starting heuristic — revisit against real usage, same posture as
  `calcVerifier`'s tolerance and `citationChecker`'s reference cap), the
  request never reaches the LLM — a fixed Russian refusal is returned
  instead. The system prompt *additionally* forbids answering from general
  knowledge as defense-in-depth, but the hard gate doesn't rely on the model
  behaving.
- **Multi-turn, re-retrieve per turn.** The client resends the local
  conversation history (capped, both client- and server-side) for
  continuity, but retrieval always re-runs fresh on the latest question —
  the model never drifts onto stale context from three turns ago.

New `POST /api/documents/chat` (extends `routes/documents.ts` rather than a
separate router — natural home next to upload/status), gated by the existing
`documentUpload` Pro+ flag exactly as planned (no new entitlement). New
`DocChatModal.tsx` opens from a **«Спросить документ»** button next to the
subject picker in `GradingForm.tsx`, visible once a subject is selected —
the "hook to open it from the grading screen" from the original design.
5 unit tests (`docChat.test.ts`, citation-extraction edge cases) + 3
integration tests (`chunks.integration.test.ts`, real pgvector distance
ordering).

**Open question from the original entry, still genuinely open:** which
documents teachers check most (ГОСТы vs. методички vs. internal
normatives) — no usage data yet since this just shipped; revisit ingestion
priorities once it's used.

> **КНИТУ curriculum-intelligence suite** (items K, L below; A3 and M already shipped). These
> are the *near-term, actionable* slices. The full feature map, dependencies, and items not
> yet promoted here (A4/A5, the competency model, the student tier) live in
> [docs/KNITU-roadmap.md](docs/KNITU-roadmap.md) — promote to this backlog on readiness.

### K. РПД ↔ competency/goals conformance check (Admin A2) · Effort: M · 🟡 PARTIALLY SHIPPED

**Status (2026-07-02):** the programme-scoped slice shipped as part of the
discipline-scoped document library (Migration 051, see CHANGELOG). A discipline's
uploaded рабочая программа is checked against `program_disciplines.competency_codes`
via `services/documentReview.ts` (one `chatJSON` call, deliberately not a reuse of
`services/grading.ts` — see that file's header comment for why), persisted in
`program_document_reviews`, surfaced in the programme Report tab. This covers the
*programme-competency-model* case. **Not yet built:** the original standalone
scope below — uploading an arbitrary syllabus/РПД outside the programme structure,
with competencies pasted/selected/extracted ad hoc rather than sourced from
`program_competencies`. Revisit if a teacher/admin wants to check a РПД that isn't
tied to a programme in the tree yet.

КНИТУ admin request (2026-06). Upload a syllabus/РПД → score how well it covers
the ОПК/ПК/УК competencies and the goals/outcomes it's meant to fulfil:
per-competency coverage, concrete gaps, and citations to the syllabus sections.

- **Why:** It's the **existing student-work grading engine pointed at a РПД** —
  competencies/goals become the criteria, the syllabus is the "submission". Proven
  code, high admin value (РПД quality assurance for the УМУ), and it's the feature
  that **justifies building the competency model** the rest of the roadmap (A5,
  student tier) depends on. Sibling to the shipped A3 overlap analysis — together a
  «РПД analysis suite».
- **MVP (ships without the competency model):** target competencies + goals are
  supplied as input — pasted / selected, or extracted from the РПД's own declared
  section — then scored against the syllabus body. **v2:** a per-направление/ФГОС
  competency library makes it one click (and that library *is* the matrix powering A5).
- **Touches:** reuse the grading path —
  [services/grading.ts](backend/src/services/grading.ts) and the
  `CriterionScore` / `ai_strengths` / `ai_improvements` shapes in
  [shared/types.ts](shared/types.ts) (each competency/goal = a criterion); document
  upload + chunking (РПД is a knowledge doc); new `services/syllabusReview.ts` (or
  generalise grading), new route + page; per-criterion citations like grading.
  Optionally reuse thorough-mode confidence to flag "is this competency *really*
  covered?".
- **Pricing hook:** Institution-tier (admin/УМУ feature) — where the curriculum suite is heading.

### L. «РПД-студия» — AI-assisted syllabus authoring (Teacher T5) · Effort: M (pairs with K)

КНИТУ request (2026-06). Help a teacher (разработчик РПД) draft and update syllabus
content aimed at given ОПК/ПК/УК + goals. Pairs with K into a **write → check → fix** loop.

- **Why:** Same generation pattern as presentations/quizzes/topics, just spec'd by
  the competency framework instead of a lecture topic. The author (L) + check (K)
  loop is a flywheel and a strong demo for the УМУ.
- **Touches:** generation engine (`chatJSON`) like
  [services/presentations.ts](backend/src/services/presentations.ts) /
  [services/quizzes.ts](backend/src/services/quizzes.ts); takes competencies + goals
  as the spec; emits editable syllabus sections (content, topics, assessment
  formats); feeds straight into K to score coverage, then suggests fixes for gaps.
  New service + route + UI; reuse the editable-output + `FeatureIntro` patterns.
- **Principle:** AI drafts, the teacher is the author of record — never
  auto-published (same "AI never final" rule as grading).
- **Depends on:** K (the check closes the loop) — build K first.

### ~~N. Drawings into the ВКР review — text-vs-drawing findings~~ — already done

Shipped: teachers can attach up to 6 чертежи (PDF/photo) to a ВКР long review
via new **`DrawingsUpload.tsx`** (visible only on the long-review path). Each
file reuses the *existing* `/api/documents/upload` pipeline unchanged — no new
OCR plumbing needed, `services/documentExtractor.ts` already routes a
low-text-layer PDF or an image through `yandexVisionOCR` — so steps 1-2 from
the original plan turned out to be almost entirely a UI addition on
already-shipped infrastructure, not new backend work.

**Step 3 (the payoff) landed exactly as scoped, plus one free addition.** Each
OCR'd drawing is analysed by a new, deliberately *non*-reused function,
`analyzeDrawing()` — extractive only (summary + key_quantities with verbatim
quotes), no strengths/gaps critique, since a title block isn't prose to
review. Wrapped as a pseudo-`Section` (new `kind: 'drawing'`, via pure
`buildDrawingSection()`) appended *after* the ПЗ's own sections so indices
never collide with real chapters. Fed into **both** contradiction-detecting
passes:
- **Tier-5 (`findPremiseIssues`)** — the originally-scoped target.
- **Tier-2 (`findInconsistencies`)** — realized during implementation that
  this cheap, non-reasoner, name-clustering pass is actually the more precise
  mechanism for the TODO's own headline example ("15 м в тексте vs 54 000 мм
  на чертеже" is a same-name, different-value cluster — exactly what Tier-2
  already does for cross-chapter numbers). Free to add since both passes take
  the same `analyses: SectionAnalysis[]` shape — no new prompt.

Deliberately **excluded** from `synthesizeReview` (chapter_reviews — a
drawing isn't a chapter) and `findRecomputations` (no derivable formula in a
dimension callout).

**UI labeling:** a finding whose evidence points at a drawing needs to render
"Чертёж: файл.pdf", not "Раздел 7" — new `LongReviewResult.drawings:
{title}[]` (rides in the existing `result` JSONB column, **no migration**)
lets `PremiseFindingsBlock`/`InconsistenciesBlock` resolve `chapter_index >=
chapter_reviews.length` back to the right drawing title, in both
`ReviewResult.tsx` (live) and `AssignmentDetailModal.tsx` (history).

- **Touches:** `services/longReview.ts` (`Section.kind`, `buildDrawingSection`,
  `analyzeDrawing`, orchestrator wiring), `routes/grading.ts` +
  `gradingValidation.ts` (`drawings` on the review request, capped at 6 files /
  20k chars OCR text each), `shared/types.ts`, new `DrawingsUpload.tsx`,
  `PremiseFindingsBlock.tsx` / `InconsistenciesBlock.tsx`.
- **Note:** OCR won't recover pure geometry ("horizontal vs vertical" as shapes),
  but it does recover the dimension/label *text* where most contradictions live.
- **Pricing hook:** rides on `documentUpload` (already Pro-only); OCR cost is
  ~$0.001/page (negligible).

### O. Course knowledge graph — concept extraction + prerequisite inference · Effort: L+ (research-track)

Build a per-course concept graph: nodes are concepts taught/tested, edges are
prerequisite relationships. Concepts extracted from syllabus + lectures + rubric
criteria via structured-output LLM calls. Prerequisite edges from two signals
combined: (a) LLM-suggested from concept descriptions, (b) data-discovered from
conditional performance patterns in approved grades. Once built, lights up
diagnostic feedback ("which concept did the student actually miss"),
syllabus-vs-content gap detection, accreditation-grade coverage reporting, and
becomes the substrate for a student-facing tutor down the line.

- **Why:** the missing connective tissue between syllabus, lectures, rubrics,
  and grades. Today these are four isolated data piles. With the graph, every
  downstream feature (feedback, remediation, audit, tutor) gets dramatically
  sharper. Also the strongest single research/patent contribution on the
  roadmap — see [Research.md](Research.md) §3.2 for the full case and patent-
  claim framing.
- **Touches:** new `concepts`, `concept_edges`, `concept_to_content`,
  `concept_to_criterion` tables (Apache AGE optional, relations table over
  pgvector sufficient for v1); new `services/conceptExtractor.ts` and
  `services/conceptGraph.ts`; instrumentation hooks in grading and presentation
  services to attach concept IDs; admin/teacher views to inspect the graph.
- **Sequencing:** explicit research-track. Don't start before grant scoping is
  done — the patent-claim language and demo scope should be locked first so
  what we ship matches what we claim. Cross-link with #3 (Russian embeddings)
  since concept extraction quality rides on embedding quality.

### P. Organisational structure model — canonical-typed org tree · Effort: L+ (foundational) · 🟢 MOSTLY SHIPPED

**Status (2026-06-28):** core shipped + deployed (commit a619377; migration 045
ran on prod via deploy). Increments: foundation, tree-builder UI (1),
teacher/role assignment (1b), tree-based admin guards + `syncRoleToTree` (3),
and **frontend gate now reads org-tree-derived `is_platform_admin` /
`is_institution_admin` from the auth payload (b)** — legacy enum fallback kept
for pre-upgrade sessions. See CHANGELOG.

**Done:** (a) prod migration, (b) frontend gate coherence.

**(c) Domain-scoped grants — two-axis authorisation**
([Research.md](Research.md) §7.10). Re-scoped from "per-subtree admin
scoping": the original framing (subtree containment only) cannot express
functional authority — the УМЦ head had to hold root admin just to reach
РПД monitoring, and every future admin department (other проректоры, отделы)
would repeat the problem. New model: a grant is **(level: admin/edit/view) ×
(domain: platform/curriculum/teaching/…) × (unit subtree)**. Functional staff
get domain-narrow grants at root (УМЦ: `edit × curriculum × root`; ПР УР:
`view × teaching,curriculum × root`); line managers get grants at their unit
(institute director, kafedra head); IT holds `admin × * × root` — the real
org-admin.

- **Phase 1 — `curriculum` domain · 🟢 SHIPPED (2026-07-22).** Migration 087
  adds `org_unit_roles.domain` (default `'all'`, pure-widening — every
  existing institution-root admin is untouched) and renames the level values
  `head`→`edit`, `viewer`→`view` in the same migration (§7.10.3). New
  `services/accessScope.ts` (`getAccessScope`) + `middleware/requireDomain.ts`
  gate РПД monitor and institution criteria/rubrics on `curriculum` domain
  instead of institution-root admin; `orgUnits.ts` role-grant endpoints accept
  an optional `domain` (validation refuses `role='admin'` paired with a
  non-`'all'` domain — belt-and-suspenders against a domain-scoped admin grant
  being mistaken for true root admin, which `isInstitutionAdmin` now also
  explicitly guards against via `domain='all'`). Frontend: role-assignment UI
  gained a domain picker; Sidebar/`InstitutionLayout`/`InstitutionRoute` gate
  on `teacher.curriculum_access` so a curriculum-only grant sees only the tabs
  its level reaches (and is redirected away from admin-only sub-routes rather
  than hitting a 403 wall). See CHANGELOG.
- **Phase 2 — `teaching` domain · 🟢 SHIPPED (2026-07-22).** ПР УР read-only
  width — usage analytics, grading activity, leadership dashboards, roster
  read — at `view` level, unlocking the deferred viewer dashboards and §2.x
  analytics consumers. `hasLeadershipRole`, `listDirectLeadershipUnits`, and
  both `canActOnUnit` call sites in `routes/leadership.ts` gate on `teaching`
  domain + `view` level instead of a bare role check.
  **Real bug found and fixed in the same commit:** `teacherCanActOnUnit`
  (backing all of the above) predates the domain axis and matched on role
  alone — so a Phase 1 `curriculum` grant already leaked into the leadership
  dashboard (grading activity, rosters, institution-wide) before this shipped.
  `canActOnUnit`/`teacherCanActOnUnit`/`evaluateAccess`/`requireUnitRole` all
  gained a required `domain` parameter (no unsafe "any domain" default) to
  close it, with a regression test. institution.ts's `GET /overview`,
  `/usage/daily`, `/usage/export`, `/teachers` (roster read only) moved ahead
  of the admin gate the same way Phase 1's criteria/rubrics did — mutations
  (`PATCH /teachers/:id`, invites) stay admin-only. Frontend: `curriculum_access`
  gating generalised to also read `teaching_access`; a stale pre-Phase-1
  `head`/`viewer` label map in `Leadership.tsx` and `InstitutionAudit.tsx`
  (missed by the Phase 1 rename sweep — unquoted object keys, not string
  literals) fixed while verifying in-browser. See CHANGELOG.
- **Phase 3, slice A — subtree query scoping for `teaching` · 🟢 SHIPPED
  (2026-07-22).** The `teaching`-domain institution routes (`/overview`,
  `/usage/daily`, `/usage/export`, `/teachers`) now actually consume the
  `pathPrefixes` a grant carries — a sub-unit grant (e.g. an institute
  director holding `view × teaching × their-division`, grantable since Phase
  2's role UI) sees only their subtree's teachers/activity, not the whole
  institution. `db/queries/institutions.ts`'s three query functions gained an
  optional `unitPathPrefixes` param (subtree-filtered via
  `primary_org_unit_id` → `org_units.path`); `routes/institution.ts`'s new
  `resolveTeachingPrefixes(req)` decides when to apply it — critically,
  **root-anchored grants stay unrestricted** (not filtered by "root path"),
  because every grant issued to date is root-anchored and filtering by root
  path would incorrectly drop teachers with no `primary_org_unit_id` that the
  unrestricted query has always shown. Verified in the browser with a real
  division + kafedra-under-it + two teachers (one in-subtree, one out).
  **Two more domain-blindness gaps found and fixed alongside** (same class as
  the Phase 2 leadership leak, lower severity): `getProgramAccessScope`
  (`services/programAccess.ts`) and `canTeacherShareToUnit`
  (`db/queries/orgUnits.ts`) both matched on role alone with no domain
  filter — since Phase 2's role-grant UI now offers `teaching` at `edit`
  level too, a hypothetical future `teaching`-domain edit grant would have
  incorrectly unlocked program-editing and rubric-sharing rights it was never
  meant to have. Both now require `domain IN ('all', 'curriculum')`. See
  CHANGELOG.
- **Phase 3, slice B — subtree-scoped org tree CRUD + role grants · 🟢
  SHIPPED (2026-07-22).** Narrowed after the original "platform narrowing"
  framing turned out to be the wrong shape: user confirmed real-world
  practice at KNITU (and likely other universities on the platform) —
  **teacher invite/deactivation is centrally owned by IT, never delegated
  per department**. So `POST/DELETE /api/institution/teachers/invite*`,
  `PATCH /api/institution/teachers/:id`, `PUT /api/institution/structure/members/:teacherId/primary`,
  and LTI/model/shared-RAG settings stay `platform`-domain, root-admin-only,
  institution-wide **permanently** — not deferred, decided. What real
  institute directors actually need is control over their own piece of the
  org structure: `routes/orgUnits.ts` (`/api/institution/structure/*`) swaps
  its `requireInstitutionAdmin` gate for `requireDomain('platform', 'admin')`
  — safe because `role='admin'` is always `domain='all'` (Phase 1 invariant),
  so this is a pure widening for the coarse gate; a sub-unit `admin × all`
  grant (already grantable via the existing role UI) now also passes. New
  `unitInScope` helper (alongside the existing `unitInInstitution`) enforces
  the real per-target check via `pathIsAncestorOrSelf` — applied to every
  write endpoint's target unit(s), including **both sides of move** (can't
  pull a unit in from outside your subtree, can't move one of yours out to
  somewhere you don't control). `listOrgUnitsWithCounts` and
  `listInstitutionMembersWithRoles` gained the same optional
  `unitPathPrefixes` filtering as slice A's queries (no orphan-row subtlety
  here — every org unit has a real path). No new escalation-guard logic
  needed for role grants: delegating `admin × all` on a descendant only
  grants power within that descendant's subtree, by the same containment
  math `canActOnUnit` already does. Verified live in the browser: a division
  admin could create/rename/delete kafedry and grant roles within their own
  institute, and was refused (via the UI's own error handling) touching
  anything outside it. See CHANGELOG.
  - **Still explicitly deferred**, unrelated to the narrowing above: **RPD
    monitor (`curriculum`) subtree scoping** — `rpd_snapshot_rows` keys
    departments by a free-text `dept_code` string with no FK or join path to
    `org_units` at all (checked `migrations/086_rpd_monitor.sql`); needs a
    new `dept_code → org_unit_id` mapping (schema + UI), not a query filter.
    **Criteria/rubrics sharing target** — `POST /api/institution/{criteria,rubrics}`
    still always shares to the institution root regardless of the caller's
    own granted subtree; scoping that means changing the share *target*, a
    behaviour change needing its own product decision.

**Tail (d) — Leadership dashboard V2 · Effort: S.**

**Slice 1 (shipped 2026-07-01):** per-teacher drill at `/leadership/teachers/:id`
— canActOnUnit walk on the *teacher's* primary unit, 30-day totals (проверок,
доля утверждений, средняя правка балла), activity sparkline, active subjects,
last 20 grades. Backend: `GET /api/leadership/teachers/:id`, four new queries
in `db/queries/leadership.ts`. Frontend: `LeadershipTeacher.tsx`, clickable
teacher rows on the overview.

**Remaining slices:**
- Presentations generated in the subtree over 30 days (counts + by-teacher) —
  extend `/api/leadership/overview` and the overview page cards / drill page.
- Published assignments in the subtree: counts of definitions, submissions,
  active student writers, completion rate.
- Optional: viewer-role variant of the same page (read-only governance —
  same data, no actions if/when we add actions to V2).

Touches (remaining): `routes/leadership.ts` (extend `/overview` + drill),
`db/queries/leadership.ts` (presentations + published-assignments queries),
`pages/Leadership.tsx` + `pages/LeadershipTeacher.tsx` (extra cards).

Original design notes below.

Replace today's flat `institutions` + 3-value `teachers.role` enum with a
self-referencing `org_units` table (canonical `type_code` taxonomy:
`institution` / `governance` / `admin_office` / `cluster` / `division` /
`department`) and a `org_unit_roles` junction (admin / head / viewer per
unit). Authorisation resolves via materialised path walk. Teachers belong
to a primary `department`; roles attach at any level above. See
[Research.md](Research.md) §7 for full design including KSTU/КНИТУ mapping,
schema sketch, and onboarding-variability decision (self-service tree
builder for v1).

- **Why:** the 2-level model collapses the moment we touch a real Russian
  university. Each of §2.1 fairness audit, §2.2 coverage audit, §2.4
  federated benchmarking, §5.1 published assignments, §6 LTI integration
  needs a real org tree to resolve scope correctly. Retrofitting after any
  of those ship is a painful migration that risks scoping bugs in the
  first institutional pilot. Doing this first is the cheapest path.
- **Touches:** new `org_units`, `org_unit_roles` tables + migration;
  `teachers.primary_org_unit_id`; new authorisation helper
  (`services/orgScope.ts`) that walks paths; revision of every existing
  admin route to scope via the tree instead of `institution_id`;
  IT-admin tree-builder UI (Settings → Organisation); backfill script that
  creates one root unit per existing institution + a placeholder
  `department` per existing teacher; CLAUDE.md *Admin System* and
  *Database Schema* sections rewritten to match.
- **Sequencing:** ships **before** §5.1 build (Feature N+ work) and
  before §6 LTI. Estimated 3–4 weeks of focused work for schema +
  middleware + minimal admin UI. Defer rich per-level dashboards,
  template library, AD sync.

### Q. Published assignments + process-of-creation attestation (§5.1) · Effort: M · 🟢 CORE SHIPPED

**Status:** the v1 loop is fully shipped and live (see
[FEATURES.md](FEATURES.md) — "Задания студентам") — publish an assignment
definition → per-student tokenised link → student writes in-platform
(TipTap, consent gate, autosave) → aggregate-only telemetry → teacher opens
the submission, reads the neutral process report (active time, revisions,
paste ratio + largest insertion), and grades with one click. The work lands
in the Журнал carrying its provenance like any other graded assignment.
Grading is **holistic** for v1. Full original design in
[Research.md](Research.md) §5.1.1–§5.1.4 and §5.6–§5.7.

**Not yet built — the v2 refinements originally bundled under this item:**
- **Criteria-scoped grading** on published-assignment submissions (currently
  always holistic — no criterion/weight picker on this path).
- **§5.3 trajectory view** — per-student authoring-pattern history across
  multiple published assignments (paste ratio / revision count trend over
  the semester, not just one submission's report).
- **§5.5 metacognition rubric template** — a rubric preset specifically
  scoring reflective/self-assessment quality, per the original design.

- **Why:** the shipped v1 already answers "won't we end up using AI to grade
  AI?" for a single submission. The three items above extend that from a
  one-off report into a *longitudinal* authenticity signal — closer to the
  original patent-claim framing — but none are required for the feature to
  be useful today.
- **Touches:** criteria-scoped grading — reuse the existing criteria
  snapshot/picker from regular grading, wire into
  [routes/publishedAssignments.ts](backend/src/routes/publishedAssignments.ts)'s
  grade endpoint; trajectory view — new aggregation query over
  `submission_telemetry` across a student's published-assignment
  submissions, new panel in `PublishedAssignmentDetail.tsx` or a per-student
  page; metacognition rubric — a new global rubric template (same mechanism
  as existing rubric templates), no schema change needed.
- **Sequencing:** independent of each other; pick whichever a real
  institutional pilot asks for first rather than building all three
  speculatively — same "concrete over speculative" principle as Feature
  P's deferred (c).

### R. LTI 1.3 integration + IT-admin configuration UX (§6) · Effort: L

**Shipped** (see CHANGELOG.md [Unreleased]): OIDC launch + JWKS validation,
teacher JIT provisioning, auto-created course-context resolution, self-serve
Settings → Organisation → LTI config + test-connection page, Deep Linking +
student launch (tokenised `/student/:token` rail unchanged), AGS grade
write-back with a sync-status badge, NRPS roster import into the
published-assignment invite UI, a course-mapping table (`lti_course_links` →
`org_units`, purely additive — never gates grading), and IMS Dynamic
Registration (one-click handshake as an alternative to manual Setup-screen
entry). Schema across migrations `066`–`068` covers all of it.

Remaining scope (low priority, no customer has asked yet):
- **Activity log** — a simple "last 100 LTI launches" list on
  `InstitutionLti.tsx` for troubleshooting; every launch already flows
  through `routes/lti.ts` so this is a logging/query addition, not new
  protocol work.
- **Known v1 limitation:** a co-taught Moodle course maps to whichever
  teacher launches it first — a second instructor's launch reuses the same
  `course_id` but the course row stays owned by the first. Needs a
  `course_collaborators`-style join if/when it comes up with a real customer.

- **Why:** the institutional wedge. Without LTI, GradeAssist is "another system
  to migrate to" and procurement stalls; with it, it is "a compatible tool."
  Sources verified student identity from the LMS, so we never store student
  credentials (§6.1). The §6.5 config UX is what keeps each institutional sale
  from becoming a hand-held engineering engagement.

### ~~S. Agentic calc verification~~ — already done

Shipped: `services/calcVerifier.ts` extracts up to 12 computational steps
from a calc-mode submission (one bounded `chatJSON` call), evaluates each
substitution via a sandboxed `mathjs` instance (restricted scope + a
defense-in-depth character allowlist — `expr-eval` was the original pick
but had an unpatched high-severity prototype-pollution advisory, ruled out
during implementation), and compares against the claimed result with a 1%
relative tolerance. Mismatches merge into `ai_improvements` as citable
bullets reusing the existing Tier-3 `severity`/`action`/`correction` fields;
the full per-step trace persists in `assignments.ai_calc_verification`
(migration `063_calc_verification.sql`). Gated behind `calcVerification`
plan flag (Pro+). See CHANGELOG for full design including the evaluator
pivot and 21 unit tests in `calcVerifier.test.ts`.

**Follow-up discovered while building, not yet done:** `assignment_type` is
never persisted on `assignments` (request-time parameter only) — the eval
harness's `runReplay()` has no way to identify which historical assignments
were originally calc-mode, so this feature can't be measured via replay
today. Fixing would mean adding a persisted `assignment_type` column and
threading it through `ReplayTarget`/`findReplayTargets` — real but separate
scope from this ship.

### ~~T. Citation existence checking~~ — already done

Shipped: `services/citationChecker.ts` mirrors `calcVerifier.ts`'s pattern —
one bounded `chatJSON` call extracts up to 15 bibliography entries; a
4-worker bounded-concurrency pass (reusing `evalHarness.ts`'s worker-pool
shape) searches each via `webSearch()` (reformulating once on a zero-result
first pass), and `classifyMatch()` scores token overlap locally (no further
LLM call) into found / similar_found / not_found. Only `not_found` merges
into `ai_improvements` as a citable bullet, always phrased as a neutral
fact with the "not proof of fabrication" caveat baked into the note text.
Full trace persists in `assignments.ai_citation_check`
(migration `064_citation_check.sql`). Opt-in per request (`check_citations`,
mirrors the existing `thorough` checkbox pattern rather than
`calcVerification`'s auto-enable, since it applies to any submission type
and adds real latency) — gated Pro+ via new `citationCheck` plan flag. See
CHANGELOG for the full design, known constraints (15-reference cap,
synchronous request, heuristic classification), and 11 unit tests in
`citationChecker.test.ts`.

### U. Criteria/rubric marketplace — cross-institution publishing · Effort: L

*Superseded premise, 2026-07-15: intra-institution sharing is no longer a
bare `is_institution_shared` boolean — `shared_unit_id` (migration 079) now
lets a teacher share to their own department/faculty/institution via the org
tree, with `is_institution_shared` kept only as a synced legacy mirror. This
item's `visibility` enum should sit ALONGSIDE `shared_unit_id` (adds the
`public` rung above it), not replace it — update the touches list below
accordingly when picked up.*

Extend the existing sharing model (criteria + rubrics
already have it — [migration 020](backend/migrations/020_criteria_model.sql),
[migration 029](backend/migrations/029_rubrics.sql),
[migration 079](backend/migrations/079_rubric_org_unit_sharing.sql)) into a
three-level `visibility` enum: `private | institution | public`. A teacher can publish a
**rubric** (the primary unit — a bare criterion is too thin to be useful;
rubrics are the coherent, weighted thing teachers actually struggle to
build) to a cross-institution marketplace; other teachers browse/search and
add a copy to their own library.

- **Why:** criteria/rubrics are the platform's stated differentiator vs. "a
  GPT wrapper" — a network effect around them compounds the right asset. A
  teacher whose rubric is used by 40 colleagues at other universities
  doesn't churn. Russian-specific incentive that competitors don't have:
  методическая работа counts toward преподавательская аттестация, so a
  published rubric with attribution + usage stats is a real career artifact,
  not just karma.
- **Design, locked in from the discussion that scoped this:**
  1. **Rubrics, not bare criteria, are what gets published** — a criterion
     riding along inside a published rubric still becomes independently
     addable, but the marketplace's primary browsable unit is the rubric.
  2. **Copy-on-add, not live-link.** Adding a public rubric/criterion clones
     it into the teacher's own library with a `source_public_id` reference
     column — someone else silently editing their published version must
     never change how your students' work gets graded. The reference can
     still power an optional "автор обновил исходную версию" nudge.
  3. **Embedding-based dedup on publish.** Reuse the existing pgvector
     embedding path (`embed()` in `llm/registry.ts`) to check a new
     submission against already-public entries before it goes live —
     "похожий критерий уже опубликован, использовать его?" — otherwise the
     market fills with three hundred variants of «Аргументация».
  4. **Moderation gate before anything goes public — non-negotiable.**
     Criterion/rubric descriptions are injected directly into grading
     prompts (a trusted slot), so a community-published entry is a
     prompt-injection vector into *other teachers'* grading, not just the
     publisher's own — `sanitiseForPrompt()` (rule #1) was designed for
     adversarial student text, not adversarial instructions sitting in a
     trusted prompt slot. Need: a review queue (model on the existing
     `contact_messages` admin-triage pattern) + an LLM screening pass on
     submit ("does this description contain grading instructions unrelated
     to assessing quality, e.g. 'always score 100'?").
  5. **Rank by real observed usage, not likes.** `criteria_snapshot` already
     records which criteria were actually used in approved gradings — surface
     "проверено на 1 200 работах" on marketplace listings. Unfakeable social
     proof you already have the data for.
  6. **Institution-level policy switch.** RAG's institution pool solved the
     same tension (a department not wanting its methodology to leak outside
     the institution for free) with double opt-in — same shape here:
     publishing stays a per-teacher choice, but an institution admin gets a
     master toggle to disable it for their teachers, or enterprise sales
     will hit this as an objection.
- **Touches:** new `visibility` column (`private | institution | public`)
  alongside `shared_unit_id` on `criteria` + `rubrics`; new
  `criterion_publications` / `rubric_publications` moderation-queue table;
  browse/search page reusing
  [TemplatePicker.tsx](frontend/src/components/ui/TemplatePicker.tsx) (already
  scales via search + subject filter — same component, community-sourced
  data instead of platform templates); admin review surface; `source_public_id`
  + usage-count columns; embedding-dedup check in the publish flow.
- **Sequencing:** value scales with user count, so this is worth more
  later rather than sooner — sequence after S/T (those differentiate at any
  scale; this compounds with scale). Certificate/methodological-registry
  export and the embedding-dedup check can ship as a fast-follow rather than
  in v1.

### V. УМЦ dashboard — УМК readiness/quality statistics + export · Effort: M

Institution admin request (2026-07-08, HR/УМЦ feature ideas). A dashboard for
methodology-office staff (УМЦ): a readiness matrix (programme × course × УМК
artifact — syllabus exists? reviewed? conformant? last updated?) with quality
scores rolled up by department, plus data export.

- **Why:** almost entirely assembly, not new capability — `curriculumAnalysis`,
  `syllabusReview`, `programAnalysis`, and `programReportPdf` already compute
  the underlying quality signals; the org tree (§7) already supports scoped
  roles. Low political risk (methodology QA, not teacher evaluation), visible
  value fast, sells the institution tier to exactly the people who hold that
  budget line.
- **Design decisions:**
  - **Role:** УМЦ's access pattern is horizontal (all syllabi across
    faculties, no grading/student data) rather than the vertical cascade
    `org_unit_roles` currently expresses. Worth a distinct methodologist role
    rather than overloading `viewer`/`head` on an org unit — resolve before
    building, since it affects the authorisation helper in
    [services/orgScope.ts](backend/src/services/orgScope.ts).
  - **Export:** existing report generation is PDF-only
    ([services/programReportPdf.ts](backend/src/services/programReportPdf.ts)).
    УМЦ explicitly asked for "выгрузка" — add XLSX (they live in Excel), not
    just a nicer PDF.
- **Touches:** new aggregation queries (readiness matrix rollup by org unit),
  new `pages/institution/UmcDashboard.tsx` (or similar), XLSX export endpoint,
  methodologist role addition to `org_unit_roles` if that path is chosen.
- **Sequencing:** do this before W — same underlying aggregation layer, lower
  risk, and it's a natural first slice of that layer.

### W. HR faculty profile ("аватар ППС") + development trajectory · Effort: L (needs further design)

Institution admin request (2026-07-08). HR wants to identify ППС strengths/
weaknesses from student surveys, build a per-teacher profile, and construct
individual professional/personal development trajectories. Differentiate ППС
into types.

**This idea still needs real design work before it's buildable — do not
scope it directly into a sprint from this entry.** Open questions and a
starting direction below, but expect a Research.md section (or at least a
proper design pass) before implementation.

- **Reframe from the original ask:** don't build this survey-only. The
  platform already has behavioral signal the admin didn't ask for but that's
  more valuable than perception data — syllabus/curriculum quality scores,
  presentation/quiz/case tool usage, grading consistency, how often AI grades
  get edited before approval. The profile should combine platform-derived
  practice signal with imported survey results, not rely on survey alone.
- **Survey data ingestion — do not connect directly to a university DB.**
  Direct DB access to an external survey system is fragile and a 152-ФЗ
  surface increase. Import instead (CSV/Excel upload or a small API
  endpoint), normalized into our own schema — same per-institution pattern
  used elsewhere (LTI/SAML config, document upload).
- **Trust framing is the hard part, and it's non-negotiable, not a nice-to-
  have.** Teachers are our users; if ИСПУМ becomes visibly "the tool HR uses
  to rank you," adoption dies. Apply the same neutral-process principle
  already designed for attestation (§5, Feature Q — process reports, not
  verdicts):
  - Teacher sees their own full profile first, framed as development
    ("strengths / growth areas + recommended platform features/courses"),
    not a score.
  - HR/leadership sees aggregates and trajectories, gated behind org-tree
    roles, with typology framed as development profiles ("strong
    methodologist, low interactivity") rather than performance grades or
    rankings.
- **The differentiating piece is the closed loop**, not the profile itself:
  diagnose → recommend a specific platform feature → measure the delta over
  time (e.g. "low quiz variety → quiz generator with these templates → score
  improves in 3 months"). That's what no competitor can replicate inside one
  product — worth designing the trajectory tracking around this loop
  specifically rather than as a static report.
- **Open questions to resolve before scoping:** what survey format(s) do
  target institutions actually use (single tool, or per-institution
  variance)? What's the minimum viable typology (how many "types," defined
  how, and by whom — HR or us)? Does this need a new role distinct from the
  УМЦ methodologist role in V, or can HR reuse it?
- **Touches (provisional, will change with design):** new survey-import
  endpoint + table, new aggregation layer shared with V (per-teacher/course
  quality rollup), new `services/facultyProfile.ts`, new HR-facing pages,
  likely a Research.md design section before any of this is final.
- **Sequencing:** after V — reuses the aggregation layer V builds, and V's
  lower-risk shape is a better first proof point for this kind of
  institution-facing analytics before tackling the trust-sensitive one.

### X. ФОС generator — «Собрать ФОС» · Effort: L · 🟢 v1 SHIPPED

**Status (2026-07-16):** v1 (teacher-scoped) shipped — `/fos`, new Materials
hub card. Orchestrator (`services/fosGenerator.ts`) chains the existing
`generateQuiz`/`generateTasks` engines plus the one new generator
(`services/fosTickets.ts` — экзаменационные билеты) and a criteria
assembly step, wired through a pg-boss job (`services/fosWorker.ts`,
mirroring long-review exactly) and a deterministic no-LLM coverage
self-check (`services/fosCoverage.ts` — flags any topic/competency with
zero instruments and any topic dominating >50% of tickets). Sections are
teacher-editable with autosave (`FosStudio.tsx`); exports to both branded
PDF (`services/fosReportPdf.ts`) and editable DOCX (`services/fosExport.ts`,
`docx` npm v9.7.1 — CommonJS-requirable via its UMD `main` bundle despite
`"type": "module"` in its own package.json; verified by generating and
unzipping a real `.docx`). 15 unit tests (`fosTickets.test.ts`,
`fosCoverage.test.ts`).

**Not built — v2 (programme-integrated):** the original design's indicator
sourcing from `program_disciplines.competency_codes` (accreditation-grade,
sells the institution tier) — v1 extracts topics/competencies ad hoc from
`courses.syllabus_text` instead. Revisit once a real programme-linked
discipline wants this.

Original design notes below.

From the 2026-07-16 wow-feature slate ([Research.md](Research.md) §9.2).
Every РПД legally requires a фонд оценочных средств; teachers assemble them
by hand under accreditation deadline pressure. One button on a discipline:
«Собрать ФОС» → a complete, editable, exportable document whose parts are
generated by engines that already exist.

- **Why:** the best jaw-drop-to-engineering ratio on the platform — it is
  orchestration of shipped generators, not new AI capability; it attacks
  the most-hated bureaucratic artifact in the profession; it is defensibly
  Russian-specific (no Western competitor will build it); and it targets
  the pain that institution-tier buyers (УМУ/проректор) personally feel.
  Photo-stack grading is the better demo; this is the better sale.

- **What a ФОС contains → which engine produces it:**
  1. **Паспорт ФОС** — the header table mapping компетенции → индикаторы
     достижения → оценочные средства → формы контроля. Source: the
     programme competency model (`program_disciplines.competency_codes` +
     indicator decomposition already built for the РПД conformance check
     in `documentReview.ts`), or ad-hoc extraction from the РПД text when
     the discipline isn't linked to a programme. Assembly, no generation.
  2. **Тестовые задания** — `services/quizzes.ts`, called per topic block
     at the three Bloom levels it already supports, each batch tagged with
     the индикатор(ы) it evidences.
  3. **Практические задания / кейсы** — `services/tasks.ts`, same tagging.
  4. **Экзаменационные билеты** — the one genuinely new generator: N
     билетов × (2 теоретических вопроса + 1 практическое задание), with a
     balance constraint — every topic and every индикатор covered by at
     least one билет, no topic dominating. One `chatJSON` call taking the
     topic list + indicator set; the balance check is deterministic
     post-validation (like `validateCitation` — never trust the model to
     self-report coverage).
  5. **Критерии оценивания** — map to the 5/4/3/2 scale from the
     discipline's rubrics/criteria where the teacher has them; otherwise
     generate defaults per assessment type.

- **Coverage self-check (the differentiator):** after assembly, a
  deterministic pass verifies every индикатор is hit by ≥1 оценочное
  средство; gaps render as a warning list with a «Догенерировать» button
  per gap. Same write→check→fix loop as РПД-студия's «Перепроверить
  покрытие».

- **Orchestration:** a pg-boss job (`services/fosGenerator.ts` +
  `fosWorker.ts`) — this is many LLM calls (minutes, not seconds), exactly
  what the long-review machinery was built for. 202 + poll, survives PM2
  restart, progress by section («Билеты: 12 из 20…»).

- **Persistence:** new `fos_documents` table — discipline/course link,
  `sections JSONB` (editable, like РПД-студия sections), status,
  `generated_at`. Teacher edits sections in place; **AI drafts, teacher is
  author of record** (same rule as РПД-студия — never auto-final).

- **Export:** DOCX is non-negotiable (УМУ lives in Word; a ФОС gets edited
  and signed, not framed) — `docx` npm package, new dependency (**user
  runs the install** — agent env can't). Branded PDF as the second format
  via the existing `programReportPdf.ts` pdfkit path.

- **Entry points:** programme detail → Документы tab (per-discipline
  «Собрать ФОС» next to the conformance check); РПД-студия (generate from
  the drafted РПД); Materials hub card.

- **Phasing:**
  - **v1 (teacher-scoped):** from a предмет with a syllabus — topics from
    `syllabus_text`, competencies extracted ad hoc from the uploaded РПД
    if present. Ships without touching the programme model.
  - **v2 (programme-integrated):** when the discipline is linked in the
    org tree, паспорт pulls the real indicator decomposition and the
    conformance check cross-references the ФОС («ФОС покрывает 14 из 16
    индикаторов»). This is the accreditation-grade version that sells the
    institution tier.

- **Gating:** new `fosGenerator` plan flag, Pro+ (`canUseFeature`, rule
  #4). Institution tier could add the v2 programme integration as its
  exclusive.
- **Touches:** new `services/fosGenerator.ts` + worker + `routes/fos.ts`
  (or extend curriculum routes), migration for `fos_documents`, билеты
  prompt + deterministic balance validator (+ unit tests, prompt-path
  tests per workflow rule), `FosStudio.tsx` page (section editor, reuse
  РПД-студия patterns), export endpoints, `docx` dependency,
  `planLimits.ts`, FEATURES.md + CHANGELOG.md same-commit updates.
- **Sequencing:** independent; v1 has no blockers. Do v1 before Feature V
  (УМЦ dashboard) — a readiness matrix is more compelling when ФОС
  existence/coverage is one of its columns.

### Y. Live lecture mode — QR quiz during the лекция · Effort: M–L · 🟢 v1 SHIPPED

**Status (2026-07-17):** v1 shipped — «Запустить в аудитории» button on the
quiz result screen (`Quizzes.tsx`) creates a session and opens a chrome-free
projector view at `/live/host/:sessionId` (`LiveSessionHost.tsx`, reuses
`ProtectedRoute` directly instead of `AppShell` — no new routing pattern
needed). Students join anonymously at `/live/:code` (`LiveJoin.tsx`, eager-
imported like `StudentWrite.tsx`) with a server-issued `participant_token` as
their sole credential; answer-once is a real DB unique constraint
(`live_answers (participant_id, question_index)`), not client trust. State
machine (`lobby → question → reveal → … → finished`) is a pure, unit-tested
function (`services/liveSessions.ts`'s `nextStatus()`). Short polling (~2s),
confirmed as the right transport call — no WebSocket infra exists anywhere
in this codebase, and it would need sticky sessions/pub-sub across the
2-worker PM2 cluster for a v1. New `liveLimiter` (participant-token-keyed,
not IP — a lecture hall behind one campus IP would otherwise collide across
students) replaces `generalLimiter` for the new routes via an extension to
its `skip` predicate. Plan gating: 1 session/mo free, unlimited Pro/
Institution, via a bespoke `checkLiveSessionMonthlyLimit` (deliberately
**not** wired into `checkMonthlyLimit`'s closed union — see that function's
own comment for why). Router split mirrors `publishedAssignments.ts`/
`publicWrite.ts` exactly (authenticated host router + wholly public join
router, own unauthenticated axios client). New `live_sessions`/
`live_participants`/`live_answers` tables (migration
`081_live_quiz_sessions.sql`). Lobby screen renders a real `<QRCodeSVG>`
(`qrcode.react`) alongside the join code. 6 unit tests (`liveSessions.test.ts`).

**Not built (deliberately — documented v1 scope, not a gap):** the §3.1
WebRTC/ASR/confusion-heatmap extensions remain the research-track follow-on;
per-question live results don't yet feed cohort analytics or auto-generate a
«разбор ошибок» (Research.md §9.3) — a natural fast-follow once usage data
exists.

**Update (2026-07-17) — first real classroom use surfaced a genuine gap and
several bugs, both now fixed:**
- **Self-paced mode added**, chosen at launch alongside the original
  teacher-paced one — students were stuck waiting for the whole room on
  every question, which both rushed slow students and opened a
  "watch your neighbour's timing" risk on tests without discussion.
  `live_participants` gained its own `current_question_index`/`finished_at`
  (migration `082_live_session_mode.sql`); a self-paced participant's
  `lobby|question|reveal|finished` status is derived per-participant
  server-side, reusing `LiveJoin.tsx`'s existing render logic unchanged — only
  a new «Далее» button (`POST /api/live-join/:code/advance`) drives their own
  progression. Host projector shows a live roster (`RosterView`) instead of a
  shared histogram for this mode.
- **Fixed:** the "Сессия недоступна" bug — `/state` polling 404'd once a
  session finished (the query excluded finished sessions; that exclusion
  should only ever have gated *joining*), so students saw an error instead of
  their results.
- **Fixed:** the host projector screen rendered no question/answer text at
  all, only letter badges and counts — it never fetched the quiz.
- **Fixed:** reveal never showed the student's own (possibly wrong) pick or
  the question's explanation, both already generated and shown in the
  regular quiz-card view.
- **Fixed:** nickname was optional, making results unattributable to a
  specific student — now required.
- **Fixed:** students never saw their own final score, only "Спасибо за
  участие!" — now shown once their attempt reaches `finished`.
- **New: «Сохранить в журнал»** — the teacher asked how a live-quiz score
  factors into a student's semester grade, since results previously lived
  only in `live_sessions`/`live_participants`, isolated from `assignments`
  (История, student trajectory, cohort analytics). A review screen on the
  finished view maps each participant's nickname to a real student (name +
  group, same autocomplete as `GradingForm.tsx`), converts score to 5/4/3/2
  (`scoreToGrade()`), and writes it through the same create→approve pipeline
  every other grade uses — not automatic; the teacher confirms first, same
  posture as every other AI/automated output on this platform.
  `live_participants.assignment_id` (migration
  `083_live_session_journal_link.sql`) makes re-saving idempotent.

Original design notes below.

From the 2026-07-16 wow-feature slate ([Research.md](Research.md) §9.5);
the deliberate v1 slice of the §3.1 live-lecture engagement layer —
**no WebRTC, no ASR, no confusion heatmap** — just the Kahoot-style moment
grounded in the teacher's own generated materials.

- **Flow:** teacher opens a quiz (or a presentation with an attached quiz)
  → «Запустить в аудитории» → projector-friendly host screen with a QR
  code + short join code → students scan and join from phones with **no
  account** (anonymous or nickname-only — same no-student-portal
  philosophy as `/write/:token`, and cleaner 152-ФЗ posture than
  attestation since nothing identifies a person; consent gate not needed
  for anonymous aggregate answers, mirror the §5.1.2 aggregate-only
  principle anyway) → teacher advances questions one at a time → students
  answer once per question → live histogram + correct-answer reveal on the
  projector.

- **Transport decision — short polling, not WebSockets.** The backend runs
  a 2-worker PM2 cluster; WebSockets would force sticky sessions or a
  Redis pub/sub layer — real infra for a v1. Short polling (student page
  polls session state every ~2s; host polls answer counts every ~2s) rides
  entirely on existing HTTP/nginx/rate-limit infrastructure and is
  consistent with the platform's existing poll-for-results patterns
  (async grading, long reviews). A 100-seat lecture hall ≈ 50 rps of
  trivial indexed reads — fine on current sizing, but give the poll
  endpoints their own rate-limit bucket (`rateLimits.ts`) so a lecture
  hall can't trip the general limiter, and keep the state query to one
  indexed SELECT. WebSockets become the v2 upgrade if usage proves demand
  (revisit alongside `docs/scaling.md` Tier 2).

- **Schema (migration):**
  - `live_sessions` — id, teacher_id, quiz_id, join_code (6-char, unique
    among active), status (`lobby | question | reveal | finished`),
    current_question_index, created_at/finished_at.
  - `live_participants` — session_id, participant_token (server-issued),
    nickname nullable.
  - `live_answers` — session_id, participant_token, question_index,
    choice_index, answered_at; unique (session, participant, question) —
    answer-once enforced by constraint, not client.
  - On finish: per-question aggregate persisted onto the session row
    (JSONB) so the raw answers can be pruned later.

- **Routes:** authenticated — create session, advance/reveal/finish, host
  state; public tokenised — join by code (issues participant token),
  session state, submit answer. Join/submit validated + rate-limited;
  join codes expire with the session.

- **Frontend:**
  - `LiveSessionHost.tsx` — projector mode: big QR (client-side `qrcode`
    npm, small frontend dep — **user runs the install**), participant
    counter in lobby, question view with live answer-count bar, histogram
    + reveal, next/finish controls. Large type, dark-friendly.
  - `LiveJoin.tsx` (public route `/live/:code`) — mobile-first: nickname
    (optional), waiting state, answer buttons, per-question
    got-it/locked-in state, final «Спасибо». Zero chrome.
  - Entry points: quiz history rows + quiz result screen («Запустить в
    аудитории»), Presentations result for a related quiz.

- **After the lecture:** session summary for the teacher (per-question
  correct %, hardest question). v1 stops there; feeding results into
  cohort analytics or generating a «разбор ошибок» (Research.md §9.3) is
  the natural fast-follow that turns a gimmick into a loop.

- **Gating:** new `liveSessions` plan flag — Pro+; Free gets 1 session/mo
  as the teaser (this feature markets itself to everyone in the room).
- **Touches:** migration (3 tables), `routes/liveSessions.ts` +
  validation + dedicated rate-limit bucket, small `services/liveSessions.ts`
  (state machine + aggregation; pure where possible, unit-tested),
  `LiveSessionHost.tsx`, `LiveJoin.tsx` + public route in `App.tsx`,
  quiz-page entry buttons, `qrcode` frontend dep, `planLimits.ts`,
  FEATURES.md + CHANGELOG.md same-commit updates.
- **Risks / open questions:** projector UX needs real-room testing
  (contrast, QR size at distance); Wi-Fi quality in auditoriums argues
  for tolerant polling (retry, don't error-flash); decide whether
  nickname display on the histogram screen is wanted at all (anonymous
  histogram is safer and still fun).
- **Sequencing:** independent of X; no blockers. The §3.1 research-track
  extensions (comprehension pings, slide-aligned questions, ASR) build on
  this session/participant substrate later.

### Z. Market-evidence layer + РОП-студия — defensible labor-market justification at design time · Effort: pilot S–M, full track L+ (phased)

From the 2026-07-21 discussions with the head metodist at the test university.
Her ask started as "add РосНавык-like features"; the distilled need is
narrower and better: **defensible market evidence at the moment of designing
a programme, a ФОС, or a topic list** — plus a **РОП-студия** (programme-level
sibling of РПД-студия) as the surface where that evidence lives.

**Her verbatim request (2026-07-21), preserved because it defines the real
flagship artifact — «Студия РОП … для обоснования открытия новой ОП»:**
средняя зарплата на рынке · компетенции · вакансии и востребованность ·
стратегия развития промпартнера (указан в ООП) · его кадровая ёмкость и
средняя зарплата (возможно Росстат знает) · особенности отрасли ·
нацпроекты · федеральные проекты · стратегия развития университета (файл
на сайте) — «что-то вроде rosnavyk.ru».

**Design consequence — her nine data points split into TWO planes, and only
one is market data:**

- **Plane 1 — structured market data** (the pull-based design below):
  вакансии/востребованность, компетенции (via профстандарты/AA),
  **зарплаты** — salary ranges ride free on the same vacancy snapshots
  (aggregate per profession × region), cross-checkable against **Росстат
  open data** (official avg salary by industry × region — citable in an
  official dossier in a way job-board numbers aren't; add as a second
  provider behind the same `labourMarket` interface).
- **Plane 2 — grounded document evidence** — стратегия промпартнера,
  стратегия университета, нацпроекты/федпроекты, особенности отрасли.
  These are *documents, not feeds* — and grounded generation over uploaded
  documents with verbatim citations is machinery the platform **already
  has** (documentExtractor → chunker → embeddings → `docChat`-style
  retrieval, `validateCitation`). What's new is only **scoping tiers** for
  reference documents: *platform-shared* (паспорта нацпроектов/федпроектов
  — public PDFs, curate once like AA's registry), *institution*
  (стратегия развития университета — the "файл на сайте"), *programme*
  (промпартнер strategy docs, uploaded by the РОП). Each dossier section
  cites its source class verbatim.
- **Honest limit — кадровая ёмкость промпартнера:** no reliable open
  per-company source (Росстат is industry/region-level, not per-company).
  v1 proxy: the partner's *live vacancy count* from Plane 1 + whatever
  their own uploaded strategy doc claims (cited as the partner's claim,
  not as fact). Set this expectation with her explicitly rather than
  over-promising.

**The flagship artifact this defines: the «обоснование открытия новой ОП»
dossier** — one generated, citation-grounded document assembling both
planes: market demand + salaries (Plane 1, dated snapshots) · компетенции
chain (AA/Z) · industry context + нацпроект alignment + partner and
university strategy fit (Plane 2, verbatim quotes). Higher-stakes and
better-defined than a generic «обоснование актуальности» — this is what
goes to the учёный совет / КЦП process when opening a programme. РосНавык
can supply Plane 1 only; Plane 2 + the assembled dossier is exactly the
inside-the-workflow ground they can't reach.

**Explicitly NOT the goal:** replicating РосНавык (rosnavyk.ru, ТГУ) — their
1.5M-vacancies/day monitoring pipeline, 3-year retrospective, and 90-expert
taxonomy are a data-platform business we have neither the team nor the
resources to build, and don't need to. See the new line under *Intentionally
NOT building*.

- **The reframe that makes this buildable — pull, not push.** Market evidence
  is needed at a *design moment* (a specific направление, region, and
  профиль), a few dozen times a year per institution — not continuously.
  So: fetch on demand — a few hundred targeted vacancy queries per design
  session, cached per (направление, region), every vacancy **snapshotted with
  date + source and archived**. A service module in the existing stack, not a
  data platform. The archive is the long game: for the направления our users
  actually design, we accumulate our own retrospective as a free usage
  byproduct.
- **Data sources (in trust order):**
  1. **Профстандарты (Минтруд)** — the legal spine. ФГОС 3++ *requires*
     programme alignment with профстандарты; they're free, structured
     (трудовые функции → трудовые действия → умения → знания), and carry
     legal force. This is the taxonomy — we don't hand-build one, and LLM
     skill extraction anchors to профстандарт vocabulary instead of
     free-forming labels.
  2. **Работа в России (trudvsem.ru) open API** — free, legal, official
     state portal; arguably *more* citable in accreditation documents than
     commercial boards.
  3. **HH open API** — supplementary breadth. **Check ToS for analytical
     reuse before depending on it.**
- **The artifact, not a dashboard.** Output is a citable evidence chain
  embedded in the document itself: профстандарт clause (legal anchor) →
  dated vacancy snapshots (market confirmation: "N работодателей региона
  называют навык X") → ОПОП competency → course → ФОС item. Every claim
  traceable to a verbatim, dated source — `validateCitation` philosophy
  (rule #2) applied to market evidence. A skill claim must trace to BOTH a
  профстандарт node AND verbatim vacancy text, which makes LLM extraction
  errors survivable. РосНавык gives a dashboard you screenshot; we generate
  the «обоснование актуальности» section itself.
- **The compounding moat — the crosswalk, not the vacancies.** Vacancy data
  is a commodity (РосНавык, HH, ВНИИ труда all have it). What accumulates
  only inside a design workflow is the mapping профстандарт ↔ ФГОС
  компетенция ↔ программа ↔ курс ↔ РПД ↔ ФОС item ↔ (post-LTI) student
  outcomes. Every programme designed here densifies that graph; РосНавык
  structurally can't build it — they're absent at the design moment and
  never see the ФОС or the student. Long-term this makes us a *partner or
  customer* for their breadth, not a competitor.

**Pilot slice (phase 0) — validate before building anything general:**
ONE направление at the test university. Ingest the relevant профстандарт(ы)
+ a trudvsem/HH pull for the matching profession profiles in the region →
generate one «обоснование актуальности» section with full citations → put
it in the metodist's hands. Cheap, high-impact pilot extension now that her
verbatim ask is known: include ONE Plane-2 document — the university's own
стратегия развития (a single public file) — so the pilot artifact
demonstrates both planes and previews the dossier, at the cost of one
document upload through existing machinery. **Success test:** "I would put
this in front of the учёный совет." If instead it's "nice, but I still need the РосНавык
dashboard," the dashboard IS her product — license, don't build. Three weeks
of learning vs. two quarters of the wrong platform.

- **Phases (each gated on the previous one's validation):**
  - **0. Pilot slice** (above) · S–M. Hardcoded направление is fine;
    the only deliverable is the artifact + her verdict.
  - **1. `labourMarket` service behind an interface** — mirror the
    `llm/registry.ts` provider-abstraction pattern so the source is
    swappable (trudvsem/HH today, licensed РосНавык/other feed later
    without touching consumers). Snapshot store (`vacancy_snapshots` +
    `profstandard_nodes` tables), per-(направление, region) caching,
    profession-profile → query mapping, **salary aggregates from the same
    snapshots + a Росстат open-data provider** (official avg salary by
    industry × region) behind the same interface.
  - **1b. Reference-document tiers (Plane 2)** — extend the existing
    document pipeline with a scoping tier (`platform | institution |
    programme`) for evidence docs: curate паспорта нацпроектов/федпроектов
    once platform-wide; institution admins upload the university strategy;
    РОПы attach промпартнер docs to a programme. No new extraction/RAG
    machinery — reuse documentExtractor/chunker/embeddings + verbatim
    citation validation.
  - **2. Wire into existing surfaces:** «Обоснование актуальности» block in
    РПД-студия (L) / syllabusReview (K); demanded-skills cross-reference in
    the ФОС generator's coverage check (X) — "навык востребован, но не
    оценивается ни одним средством"; market-aware research-topic generation
    in Topics.
  - **3. РОП-студия + the «обоснование открытия новой ОП» dossier** —
    programme-level studio above РПД-студия: учебный план structure,
    competency matrix (builds on the `program_disciplines.competency_codes`
    model from K/X-v2), and the **dossier generator as the flagship
    artifact** — sections assembled from both planes (market demand +
    salaries with dated snapshots; компетенции chain; отрасль/нацпроект/
    partner/university-strategy fit with verbatim quotes), editable like
    every studio (AI drafts, РОП is author of record), DOCX export (the
    учёный совет lives in Word — reuse X's `docx` path). This is also the
    natural home of the crosswalk graph — relations tables first, same v1
    posture as Feature O.
  - **4. Student-facing** (post-LTI, much later): transcript vs. skill
    profile of a target profession — the thing РосНавык can never do
    because they don't have the student's academic record. Do not design
    this before phases 0–3 prove out.
- **Touches (phases 0–2):** new `services/labourMarket/` (interface +
  trudvsem/HH/Росстат providers + snapshot archiving + salary aggregates),
  new `services/profstandards.ts` (ingest/parse), migration
  (`vacancy_snapshots`, `profstandard_nodes`, evidence-link table, document
  scope tier for Plane-2 reference docs), new evidence-section generator
  reusing the `chatJSON` + citation-validation patterns, blocks in
  `RpdStudio`/`FosStudio`/`Topics`, routes + plan flag.
- **Gating:** new `marketEvidence` plan flag — Institution tier (the buyer
  is the УМУ/проректор, same as V/X-v2); possibly Pro for the Topics slice.
- **Risks / open questions:** trudvsem API coverage/quality for specific
  regions (validate in phase 0 before promising anything); HH ToS on
  analytical reuse; профстандарт parsing (PDF/XML variance across
  standards); LLM skill-extraction precision — mitigated by the dual-anchor
  rule but needs a small eval set in phase 0; freshness expectations
  (snapshots are point-in-time by design — the artifact says "по состоянию
  на дату", which is exactly what an accreditation document wants).
- **Sequencing:** phase 0 is independent and can start now — but **do
  Feature AA's v1 slice (one-направление ФГОС ingestion) inside it**: the
  pilot needs to know which профстандарты apply to the направление, and the
  ФГОС appendix is the legally correct, minimal way to know (vs. guessing
  the mapping ourselves). Phase 2's ФОС wiring pairs naturally with X-v2
  (programme-integrated ФОС); phase 3 builds on K's competency model and
  should follow, not precede, real РОП demand from the pilot university.
  Related: O (knowledge graph) — the crosswalk here is the
  institutional-scale sibling of O's per-course concept graph; keep the
  relations-table schemas compatible.

### AA. ФГОС 3++ registry — normative reference layer + ПК-конструктор · Effort: v1 S (inside Z's pilot), full M · 🟢 v1 SHIPPED (2026-07-22)

**v1 shipped:** single-standard ingestion — upload PDF/DOCX → `extractText`
(existing `documentExtractor.ts`) → one `chatJSON` pass (`services/fgosExtractor.ts`)
pulling УК/ОПК (each verbatim-checked against the source via
`validateQuoteAgainstSource`, `lib/citation.ts` — unverified formulations are
flagged, not dropped, for the admin to fix), structural block requirements,
and the профстандарт appendix → editable admin review screen
(`pages/admin/AdminFgos.tsx`) → confirm/publish (never auto-published — a
standard stays `status='draft'` until confirmed, same AI-never-final posture
as every other extraction pipeline). Platform-wide reference data — gated by
`requireAdmin` (platform owner only, not institution admin — a ФГОС is
federal law, identical for every institution), own route file
(`routes/adminFgos.ts`, mounted `/api/admin/fgos`) rather than growing
`routes/admin.ts`, matching how `orgUnits.ts`/`rpdMonitor.ts` got their own
files for the same reason. Migration `088_fgos_registry.sql`: `fgos_standards`
/ `fgos_competencies` / `fgos_structure_requirements` / `fgos_profstandard_refs`
— the last has no FK to a профстандарт table yet since Feature Z (which
would own `profstandard_nodes`) doesn't exist; plain columns for now,
forward-compatible for a join column later. 6 unit tests
(`fgosExtractor.test.ts`) + 7 integration tests (`adminFgos.integration.test.ts`,
covering the `requireAdmin` gate, the full extract→create→publish round
trip, and that extract alone never writes to the DB). Verified live against
a real synthetic ФГОС document end-to-end (real `chatJSON` call, both
competencies correctly extracted and verbatim-verified).

**Bulk import from fgosvo.ru — 🟢 SHIPPED (2026-07-22):** seeding the
registry standard-by-standard doesn't scale to the ~700 ФГОС 3++ documents
fgosvo.ru publishes, so this extends v1 with the same "paste a link, get a
checklist" pattern already shipped for РОПы' bulk РПД import (Feature AD,
`SvedenImportModal.tsx`). Two-level auto-crawl: the admin pastes one top
listing URL (e.g. `https://fgosvo.ru/fgosvo/index/24` for bachelor's) →
new `services/fgosvoParser.ts` (pure, dependency-free, verified against real
fetched markup — fgosvo.ru renders every row, at both the category-listing
and direction-listing level, as a non-nesting `<div class="item d-flex">`
block, which is what makes tag-level regex parsing safe here without a real
DOM) → the backend follows every category link and returns one combined
checklist across all ~50 categories (`POST /discover`) → admin reviews/
unchecks/adjusts level per item → each checked item is fetched, extracted,
and landed as a **draft** one at a time (`POST /import-one`, client-driven
loop — same reasoning as Feature AD: hundreds of sequential LLM calls in one
HTTP request would risk timeouts). `already_imported` cross-references each
`(direction_code, level)` against the existing registry so re-running
discovery doesn't re-suggest what's already there. fgosvo.ru is a single,
fixed, platform-controlled source, so its domain allowlist is hardcoded
(`fgosvo.ru`) rather than reusing the per-institution
`document_fetch_domains` allowlist the sveden importer needs.

Since bulk-imported drafts are too numerous to hand-review at import time
(rule #3 still holds — nothing publishes without a human confirm, it just
happens later), `AdminFgos.tsx` gained a second capability it was missing
even for v1: **clicking an existing registry row now opens it into the
review screen** (`getFgosStandard` → maps to `FgosDraft` shape → the
existing `publishMut` already branched on `standardId`, so no mutation
changes were needed, just the load-and-open wiring). Without this, a
bulk-imported draft would have been permanently unreachable.

8 new unit tests (`fgosvoParser.test.ts`, against real fetched HTML
excerpts) + 5 new integration tests (`adminFgos.integration.test.ts`,
mocking `documentFetch`/`chatJSON`: requireAdmin gate, multi-category crawl
aggregation, `already_imported` dedup, single-item import lands as draft,
missing-field validation). Verified live in the browser against the real
fgosvo.ru site: one paste discovered 188 направления across 51 categories
correctly grouped and coded; imported two real standards end-to-end (real
PDF fetch → real `chatJSON` extraction → landed as drafts); opened one from
the list and published it through the existing review screen.

**Follow-up found while reviewing real imported data (2026-07-22):** two
issues, one real and fixed, one investigated and not a bug.
- **Review-screen layout bug — fixed.** `AdminFgos.tsx`'s shared `inputCls`
  baked in `w-full`; every field appending a narrower `w-XX` class on top
  (competency code, min/max credits, профстандарт code) lost that fight —
  Tailwind's generated stylesheet orders `w-full` after the numeric width
  scale, so it silently won every time, squeezing the sibling field (often
  the formulation textarea) down to a near-zero-width sliver that wrapped
  text letter-by-letter. Looked like missing/truncated data; wasn't — the DB
  already held full 17-competency, multi-block records. Fixed by dropping
  `w-full` from the shared class and adding it explicitly only at the one
  call site that needs it.
- **Empty профстандарты — investigated, mostly not a bug.** Suspected the
  48000-char `MAX_TEXT_CHARS` truncation cutoff (`fgosExtractor.ts`) was
  cutting off the appendix, which sits near the end of the document. Checked
  two real documents directly (54.03.04 «Реставрация»: 3 профстандарты
  correctly extracted; 58.03.01 «Востоковедение и африканистика»: 0) — both
  fully extracted at 32-36k chars, well inside the old budget, and the
  58.03.01 PDF genuinely has no «Перечень профессиональных стандартов»
  appendix section in its text at all (confirmed by searching the extracted
  text directly). Across 20 already-imported standards, only 2 came back
  with 0 профстандарты — consistent with "some directions really don't have
  one," not systematic truncation. Still raised `MAX_TEXT_CHARS` from 48000
  to 120000 as a safety margin for actual 40-page documents (a 12-page
  document already ran to ~33-36k chars, ~2.7-3k chars/page — 48000 left
  almost no headroom for the format's documented page-count range).
- **OCR for scanned PDFs — already wired up, no new code needed.** Asked
  about connecting Yandex OCR the way grading does; `services/documentExtractor.ts`'s
  `extractText()` (shared by grading, program import, and ФГОС ingestion
  alike) already falls back to `yandexVisionOCR()` whenever `pdf-parse`
  extracts fewer than 50 words, chunking through Yandex's 8-page-per-call
  cap via `pdf-lib`. ФГОС ingestion already calls this same shared function,
  so scanned ФГОС PDFs already OCR automatically — confirmed
  `YANDEX_VISION_API_KEY`/`YANDEX_FOLDER_ID` are configured.

**List UI: color-coded level badges + pagination/search/filter
(2026-07-22).** The registry crossed 376 rows mid-import (magistratura,
специалитет, ординатура all still to come on top of bakalavriat) and the
flat list was already unreadable, all badges one color. `db/queries/fgos.ts`
gained `listFgosStandardsPage({page, limit, search, level})` (LIMIT/OFFSET +
`COUNT(*)`, same shape as `admin.ts`'s `/teachers` pagination) alongside the
existing unpaginated `listFgosStandards()`, which stays as-is — bulk
import's `/discover` dedup needs every existing `(direction_code, level)`
pair, not one page of them, so it keeps its own function rather than the
route reusing the paginated one. `GET /api/admin/fgos` now takes
`page`/`limit`/`search`/`level` query params, responds `{ standards, total
}`. Frontend: search input + a `Select` level-filter dropdown (house
pattern from `AdminTeachers.tsx`/`AdminAudit.tsx` — page resets to 1 on
either changing), `← Назад / X из Y · N всего / Вперёд →` pager footer.
`LEVEL_COLOR` gives fgosvo.ru's four ФГОС ВО (3++) categories
(бакалавриат/магистратура/специалитет/ординатура) their own
`bg-*-bg text-*` token pair (amber/info/success/warning) instead of one
shared amber for every level; `ординатура` was also missing from
`LEVEL_LABEL` entirely (a copy gap from v1) — added. 2 new integration
tests (search-by-code-or-title, level filter, page/limit bounds). Verified
live: search narrowed 376 → 4 rows, level filter narrowed 4 → 2, pager
showed "1 из 19 · 376 всего" and paginated to a second page correctly.

**Test-infrastructure finding surfaced while verifying — 🟢 FIXED (2026-07-22):**
the integration test harness's per-test `BEGIN`/`ROLLBACK` isolation
(`vitest.setup.integration.ts` + `DB_POOL_MAX=1`) didn't correctly nest
against query functions that open their own transaction via
`pool.connect()` + `BEGIN`/`COMMIT` (e.g. `createOrgUnit`, `moveOrgUnit`,
this feature's `createFgosStandardDraft`/`publishFgosStandard`, and others)
— with pool size 1, the inner `COMMIT` committed the *outer* test
transaction too, so `afterEach`'s `ROLLBACK` had nothing left to undo and
rows leaked permanently into the shared test database. Confirmed real and
long-standing: `gradeassist_test` held hundreds of orphaned `institutions`/
`org_units`/`teachers` rows, invisible until now because no existing
integration test asserted an exact/empty row count — they only check "does
my own returned id appear," which stays true regardless of accumulated
garbage.

Fixed via savepoint-wrapping the test pool only (zero production code
changes): new `db/__tests__/transactionalTestIsolation.ts` patches
`pool.connect()` inside integration test setup so the returned client's
`BEGIN`/`COMMIT`/`ROLLBACK` get rewritten to
`SAVEPOINT`/`RELEASE SAVEPOINT`/`ROLLBACK TO SAVEPOINT` when nested inside
the outer per-test transaction (tracked by real transaction depth, not by
call site). Three bugs found and fixed along the way: (1) naive rewriting
without depth-tracking also rewrote the outer test's own `BEGIN`, since
`pg-pool`'s internal `Pool.prototype.query()` acquires its connection via
the same public `connect()`; (2) the patched `connect()` only supported
promise-style calls, silently dropping the callback `pg-pool` uses
internally, which hung every test and permanently leaked the sole
connection; (3) `pg-pool` reuses the same `PoolClient` object across
checkouts with `DB_POOL_MAX=1`, so wrapping `.query` without an idempotency
guard compounded a new layer on every `connect()` call. Regression test
(`db/transactionalTestIsolation.integration.test.ts`) proves a
`pool.connect()`-based write is genuinely rolled back. Verified via two
consecutive full integration suite runs against a cleaned DB — `psql` row
counts for `institutions`/`org_units`/`teachers`/`fgos_standards` stayed at
exactly 0 after both runs (previously grew every run); unit suite (414
tests) unaffected.

Follow-on from the Feature Z design discussion (2026-07-21). One ФГОС ВО per
(направление, level), published by Минобрнауки on fgosvo.ru. Today the
platform has no ФГОС representation at all — `program_competencies` /
`program_disciplines.competency_codes` are **hand-typed per programme** by
the admin, so every downstream consumer (K's conformance check, X-v2's
паспорт ФОС, L's generation spec, Z's planned РОП-студия matrix) checks
against *whatever was typed*, not against the standard. A typo'd or stale
competency list silently corrupts every check built on it.

**Depends on / pairs with Z:** Z's evidence chain actually starts here —
the ФГОС is the document that *legally names which профстандарты apply* to
a направление (its appendix), and under 3++ the ПК are not in the ФГОС at
all: the university derives them from those профстандарты. Without this
layer, Z's профстандарт selection is our guess; with it, the full chain
**ФГОС → профстандарт → рынок труда → ОПОП → РПД → ФОС → оценка** is
anchored in the top-level normative document end-to-end. Z phase 0 should
ingest its pilot направление's ФГОС as step one (see Z's sequencing note).

- **What a ФГОС decomposes into (all machine-usable):**
  1. **УК** — fixed list, uniform across all ФГОС of the same level.
  2. **ОПК** — fixed list per ФГОС; closed, citable verbatim.
  3. **Structural requirements** — объёмы in з.е. per block (Блок 1/2/3),
     total volume, ЭИОС and other numeric/checkable constraints.
  4. **Профстандарт appendix** — the legal join point to Feature Z.
- **Shape: shared reference data, admin-curated.** ФГОС is federal law, not
  institution data — one registry shared by every institution on the
  platform, ingested/reviewed by a platform admin, slowly-changing
  (updates only on a Минобрнауки приказ). A few dozen направления covers
  the realistic customer base; not all ~500 on day one.
- **Ingestion:** upload the ФГОС PDF/DOCX → existing `documentExtractor` →
  one structured `chatJSON` extraction → **admin review screen → publish**.
  Unusually safe LLM territory: competency codes follow a rigid grammar
  (`УК-1`, `ОПК-3`…), formulations must validate **verbatim against source
  text** (rule #2, `validateCitation` philosophy), numeric requirements
  are exact matches. Never auto-publish — same AI-never-final posture as
  everything else.
- **Schema:** `fgos_standards` (направление code, level, title, generation,
  приказ №/date, source URL, effective date) · `fgos_competencies`
  (type `УК`/`ОПК`, code, verbatim formulation) ·
  `fgos_structure_requirements` (block volumes + numeric constraints) ·
  `fgos_profstandard_refs` (appendix → joins to Z's `profstandard_nodes`).
- **Consumers, in payoff order:**
  1. **Programme creation auto-populate** — admin picks направление →
     УК/ОПК flow into `program_competencies` verbatim from the registry
     instead of hand-typing. Cheapest win; upgrades every existing check
     from "vs. what we entered" to "vs. приказ №N" (accreditation-grade
     citation for free).
  2. **ПК-конструктор** — the genuinely 3++-native feature: derive ПК
     candidates + indicators from the профстандарты the ФГОС names
     (трудовые функции → suggested formulations), admin edits and
     approves. Reuses Z's профстандарт ingestion; automates the step
     РОПы do painfully by hand today.
  3. **Учебный план structural check** — programme block volumes vs.
     `fgos_structure_requirements`. Deterministic, **no LLM**, extends
     `programAnalysis` («Блок 2: 21 з.е., ФГОС требует ≥ 30»). Very
     demo-able.
  4. **Silent upgrade of K / L / X-v2 / РОП-студия** — their competency
     source becomes registry-fed rather than manual; no UX change needed
     beyond a "источник: ФГОС 09.03.03 (приказ №N)" badge.
- **Touches:** migration (4 tables above), `services/fgosRegistry.ts`
  (ingest/extract/validate), platform-admin review page under
  `pages/admin/`, направление picker + auto-populate hook in the programme
  creation flow, `programAnalysis` extension for the structural check,
  registry-sourcing switch in `documentReview.ts` (K) with manual entry
  kept as fallback for programmes without a registry match.
- **Gating:** the registry itself is platform infrastructure (no flag);
  consumers keep their existing gates (K/X-v2/РОП-студия are
  Institution-tier surfaces). ПК-конструктор rides Z's `marketEvidence`
  flag or Institution tier directly — decide when Z phase 1 lands.
- **Phasing:**
  - **v1 (inside Z phase 0):** ingest ONE направление's ФГОС — standards
    row + УК/ОПК + профстандарт refs. No admin UI yet (seed script is
    fine); exists to anchor Z's pilot artifact.
  - **v2:** admin review/ingestion UI + programme-creation auto-populate
    (consumer 1) + structural check (consumer 3).
  - **v3:** ПК-конструктор (consumer 2, needs Z phase 1's профстандарт
    ingestion) + registry-sourcing in K/X-v2 (consumer 4).
- **Risks / open questions:** fgosvo.ru document formats vary by
  generation/year (extraction prompt needs the eval-set treatment on 3–5
  real ФГОС before trusting it); amendment tracking (a приказ can amend an
  existing ФГОС — `effective_date` + keep superseded rows, append-only like
  rule #5, so old programme checks stay reproducible); ФГОС 4 is
  periodically announced — the registry schema should tolerate a new
  generation as new rows, not a migration.
- **Sequencing:** v1 lands inside Z phase 0 (three-week pilot unchanged).
  v2/v3 are independent of Z's later phases and can proceed on their own
  demand signal — v2's auto-populate is worth shipping early since it
  de-corrupts existing consumers regardless of what happens with Z.

### AB. Early-warning учебная аналитика — risk flags for сохранность контингента · Effort: v1 M, full track L+

From the 2026-07-21 metodist discussions (same thread as Z/AA). Her verbatim
framing: «В перспективе создание раздела предиктивной учебной аналитики для
прогнозирования отрицательной динамики успеваемости студента на основе его
результатов и реакции на обратную связь преподавателя. Эта информация может
быть у предметника, студента (общая картина успеваемости по всем предметам),
РОП и в дирекции (так как они отвечают за сохранность контингента)».

**Why:** сохранность контингента is a budget-line KPI under подушевое
финансирование — every отчисленный студент is lost funding, and дирекция
answers for the number personally. This sells to a third distinct
institutional buyer (V → УМЦ, W → HR, AB → дирекция/деканат), arguably the
one with the most acute pain. And it's an **evolution of shipped features,
not greenfield**: cohort analytics' «Требуют внимания» (Feature C) is
already a naive early-warning rule (last-2 avg dropped ≥8), and the
trajectory panel (Feature B) already does per-criterion movement matching.

- **The differentiated signal — реакция на обратную связь.** Classic EWS
  products run on LMS logins and gradebook averages. Nobody else has
  per-criterion grades over time *plus the feedback text given* — so we can
  compute whether a flagged weakness improved, stagnated, or **repeated
  with no uptake** on subsequent works ("критерий «Аргументация»:
  72 → 65 → 58 за три работы; замечание повторяется"). Post-Q, published-
  assignment telemetry adds a second novel layer (declining active time,
  rising paste ratio). Lead with this signal; grade-average trends are the
  commodity part.
- **NOT predictive ML — transparent evidence-backed rules.** «Предиктивная»
  is her word and fine for marketing; the mechanism is not. Per-student
  data volumes (a handful of works per subject per semester) make trained
  prediction statistically indefensible — confident nonsense with a
  liability attached. Ship **versioned, rule-based risk indicators where
  every flag carries citable evidence** (the `validateCitation` philosophy
  applied to risk): auditable, contestable, more trusted by teachers than
  a black-box score, and defensible under 152-ФЗ scrutiny. **Backtest
  before anyone sees it**: replay rules against existing grading history
  (eval-harness culture — measure how often the rule would have flagged
  students who actually declined) and tune thresholds on that, not on
  intuition. ML becomes a later calibration layer, only at real scale.
- **Ethics framing — locked upfront, non-negotiable (stricter than W).**
  W risks teachers seeing ИСПУМ as HR's ranking tool; this risks students
  being pre-labeled as отчисление candidates — stigmatizing and
  potentially self-fulfilling. Same neutral-process posture as §5/W:
  - The artifact is a **support signal, never a verdict** — «рекомендуемые
    меры поддержки», never «прогноз отчисления». No ranked "worst
    students" leaderboard for anyone.
  - **Tiered access via the org tree** (Feature P): предметник — own
    subjects only; РОП — programme scope; дирекция — aggregates + flagged
    cases with evidence; student — self only (see delivery constraint
    below).
  - Every flag shows its evidence and rule version — auditable end-to-end.
- **Data-coverage honesty — her «общая картина по всем предметам» is
  gated on adoption, not code.** ИСПУМ sees only what's graded through it;
  a cross-subject picture needs most of the student's teachers on the
  platform or gradebook import from the LMS/АСУ. Frame that tier as the
  institution-wide-adoption reward — which turns AB into an **adoption
  flywheel for the sale**: "the retention dashboard gets better with every
  кафедра you onboard" is the проректор's internal argument, made for us.
- **Student-facing view — LTI only.** "Full student portal" is in
  *Intentionally NOT building* and stays there. The student's own picture
  is delivered via LTI launch from inside the LMS (Feature R, shipped):
  identity sourced from Moodle, no ИСПУМ student accounts. Only endorsed
  delivery path; naturally last in sequence.
- **The closing loop (what no EWS competitor can do):** a flag isn't just
  "поговорите со студентом" — it can generate a remedial задание on the
  failing criterion (existing `tasks.ts`/Materials engines) and, once
  Feature O exists, name *which concept* is failing. Flag → diagnose →
  generate intervention → measure the delta on the next work — the same
  closed loop as W's teacher-development version, applied to students.
  Design the schema so flag → intervention → outcome is linkable from v1
  even though the generate-intervention button ships later.

- **Phasing:**
  - **v1 — per-teacher risk panel (own courses, no new permissions):**
    upgrade «Требуют внимания» into a real risk surface — add the
    feedback-reaction rules (repeated criterion failure + no improvement
    after feedback, reusing trajectory's criterion matching), evidence on
    every flag, rule versioning, and the **historical backtest as a ship
    gate**. New `services/riskSignals.ts` (pure, unit-tested, mirroring
    `cohortAnalytics.ts`), panel on Students.tsx / teacher drill.
  - **v2 — РОП/дирекция rollup:** programme- and subtree-level views
    through org-tree roles; pairs with Leadership V2 and shares Feature
    V's aggregation layer. This is where tiered access + the political
    framing land; do V first (lower-risk proof of institution-facing
    analytics, same precedent logic as V-before-W).
  - **v3 — whole picture + student self-view:** LMS gradebook import for
    cross-subject coverage (АСУ/Moodle — pairs with improvement #12's
    АСУ-integration groundwork); student view via LTI launch. Both gated
    on real institutional adoption signals, not built speculatively.
  - **v4 (only at scale):** ML calibration over the rule outputs, trained
    and validated on accumulated backtest data. Not before.
- **Touches (v1):** new `services/riskSignals.ts` + rule-version constant,
  new risk queries in `db/queries/` (extend the cohort/trajectory query
  family), backtest script riding `evalHarness.ts` patterns, panel in
  `Students.tsx` + `LeadershipTeacher.tsx`, FEATURES/CHANGELOG same-commit.
  (v2+: `routes/leadership.ts` extension, V's aggregation layer,
  `org_unit_roles` scoping; v3: gradebook-import service + LTI student
  view.)
- **Gating:** v1 rides Pro (it's a teacher-value feature at that tier);
  v2+ is Institution-tier (the дирекция surface is the paid story).
- **Risks / open questions:** false-positive cost is human, not technical
  — a wrongly flagged student wastes a куратор's meeting and can colour
  perception; backtest precision threshold must be agreed before v1 ships
  (propose: don't ship rules below ~70% backtested precision). Semester
  boundaries (a "decline" across the exam session boundary may be normal
  variance — rules need semester awareness). Small-N noise: min-sample
  gates like C's ≥3/≥4-submission thresholds, kept strict. Who acts on a
  flag at each tier (предметник vs куратор vs РОП) is an institutional
  process question — ask the metodist's university how they'd route it
  before designing v2's UI.
- **Sequencing:** v1 is independent and could follow Z's pilot; it needs
  no new data sources, only shipped tables. v2 after V (shared aggregation
  layer + precedent). v3 after real LTI/АСУ adoption at a pilot
  institution. Related: W (same trust architecture, teacher-side twin),
  O (concept-level diagnosis upgrade), Q (telemetry signals), Z/AA
  (unrelated data planes — no dependency either way).

### AC. АСУ «Университет» (Кошка) integration — file-in → structured РПД → проверка УМЦ → push to АСУ · Effort: core M, sink adapter unknown (gated on IT)

From the 2026-07-21 metodist discussions (same thread as Z/AA/AB). Her
verbatim ask: «Интеграция с АСУ Университет (Кошка). Для упрощения работы
преподавателей, чтобы они загружали в Кошку файл, а система сама
раскладывала все по пунктам — далее проверка УМЦ». The pain is
double-entry: the teacher writes the РПД as a document, then manually
re-keys it into Кошка's section-by-section forms before УМЦ review.

**Status (2026-07-21):** a meeting with the university's IT department is
being arranged (awaiting department-head greenlight). **The IT meeting is
the actual next step — no code before its outcome**, since the write-back
half is decided there, not in this codebase. This entry generalises
improvement **#12** (АСУ auto-fetch for РПД Monitor): same system, same
access wall, now a two-way integration story — resolve both in the same
IT conversation.

- **Architecture — flip her flow.** As stated, ИСПУМ is an invisible
  parsing engine behind Кошка. Build it the other way:
  **teacher uploads to ИСПУМ → structured decomposition into Кошка's
  пункты → conformance check (K) runs → УМЦ reviews in the V dashboard →
  the approved, validated record exports/pushes to Кошка.** Same teacher
  outcome, but ИСПУМ is the front door and the review workflow; quality
  checks run *before* data enters the system of record; Кошка is the
  downstream sink. Critically, it **degrades gracefully**: with zero API
  access, "upload → parsed → checked → clean export file the УМЦ batch-
  imports or re-keys from" still kills most of the pain, whereas the
  as-stated version is 100% blocked without Кошка-side access.
- **The parse half is ~80% shipped.** `documentExtractor` (incl. OCR) for
  file intake; РПД Monitor + `documentReview.ts` (K) already parse and
  reason over РПД structure; РПД-студия owns the section model in the
  generate direction; «проверка УМЦ» is literally K + V. New work is one
  structured-extraction pass targeting Кошка's field model — same
  safe-LLM-territory argument as AA's ФГОС ingestion (rigid known
  template, verbatim validation of extracted content against the source
  document, human review before anything is final).
- **The IT meeting — concrete asks (bring this list):**
  1. Does their АСУ «Университет» license include any write API, batch
     import format (XML/Excel), or integration bus? (Also covers #12's
     read direction — ask for both at once.)
  2. Кошка's РПД field model / template spec — the exact пункты the
     decomposition must target.
  3. 5–10 real (source файл → filled Кошка record) pairs as ground truth
     for extraction validation.
  4. Who owns the vendor relationship — if there's no import module,
     what would the vendor quote to enable one?
- **Expectation setting:** АСУ «Университет» is a closed vendor product;
  outcomes range from "an import module nobody turned on" to "six-figure
  vendor quote." Do not promise the push leg to the university until IT
  answers; the export-file fallback is the promise-safe version.
- **Generalisation flag:** other universities run 1С:Университет,
  Галактика, Tandem, etc. The parse + check core is universal; the sink is
  a per-АСУ **adapter** — design the export layer as a pluggable interface
  (same posture as `labourMarket`/`llm` registries) and price adapter work
  into institution-tier deals rather than absorbing it.
- **Phasing:**
  - **v0 — the IT meeting** (in motion). Outcome determines the sink leg.
  - **v1 — parse + review core (buildable regardless of v0's outcome):**
    upload → structured decomposition into the Кошка field model (from
    ask 2) → K conformance check → УМЦ review queue surface (extends V's
    dashboard scope) → export file in whatever format ask 1 yields (or
    clean DOCX/XLSX if nothing).
  - **v2 — push leg:** only if v0 surfaces a real write path; pg-boss job
    + status tracking, mirroring #12's read-side design
    (`services/asuSync.ts` becomes bidirectional).
- **Touches (v1):** new structured-extraction pass in a
  `services/asuExport.ts` (or extend `services/documents.ts`), Кошка
  field-model config (per-institution JSON, not hardcoded — feeds the
  adapter interface), УМЦ review queue page (shared surface with V —
  build V first or co-scope), export endpoint. (v2: `services/asuSync.ts`
  write path per #12's touches.)
- **Gating:** Institution tier — this is an УМЦ/institution workflow
  end-to-end; no per-teacher plan story.
- **Sequencing:** v0 now (awaiting greenlight). v1 after the field-model
  spec exists (ask 2 is a hard prerequisite — don't guess the template)
  and ideally alongside/after V, which owns the УМЦ review surface it
  needs. #12's auto-fetch rides the same v0 outcome and should ship
  under whatever access mechanism this negotiates.

### ~~AD. Bulk РПД discovery from /sveden/education — one paste instead of 44~~ — already done

**Shipped 2026-07-21** (same day it was scoped — РОПы are testing now). See
CHANGELOG for the full design. Landed as designed with one deliberate
deviation: the bulk import is **client-driven** (the confirmed checklist
feeds each item sequentially through the existing
`POST /:id/documents` + `file_url` endpoint — per-item progress and retry
for free), not a pg-boss job as the sketch below suggested; closing the
modal mid-run leaves already-imported documents in place and re-running
discovery is idempotent. New: `services/svedenParser.ts` (dependency-free,
19 unit tests), `fetchPageHtml` in `services/documentFetch.ts`,
`POST /:id/documents/discover`, `SvedenImportModal.tsx` + «Импортировать со
страницы сведений» on the Документы tab. Not built (documented scope cuts):
форма-обучения row scoping (first code-matching row wins — revisit with a
real multi-form counterexample), plan/description/график import (не
importable via this endpoint; listed as skipped counts in the UI), Z Plane-2
reuse of the discovery service. Original design notes below.

From the 2026-07-21 discussions; РОПы are actively starting to test the
platform. The shipped paste-a-link document pull works
per document — but a programme's disclosure row lists one Описание ООП +
one учебный план + **~40+ individual РПД links** + графики + практики, so
the РОП still pastes dozens of links one at a time.

**The regulatory gift that makes this reliable:** the «Сведения об
образовательной организации → Образование» page is federally mandated
(Рособрнадзор Приказ № 831 + methodology) to be machine-readable:
- **Standardized path** — `<university-site>/sveden/education` on
  essentially every Russian university site (derivable from the
  institution's known website — no URL paste needed at all in the best
  case).
- **Standardized markup** — required `itemprop` microdata attributes on
  exactly these elements (РПД links, учебный план, описание ОП,
  календарный график, практики; programme rows carry направление code +
  name), designed so Рособрнадзор's own crawler can parse them.
  Universities are audited on this markup being present and correct.

- **Flow:** РОП pastes ONE URL (or ИСПУМ derives `/sveden/education`) →
  backend fetches + parses itemprop rows → scopes to the programme by
  направление code + name match against the programme being worked on →
  **discovery checklist** («Найдено: Описание ООП · Учебный план · 44 РПД ·
  2 графика · 4 практики», РПД titles from link text — which IS the
  discipline name on these pages) → РОП confirms → bulk fetch through the
  **existing** pull-by-link pipeline, one pg-boss job per document with
  pollable progress → each РПД auto-associates to `program_disciplines` by
  name matching, with a review screen for fuzzy cases (human-confirms
  posture, as everywhere).
- **Parser tiers (degrade gracefully):**
  1. `itemprop` microdata (the mandated format — primary).
  2. DOM heuristics — links within the matched programme's table
     row/section, classified by link text + filename patterns (for sites
     with imperfect markup).
  3. Manual per-link paste (today's shipped behavior — always available).
  JS-rendered tables: do NOT chase with headless browsers in v1 — tier 3
  covers them, and the markup requirement pushes sites server-rendered
  anyway.
- **Security — deliberate pass required:** bulk server-side fetching of
  user-supplied URLs is SSRF surface. Inherit/verify the single-link
  pull's protections (scheme allowlist, block private/internal address
  ranges, no redirects to internal hosts) and add: per-host rate limiting
  / politeness, sane timeouts, per-file size caps, total-documents cap
  per discovery run.
- **Touches:** new `services/svedenDiscovery.ts` (fetch → itemprop parse →
  tier-2 heuristics → classify → discipline name-match), discovery
  checklist step in the programme import/documents UI in front of the
  existing pull flow, bulk-fetch pg-boss job (reuse the per-document pull
  as the job body), review screen for unmatched РПД↔discipline pairs,
  FEATURES/CHANGELOG same-commit.
- **Gating:** rides the existing programme/document-import gates — no new
  plan flag; it's UX leverage on shipped functionality.
- **Risks / open questions:** markup quality varies (tier 2 exists for
  this — collect real counterexamples from pilot universities rather than
  speculating); signed-PDF wrappers and экзотика formats (documentExtractor
  handles the common cases); discipline-name matching against
  `program_disciplines` needs the same fuzzy-match + review treatment as
  AC's field mapping; multi-form pages (очная/заочная rows for the same
  направление) — scope by форма обучения too, not just code.
- **Sequencing:** ⏭️ **next to build** — РОПы are testing now and this
  removes their worst manual step (44 download-upload cycles → one paste +
  one confirm). Independent of Z/AA/AB/AC. Related: AC shares the
  "external document intake at scale" theme but nothing structural; Z's
  Plane-2 document intake could later reuse the same discovery service for
  university strategy docs (they live on the same disclosure sites).

### AE. БРС engine + native interactive activities — the semester ledger governed by the РПД · Effort: v1 M, full track L

From the 2026-07-21 metodist discussions (last of the five-idea session:
Z/AA/AB/AC/AD/AE). She saw the live-quiz feature (Y), got as excited as we
are, and — being a teacher herself who has tried this via Moodle —
suggested: «Интеграция интерактивных платформ (типа Квизлет, игры, Mind
карты...) для автоматической оценки преподавателя и анализа результатов
согласно балльно-рейтинговой системе (она есть в РПД, если это тест)».

**Her ask bundles three different things with three different answers —
one is a trap, one is a pragmatic adapter, one is the sleeper product
idea of the whole session.**

- **1. Direct integration with Quizlet/Kahoot-type platforms — DON'T.**
  (a) The APIs mostly don't exist: Quizlet killed its public API years
  ago; Kahoot results live in manual XLSX exports; LearningApps/Wordwall
  offer little — per-platform adapters are a maintenance treadmill against
  surfaces that were never built for it. (b) 152-ФЗ + positioning: routing
  student activity data through foreign consumer platforms undermines the
  Russia-resident/Yandex-Cloud pitch that sells the institution tier, and
  sanctions/payment friction makes them unreliable institutional
  dependencies anyway. (c) The live-session substrate (Y) already owns the
  hard parts (session/participant/answer schema, anonymous phone join,
  self-paced mode, answer-once constraints, «Сохранить в журнал») — most
  of what those platforms do is a question-type/mode extension of it.
  **Reframe for her: we don't integrate Quizlet — we make Quizlet
  unnecessary, and everything lands in the БРС automatically.**
- **2. The sleeper — «БРС … она есть в РПД».** The балльно-рейтинговая
  система is IN the РПД, and ИСПУМ already holds the РПД (uploaded,
  monitored, authored in РПД-студия). So: **extract the БРС scheme from
  the РПД and become the semester scoring ledger.** Structured extraction
  of the БРС table — контрольные точки, max баллы per activity, оценка
  thresholds (61–75 → «удовлетворительно» etc.) — same safe-extraction
  pattern as AA/AC (rigid known structure, verbatim validation, teacher
  confirms; manual БРС builder as the no-РПД fallback). Then every
  scoring event the platform already produces — live sessions, published
  assignments, regular graded work, imported external results — maps to a
  контрольная точка and accrues into a per-student running semester score,
  converted to итоговая оценка by the РПД's own thresholds. Upgrades the
  журнал from "a list of grades" to **the teacher's semester gradebook,
  governed by the document the university already approved** (today's
  live-quiz save does a crude score→5/4/3/2; with БРС it becomes «тест =
  КТ-2, до 5 баллов из 100»).
- **3. The pragmatic adapter — universal results import.** CSV/XLSX
  upload → column mapping (student, score) with the same name-matching +
  review posture as AD/AC → into the ledger against a chosen контрольная
  точка. Kahoot exports XLSX; so does everything else — one importer
  covers every external tool ever, zero API dependencies, honors her
  existing Moodle/Quizlet habits without marrying a vendor.

- **What the БРС engine connects to (why it's the prize):**
  - **AB (early warning):** running БРС total vs. expected semester pace
    is a cleaner, evidence-backed-by-construction risk signal («набрал 12
    из 40 возможных к 8-й неделе») — feed it into AB's rule set when both
    exist.
  - **LTI AGS (shipped, R):** БРС totals write back to the Moodle
    gradebook — her Moodle habit served properly.
  - **K / УМЦ:** "assessments actually run this semester vs. the БРС the
    РПД declares" is a new conformance check that falls out nearly free —
    very V-dashboard flavored.
  - **Дирекция (AB's buyer):** БРС контрольные точки are precisely the
    instrument дирекция monitors for retention — same sale, second
    surface.
- **Phasing:**
  - **v1 — БРС engine:** extraction from РПД (+ manual scheme builder
    fallback), `brs_schemes`/`brs_checkpoints` (+ per-student accrual
    linkable to existing `assignments`/live results), semester ledger view
    on журнал/Students, checkpoint mapping on existing grade-save flows,
    threshold-based итоговая. Teacher-confirms everywhere; the РПД's
    scheme is the source of truth, never invented.
  - **v2 — universal results import** (CSV/XLSX → mapping → ledger).
  - **v3 — native activity types on the Y substrate:** flashcards /
    self-study mode first (the actual Quizlet core, generated from course
    materials via existing engines), then game modes as question-type
    extensions (matching pairs, true/false sprint, ordering, word cloud) —
    each auto-mapping to контрольные точки.
  - **Mind maps: parked with Feature O explicitly** — assessing a
    student-built concept map against the course concept graph is
    research-track, not an activity-type extension.
- **Touches (v1):** new `services/brsScheme.ts` (extraction + validation +
  accrual math, pure/unit-tested), migration (`brs_schemes`,
  `brs_checkpoints`, checkpoint link column on grade-producing rows),
  ledger UI on `Students.tsx`/журнал, checkpoint picker on the existing
  save/approve flows (grading, live «Сохранить в журнал», published
  assignments), FEATURES/CHANGELOG same-commit. (v2: import endpoint +
  mapping UI; v3: `liveSessions` question-type extensions + generators.)
- **Gating:** v1 Pro (teacher semester-ledger value); the K/V conformance
  check and дирекция surfaces are Institution-tier. v3 activity types ride
  Y's existing `liveSessions` gating.
- **Risks / open questions:** БРС formats vary by institution (and some
  РПД lack a proper БРС table — hence the manual builder fallback, which
  also doubles as the review UI for extraction); mid-semester scheme
  changes (version the scheme, append-only, rule #5 posture — old accruals
  stay reproducible); партиальная посещаемость-type checkpoints (не всё —
  оценки; посещение/активность need manual entry paths in the ledger);
  whether итоговая по БРС may conflict with what the teacher enters in
  the официальная ведомость — ИСПУМ advises, teacher decides (AI/automation
  never final, as always).
- **Sequencing:** after AD (which is ⏭️ next to build). v1 is independent
  of Z/AA/AB/AC; AB v1 should consume БРС signals if AE v1 lands first —
  coordinate whichever ships second. v3 is demand-driven fast-follow
  material once РОПы/teachers are using the ledger.

---

## Build order — locked design (§5–§7)

The §5–§7 design is locked (2026-06-27). Full institutional path is the build
target, not a demo. Committed order:

1. **Feature P — org structure tree (§7).** Foundational. Everything scopes
   through it. ~3–4 weeks. Rewrite CLAUDE.md *Admin System* + *Database Schema*
   to drop the legacy-vs-target markers **as this lands**, not before.
2. **Feature Q — published assignments + attestation (§5.1/5.3/5.5).** The
   flagship authenticity feature. ~4–6 weeks. Honour the §5.1.2 legal
   constraints from the first commit — retrofitting consent/aggregation is
   painful and an institutional legal blocker.
3. **Feature R — LTI 1.3 + IT-admin UX (§6).** Institutional rail. ~3–4 weeks
   incl. the §6.5 surface.

Deferred, designed but not in this build: §5.2 oral defense (cost model owed),
§5.4 concept probing (gated on Feature O knowledge graph), §3.x new-infra
ideas. Update the CLAUDE.md pricing matrix (Pro gains process attestation)
when Feature Q ships.

---

## Intentionally NOT building

Keeping these here so they don't get re-proposed.

- **Plagiarism / AI-generated text detection.** Antiplagiat.ru is the
  de-facto standard in Russian universities; integrate with their API if
  needed. Don't build our own classifier.
- **Mobile-native app.** PWA was the right MVP call. Revisit only when
  churn data points at the PWA as the cause.
- **Real-time collaboration on grading.** Teachers don't co-grade in real
  time; they batch async. Skip until institutional pilots demand otherwise.
- **Full student portal / LMS.** Out of scope. The public-link feature (E)
  covers the "feedback delivery" need without owning the student
  relationship.
- **A РосНавык-style labor-market monitoring platform.** No continuous
  mass-ingestion pipeline (1.5M vacancies/day), no all-professions
  dashboard, no hand-built expert skill taxonomy. Feature Z deliberately
  inverts all three: pull-based fetching at design moments, citable
  evidence artifacts instead of dashboards, and профстандарты as the
  taxonomy. If a user's real need turns out to be the monitoring dashboard
  itself, license/integrate РосНавык's data — don't rebuild their business.

---

## In progress

*(empty — pick from above)*
