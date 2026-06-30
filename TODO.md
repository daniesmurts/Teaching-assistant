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

### 2. Audit grade changes after approval · Effort: S

`approveAssignment` UPDATEs the row in place. If an institution admin or
auditor ever asks "did this teacher change a grade after final submission?",
you can't answer.

- **Why:** Real selling point to compliance-minded universities. Cheap
  insurance against a bad-day scenario.
- **Touches:** new migration adding `assignment_grade_history` table + a
  Postgres trigger on UPDATE of `assignments.approved_*` columns. Optional
  admin-panel view to browse the log.

### 3. Switch embeddings to a Russian-tuned model · Effort: M

DeepSeek embeddings work but aren't state-of-the-art for Russian. The RAG
flywheel quality directly limits grading consistency *and* presentation /
quiz citations.

- **Why:** Quality jump applies to every RAG path simultaneously. Russian
  benchmarks favour `intfloat/multilingual-e5-large` or YandexGPT embeddings
  over DeepSeek's by a meaningful margin.
- **Touches:** [services/deepseek.ts](backend/src/services/deepseek.ts)
  `embed()`, [services/embeddings.ts](backend/src/services/embeddings.ts),
  re-embed all `assignments.embedding` + `document_chunks.embedding` rows
  once. Background job, idempotent.
- **Consider:** YandexGPT keeps the call inside Russia (latency + 152-ФЗ
  posture); self-hosted e5-large is free but burns VM memory.

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

### 6. Onboarding signposting for the criteria model · Effort: S

A fresh free user lands on grading, sees "Без критериев (общая оценка)" and
grades holistically forever — never discovers the criteria library that's
the platform's actual moat.

- **Why:** Criteria are the differentiator vs. "another GPT wrapper."
  Adoption matters.
- **Touches:** [components/grading/GradingForm.tsx](frontend/src/components/grading/GradingForm.tsx)
  (one-time inline hint), dashboard checklist (add "Создайте первый критерий"),
  maybe a small "пустая библиотека" hero on `/criteria`.

### 7. Real testing for DB-backed paths · Effort: M

The Vitest suite shipped this session covers pure functions only. The
high-value untested paths are: plan-limit enforcement, T-Bank webhook flow,
auth + JWT lifecycle, RAG retrieval queries.

- **Why:** Money + plans + grades + RAG quality all live in DB-backed code
  paths that currently have zero automated coverage.
- **Touches:** new `vitest.setup.db.ts` that boots a Postgres test container
  (Testcontainers Node, or `pg-mem` for fast cases). New test files
  alongside the queries they cover.

### 8. Token / spend caps per teacher · Effort: S

Currently DeepSeek cost is uncapped if a teacher goes wild. The platform
admin sees the bleed in `AdminUsage` but can't gate it without disabling
the account entirely.

- **Why:** Defends against a runaway script or abuse on a single teacher
  account before it dents the month.
- **Touches:** [config/planLimits.ts](backend/src/config/planLimits.ts) add
  `monthlyTokenCap`, [services/deepseek.ts](backend/src/services/deepseek.ts)
  read teacher's cap from cache before each call.

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
- **Note:** no AI calls — pure aggregation.

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

### J. First-run simplification — reduce day-one overwhelm · Effort: M

Recurring, multi-user feedback (incl. a day-one user, 2026-06): "не интуитивно,
много вкладок и меню". A brand-new user lands and doesn't know what to do next;
the ~17-item sidebar amplifies the freeze (paradox of choice). Root cause is
first-run guidance, not too many features. **✅ All three parts shipped (Unreleased)** —
move J out of the backlog when this deploys:

- **A ✅** — welcome modal reflects the real feature set; checklist persists until first grade.
- **B ✅ — progressive sidebar.** A brand-new account (no subject + no first grade) sees only
  essential start-here items (Главная / Проверка работ / Материалы / Предметы) + account group
  + a «Показать всё» toggle; full nav appears automatically on activation (first grade),
  persisted via `ga_nav_expanded`, full-nav default while loading to avoid a flash for
  returning users. [Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx).
- **C ✅** — `NoCourseHint` on grading/presentations/quizzes/topics; curriculum tabs have inline
  empty states. Every AI feature page points a new user at the first action.

- **Why (kept for context):** First impression drives activation and retention; the strongest
  signal (day-one users bouncing off complexity) is the cheapest to lose and hardest to measure
  after the fact.
- **Follow-up:** when the day-one customer answers *where* it tipped into "too much", use it to
  refine which items count as essential (the slimmed set is a sensible default, not final).

> **КНИТУ curriculum-intelligence suite** (items K, L, M below; A3 already shipped). These
> are the *near-term, actionable* slices. The full feature map, dependencies, and items not
> yet promoted here (A4/A5, the competency model, the student tier) live in
> [docs/KNITU-roadmap.md](docs/KNITU-roadmap.md) — promote to this backlog on readiness.

### K. РПД ↔ competency/goals conformance check (Admin A2) · Effort: M

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

