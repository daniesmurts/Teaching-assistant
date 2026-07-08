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

### 1. Move long reviews onto a real job queue · Effort: M

Today `runLongReview` runs inside the Express process via fire-and-forget. A
PM2 restart mid-job orphans the work; the teacher refreshes and lands on
`failed`. The resume logic we shipped masks the symptom, doesn't fix the
cause.

- **Why:** ВКР reviews can take 5+ minutes. Losing one mid-flight is a real
  customer-trust event. Same machinery would power bulk grading (feature
  below) without bespoke plumbing.
- **Touches:** [services/longReview.ts](backend/src/services/longReview.ts),
  new `services/jobQueue.ts`, `routes/grading.ts` review endpoints, schema
  for job persistence (or pg-boss tables).
- **Recommended:** pg-boss on the existing Postgres — no new infra, survives
  restarts, gives you retries + dead-letter for free.

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

### 4. localStorage hardening for the grading persistence layer · Effort: S

The refresh-resilience layer we shipped this session leaves `submission_text`
(student PII) on disk in plaintext between sessions. A stolen unlocked
laptop is a real scenario.

- **Why:** 152-ФЗ wouldn't necessarily ding you, but a clean posture is
  worth a day of work given how prominent the persistence layer became.
- **Options:**
  - Switch to `sessionStorage` (loses tab-close survival but cuts surface)
  - Encrypt with a key derived from the JWT, rotate on logout
- **Touches:** [hooks/usePersistedState.ts](frontend/src/hooks/usePersistedState.ts)
  — single file, everything else inherits.

### 5. Document re-ingestion lifecycle · Effort: S

If a teacher uploads a new version of a syllabus, the old `document_chunks`
rows stay forever. Citations in old presentations + quizzes point at chunks
that no longer represent current course content.

- **Why:** Silent data rot. Bites worst at the end of semester when
  syllabuses are updated for the next term.
- **Options:**
  - Cascade-delete chunks when a document is replaced (simple, lossy)
  - Version documents and let presentations/quizzes bind to a doc version
- **Touches:** [routes/documents.ts](backend/src/routes/documents.ts),
  [services/documents.ts](backend/src/services/documents.ts), migration.

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

### B. Per-student trajectory panel · Effort: M

When grading a known student (matched by name+group), surface their last 3
grades and per-criterion movement in the right-hand panel. Pair with the
revision check we already have.

- **Why:** Turns the platform from "a grading tool" into "an actual
  longitudinal teaching aid." The only durable differentiator against
  generic LLM apps.
- **Touches:** [components/grading/GradingResult.tsx](frontend/src/components/grading/GradingResult.tsx)
  adds a "За семестр" tab, new query in
  [db/queries/assignments.ts](backend/src/db/queries/assignments.ts) for
  by-student timeline, optional small per-criterion sparkline.
- **Note:** no new AI calls — all data we already capture.

### C. Cohort / group analytics for the Students page · Effort: M

Per-group histograms, top-3 missed criteria across the cohort, who's
slipping.

- **Why:** End-of-semester gold for teachers. Sells the institution tier
  to department heads ("see your whole faculty's grade distributions").
- **Touches:** [pages/Students.tsx](frontend/src/pages/Students.tsx) gets a
  cohort tab. New aggregation queries. Optional CSV export.
- **Note:** no AI calls — pure aggregation. Distinct from the AI-driven
  cohort synthesis shipped for published assignments
  ([services/cohortSynthesis.ts](backend/src/services/cohortSynthesis.ts)) —
  that one is scoped to a single published assignment's submissions and
  produces qualitative gaps/topics via LLM, not a roster-wide histogram.

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

### I. "Спроси документ" — grounded chat over reference materials · Effort: M

User-requested (early adopter, 2026-06). While grading, a teacher often needs
to check a fact against a standard or methodology — e.g. a welding ГОСТ. Let
them upload the reference document and **ask the AI questions answered from that
document, with a citation to the exact chunk/page** — not from the model's
general knowledge.

