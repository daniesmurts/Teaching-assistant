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
first-run guidance, not too many features. **Part A shipped** (welcome modal now
reflects the real feature set; checklist persists until first grade — see
CHANGELOG). Remaining:

- **B — Progressive sidebar for new accounts (the "too many tabs" fix).** Until a
  teacher has a subject + first grade, show only the "start here" path (Главная,
  Предметы, Проверка) with a «Показать все» toggle; reveal the rest as they
  progress. This is the piece that actually answers the menu-overload complaint.
  - **Touches:** [components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)
    (gate `NAV_GROUPS` on onboarding progress + a reveal toggle), reuse the
    courses/stats queries the checklist already runs.
  - **Hold until:** this user answers "where did it tip into too-much" — that
    tells us which groups to defer vs. surface.
- **C — Empty-state "next action" on every feature page · Effort: S.** A user who
  opens /grading, /presentations, /quizzes, /topics, /curriculum with no subject
  should see one clear CTA, not a blank form. Generalise the existing
  [NoCourseHint](frontend/src/components/onboarding/NoCourseHint.tsx) pattern to
  every AI feature page.

- **Why:** First impression drives activation and retention; the strongest signal
  (day-one users bouncing off complexity) is the cheapest to lose and the hardest
  to measure after the fact.

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