### M. Material generators — cases / projects / assignments (Teacher T1) · Effort: M

КНИТУ T1, and broadly requested. Extend the existing generator family
(presentations, quizzes, topics) with three more material types teachers prepare:
practical cases (кейсы), projects (проекты), assignments/tasks (задания).

- **Why:** pure reuse of the proven generation pattern; broad teacher value; rounds
  out the "materials" pillar. Lower strategic priority than K/L for the admin
  audience, but cheap per generator.
- **Touches:** new services mirroring
  [services/quizzes.ts](backend/src/services/quizzes.ts) /
  [services/topics.ts](backend/src/services/topics.ts) (`chatJSON` + course context
  + RAG citations); routes; UI; plan gating like quizzes/topics.
- **✅ Done (Unreleased):** the **«Материалы» hub** plus a single kind-parameterized
  generator (`/materials/:kind`) covering **задания / кейсы / проекты** — `task_sets` + a
  `kind` discriminator, shared item shape, per-kind prompt + labels, three hub cards. КНИТУ's
  T1 set is complete. (Move M out of the backlog when this ships.)

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

**Tail (d) — Leadership dashboard V2 · Effort: S–M.** V1 (shipped this
session) is grades-only: subtree teacher list + 30-day grade activity. V2
expands the same `/leadership` surface with:
- Presentations generated in the subtree over 30 days (counts + by-teacher).
- Published assignments in the subtree: counts of definitions, submissions,
  active student writers, completion rate.
- Per-teacher drill-down page (`/leadership/teachers/:id` scoped via
  `canActOnUnit`) — recent grades, approval rate, edit-distance from AI,
  active subjects.
- Optional: viewer-role variant of the same page (read-only governance —
  same data, no actions if/when we add actions to V2).
Touches: `routes/leadership.ts` (new endpoints or extend `/overview`),
`db/queries/leadership.ts`, `pages/Leadership.tsx` (tabs or extra sections).
The per-teacher drill needs the canActOnUnit walk on the *teacher's*
primary unit, not on the leadership unit — careful in the gate.

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

### Q. Published assignments + process-of-creation attestation (§5.1) · Effort: L

In-platform writing surface where students compose published assignments
(per-student tokenised link, or LTI launch once §6 ships). Captures authoring
*aggregates* and produces a transparent provenance report the teacher reads
alongside the grade. Ships the §5.1 + §5.3 + §5.5 v1 authenticity bundle. Full
design and the legal/UX constraints are in [Research.md](Research.md) §5.1.1–
§5.1.4 and §5.6–§5.7.

- **Why:** the platform's answer to "won't we end up using AI to grade AI?" —
  it moves assessment onto authorship *process*, which AI cannot reproduce.
  Strongest single patent claim on the roadmap and a flagship institutional
  differentiator. Available on Pro (tokenised rail) and Institution (LTI rail).
- **Touches:** new writing-surface component (editor stack decided — **TipTap,
  MIT core only**, see §5.1.3 for rationale + integration shape); browser-side
  telemetry that emits **aggregates only** (never raw keystroke streams — see
  §5.1.2);
  `assignments` columns `is_published`, `student_token`, `published_at`,
  `due_at`, `submission_telemetry` (JSONB), consent record; published-link
  distribution UI; provenance-report panel in the grading view; rule-based
  provenance scorer (§5.1.3); a metacognition rubric template (§5.5).
- **Hard constraints (do not skip):** aggregate-only telemetry + explicit
  Russian consent gate + Russia-resident storage (§5.1.2); strict publish
  mode — link is the only submission route (§5.1.1); connectivity required on
  this surface, overriding offline-first (§5.1.4).
- **Sequencing:** ships **after** Feature P (org tree) — visibility scoping
  resolves through the tree. Pairs with §6 LTI for the institutional rail but
  the tokenised rail does not depend on it, so v1 can ship standalone first.

### R. LTI 1.3 integration + IT-admin configuration UX (§6) · Effort: L

LTI 1.3 + Advantage (launch, NRPS roster sync, AGS grade write-back) so
GradeAssist plugs into Moodle and the wider LMS ecosystem. Includes the
IT-admin self-serve configuration surface designed in [Research.md](Research.md)
§6.5 (Setup + Test Connection, Course Mapping, Activity Log). Full strategy in
§6.

- **Why:** the institutional wedge. Without LTI, GradeAssist is "another system
  to migrate to" and procurement stalls; with it, it is "a compatible tool."
  Sources verified student identity from the LMS, so we never store student
  credentials (§6.1). The §6.5 config UX is what keeps each institutional sale
  from becoming a hand-held engineering engagement.
- **Touches:** LTI 1.3 OIDC/JWT launch handling; JWKS endpoint; NRPS + AGS
  clients; `org_units.external_code` mapping; Settings → Organisation → LTI
  surface (gated on root-unit `admin`); course-context-to-org-unit mapping.
- **Sequencing:** after Feature P (needs the org tree to map course contexts
  into) and alongside Feature Q (provides Q's institutional identity rail).

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