- **Why:** Reuses the stack we already have (document upload → chunking →
  embeddings → `findRelevantChunks` → `chatJSON`), so it's mostly UI + an
  endpoint, not new plumbing. The **grounded + cited** framing is the whole
  point: a generic AI chat would hallucinate ГОСТ numbers and clauses, which is
  dangerous for normative checks. Citing the source makes answers verifiable and
  is a genuine differentiator vs. "another GPT wrapper." Pairs naturally with
  grading ("свериться со стандартом" without leaving the work).
- **Key design decisions (resolve before building):**
  - Scope: per-document, or a per-subject "reference library" queried across all
    of a subject's materials? (Lean: per-subject, reusing the `course_id` chunk
    scoping that presentations/quizzes already use.)
  - Multi-turn: keep short conversation context, but re-retrieve chunks per turn.
  - Refuse-when-ungrounded: if retrieval finds nothing relevant, say so instead
    of answering from general knowledge — non-negotiable for ГОСТ/normative use.
- **Touches:** reuse [db/queries/chunks.ts](backend/src/db/queries/chunks.ts)
  `findRelevantChunks` + [services/embeddings.ts](backend/src/services/embeddings.ts);
  new `services/docChat.ts` + `routes/docChat.ts` (or extend documents), citation
  shape like the quiz/presentation `sources`; new chat UI (panel or page), with a
  hook to open it from the grading screen.
- **Pricing hook:** Teacher Pro — naturally gated behind `documentUpload`
  (already Pro-only), so no new entitlement needed.
- **Open question to the user:** which documents do they check most — ГОСТы,
  методички, internal normatives? (asked; shapes ingestion priorities.)

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

### N. Drawings into the ВКР review — text-vs-drawing findings · Effort: M

Teachers submit чертежи as **separate files** alongside the ПЗ. Today the long
review only sees the extracted ПЗ text, so a whole class of high-value findings
is structurally unreachable — the ones the reference Opus review caught by
*reading the drawings*: габаритная высота 15 м в тексте vs 54 000 мм на чертеже,
сепаратор горизонтальный в расчёте vs вертикальный в таблице, штуцер Ду50 на
чертеже vs Ду20 в ПЗ, опечатки на чертеже («Возжушник»).

Three steps, in order — **the third is the payoff**:
1. **Accept drawing files** alongside the ПЗ on a long review (multi-file upload).
2. **OCR each** with Yandex Vision (already wired in
   [services/yandexVision.ts](backend/src/services/yandexVision.ts)) → pull
   dimension callouts, штуцер tables, titles, title-block text.
3. **Feed the OCR text into `findPremiseIssues`** as additional "sections" so the
   Tier-5 cross-section pass surfaces **text-vs-drawing contradictions** — the
   same machinery that already catches composition-vs-reaction, now spanning ПЗ
   ↔ чертёж.

- **Why:** This is the single biggest remaining slice of the depth gap vs. a
  hand-prompted Opus review (~40% of its standout findings came from the
  drawings). Steps 1–2 are plumbing; step 3 reuses the premise pass shipped this
  session, so most of the value is one integration away once the OCR text exists.
- **Touches:** long-review upload UI (multi-file), `routes/grading.ts` review
  endpoints to accept drawing docs,
  [services/documentExtractor.ts](backend/src/services/documentExtractor.ts) /
  [services/yandexVision.ts](backend/src/services/yandexVision.ts) for per-file
  OCR, [services/longReview.ts](backend/src/services/longReview.ts)
  `findPremiseIssues` to ingest drawing text as pseudo-sections (tag the source
  so the UI can label «чертёж» vs «раздел»).
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

Extend the existing `is_institution_shared` boolean (criteria + rubrics
already have it — [migration 020](backend/migrations/020_criteria_model.sql),
[migration 029](backend/migrations/029_rubrics.sql)) into a three-level
`visibility` enum: `private | institution | public`. A teacher can publish a
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
- **Touches:** new `visibility` column replacing/extending
  `is_institution_shared` on `criteria` + `rubrics`; new
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
