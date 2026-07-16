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

**Deferred — (c) true per-subtree admin scoping.** A division/department head
limited to their own subtree. NOT a small tail: every institution route would
need its query scope reworked, plus product decisions on what each role level
sees. **No current demand** — every admin today is an institution-root admin
(from the backfill); there are no sub-unit admins to scope. Current state is
coherent and fail-closed: per-unit `head`/`viewer` and sub-unit `admin` grants
from the 1b UI are *recorded but inert* — nothing consumes them yet; only
admin-on-root grants institution access. Build (c) when a real institutional
customer needs scoped sub-unit access, so requirements are concrete rather than
speculative. Pairs with the deferred read-only dashboards (viewer role) and
the §2.x analytics features that would consume `head`/`viewer`.

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
teacher-editable with autosave (`FosStudio.tsx`); branded PDF export is
live (`services/fosReportPdf.ts`). **Not yet done:** DOCX export
(`services/fosExport.ts`) is stubbed pending the `docx` npm dependency —
new-dependency installs run by the user, not the agent; hand over
`cd backend && npm install docx` and finish the export route once it's in.
15 unit tests (`fosTickets.test.ts`, `fosCoverage.test.ts`).

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

### Y. Live lecture mode — QR quiz during the лекция · Effort: M–L

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

---

## In progress

*(empty — pick from above)*
