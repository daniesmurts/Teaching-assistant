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

### A. Bulk grading · Effort: L

Drop a folder of PDFs/DOCX into the grading page → parse student name from
filename pattern (configurable per course) → queue all of them → results
land in History.

- **Why:** #1 most-requested feature once teachers grade more than five
  individually. Especially valuable for finals weeks where one professor
  grades 60+ ВКР in two days.
- **Touches:** new `BulkGrading.tsx` page, drag-and-drop component, queue
  integration (reuses the pg-boss job queue already powering long reviews —
  see CHANGELOG), `routes/grading.ts` batch endpoint, progress polling.
- **Pricing hook:** worth gating to Pro; institution tier could add
  per-batch templates.

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
  what we ship matches what we claim. Concept extraction quality rides on
  embedding quality (currently Yandex `text-search-doc`, see CLAUDE.md rule #9).

### P. Organisational structure model — canonical-typed org tree · Effort: L+ (foundational) · 🟢 MOSTLY SHIPPED

**Status (2026-06-28):** core shipped + deployed (commit a619377; migration 045
ran on prod via deploy). Increments: foundation, tree-builder UI (1),
teacher/role assignment (1b), tree-based admin guards + `syncRoleToTree` (3),
and **frontend gate now reads org-tree-derived `is_platform_admin` /
`is_institution_admin` from the auth payload (b)** — legacy enum fallback kept
for pre-upgrade sessions. See CHANGELOG.

**Done:** (a) prod migration, (b) frontend gate coherence.

**(c) Domain-scoped grants — two-axis authorisation** ([Research.md](Research.md)
§7.10): a grant is **(level: admin/edit/view) × (domain:
platform/curriculum/teaching/…) × (unit subtree)**, letting functional staff
(УМЦ, ПР УР) get domain-narrow grants at root without holding full institution
admin, while line managers get grants at their own unit. All four phases
shipped 2026-07-22 — see CHANGELOG for full detail:
- **Phase 1 (`curriculum` domain)** — shipped. Migration 087, `accessScope.ts`
  + `requireDomain.ts`, domain picker in the role-assignment UI.
- **Phase 2 (`teaching` domain)** — shipped. ПР УР read-only width (usage,
  grading activity, leadership, roster read). Found and fixed a real bug in
  the same commit: `canActOnUnit`/`teacherCanActOnUnit`/`requireUnitRole` now
  require an explicit `domain` param (no unsafe "any domain" default) — a
  Phase 1 `curriculum` grant had been leaking into the leadership dashboard.
- **Phase 3, slice A (subtree query scoping for `teaching`)** — shipped.
  Institution routes now honor a grant's `pathPrefixes`; root-anchored grants
  stay unrestricted. Two more domain-blindness gaps of the same class found
  and fixed (`getProgramAccessScope`, `canTeacherShareToUnit`).
- **Phase 3, slice B (subtree-scoped org tree CRUD + role grants)** — shipped.
  Teacher invite/deactivate and LTI/model/shared-RAG settings stay
  **permanently** root-admin-only (IT owns provisioning, confirmed against
  KNITU practice — not deferred, decided); `routes/orgUnits.ts` structure
  endpoints now accept subtree `admin × all` grants via `unitInScope`.
  - **Still explicitly deferred**, unrelated to the above: **RPD monitor
    (`curriculum`) subtree scoping** — `rpd_snapshot_rows` keys departments by
    a free-text `dept_code` with no FK to `org_units`; needs a new mapping
    (schema + UI). **Criteria/rubrics sharing target** — always shares to the
    institution root regardless of the caller's granted subtree; changing
    that is a behaviour-change product decision, not a query filter.

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

*(Original full design — the `org_units`/`org_unit_roles` schema, materialised
path authorisation, KSTU/КНИТУ mapping — is superseded by what actually
shipped above; see [Research.md](Research.md) §7 and CHANGELOG if the
historical rationale is needed.)*

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
discipline wants this. v2 gating: rides `fosGenerator` (Pro+), with the
programme-integration as an Institution-tier exclusive.

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

- **Sequencing:** the §3.1 research-track extensions (comprehension pings,
  slide-aligned questions, ASR, WebRTC) build on this session/participant
  substrate later — none scheduled.

### Z. Market-evidence layer + РОП-студия — defensible labor-market justification at design time · Effort: pilot S–M, full track L+ (phased) · 🟢 Phase 0 SHIPPED (2026-07-23)

**Phase 0 pilot shipped (2026-07-22, Plane-2 doc completed 2026-07-23)**,
pilot: направление 15.03.02 «Технологические машины и оборудование», Респ.
Татарстан. New `/rop-studio` page, `services/labourMarket.ts` (pulls
trudvsem.ru vacancy snapshots for all ~90 Russian federal subjects) +
`services/marketEvidenceGenerator.ts` (one grounded `chatJSON` call, numbers
always rendered next to raw source data for direct review rather than an
automated citation matcher), multi-region selection, and a Plane-2 grounded
document (per-institution «стратегия развития», reuses documentExtractor/
chunker/embeddings + the same cosine-distance refusal gate `docChat.ts`
uses). 28+9 tests, verified live end-to-end against the real pilot
direction and institution. See CHANGELOG for full implementation detail.

**Not yet built** (deferred to Phase 1+ per the sequencing below — gated on
this pilot's real-user verdict first): the `labourMarket`
provider-abstraction interface, HH/Росстат as additional sources (HH now
requires a registered OAuth app — anonymous search returns 403, confirmed
live), multiple/platform-wide Plane-2 documents (нацпроект/федпроект
passports, промпартнер docs — the general `platform | institution |
programme` document-scope tier), the full dossier generator, DOCX export,
учебный план/competency-matrix builder.

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

**Success test for the shipped pilot:** "I would put this in front of the
учёный совет." If instead it's "nice, but I still need the РосНавык
dashboard," the dashboard IS her product — license, don't build.

- **Phases (each gated on the previous one's validation):**
  - **0. Pilot slice** · S–M · shipped (above).
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

**v1 shipped:** single-standard ingestion — upload PDF/DOCX →
`documentExtractor` → `chatJSON` extraction (`services/fgosExtractor.ts`,
verbatim-checked УК/ОПК via `validateCitation`, structural block
requirements, профстандарт appendix) → admin review screen
(`pages/admin/AdminFgos.tsx`) → confirm/publish (never auto-published).
Platform-wide reference data, `requireAdmin`-gated. Migration
`088_fgos_registry.sql`.

**Bulk import from fgosvo.ru — shipped:** same "paste a link, get a
checklist" pattern as Feature AD — admin pastes one category-listing URL,
`services/fgosvoParser.ts` crawls all ~50 categories, admin reviews/adjusts
level per item, each checked item imports as a draft one at a time.
`already_imported` dedup against the registry. List UI gained
pagination/search/level-filter once the registry crossed 376 rows. A
review-screen layout bug (Tailwind class-order clobbering field width) and
a test-isolation gap in the integration harness (nested transactions not
correctly rolled back, leaking rows into the shared test DB across runs)
were both found and fixed along the way. See CHANGELOG for full detail on
all of the above.

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

### AE. БРС engine + native interactive activities — the semester ledger governed by the РПД · Effort: v1 M, full track L · 🟢 v1 SHIPPED (2026-07-23)

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

### AF. Per-course/teacher score calibration · Effort: S–M · 🟢 v1 SHIPPED (2026-07-24)

Promoted from Research §10.1. The grading number was trusted raw; each
teacher runs systematically hot or cold and each course has its own grade
distribution — exactly the bias QWK/MAE punish hardest. Shipped: isotonic
calibration (`lib/scoreCalibration.ts`, Pool Adjacent Violators over
`{aiScore, teacherScore}` pairs) with most-specific-first backoff
(course → teacher → institution → none), wired into `grading.ts`'s `grade()`
right before persistence, plus a leakage-safe validation harness (fits on
the earliest slice of history, scores MAE/Spearman on a later held-out
slice the fit never saw — no same-data memorisation). Admin-triggered via
`routes/adminEvals.ts`. Migration `094_score_calibration.sql`. See CHANGELOG
for full design.

- **Deferred:** automatic/scheduled refitting (v1 is admin-triggered only).

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
