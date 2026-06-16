# Changelog

All notable changes to ИСПУМ. Newest first. Dates are when the change **shipped to
production**. Work that's built but not yet deployed lives under **[Unreleased]**.

This is the *internal* engineering log. The user-facing, curated changelog is the
public **Обновления платформы** page (`frontend/src/pages/Changelog.tsx`) — promote
highlights there when you want users to know.

Format loosely follows [Keep a Changelog](https://keepachangelog.com): grouped into
**Added / Changed / Fixed**.

---

## [Unreleased]

### Added
- **Curriculum content-overlap analysis** (`/curriculum`, КНИТУ admin feature A3) —
  «Анализ учебного плана». Teacher selects ≥2 disciplines; the system extracts a
  topic list per discipline (LLM), embeds each topic, cross-compares topics across
  disciplines by cosine similarity, and the model classifies the strongest candidate
  pairs as `duplicate` / `partial` / `adjacent` with a note + recommendation. Reuses
  the existing embedding + chatJSON surface; cosine computed in-process (no pgvector
  storage, so embedding dimension is irrelevant). Live, not persisted. Route
  `POST /api/curriculum/overlap` (`backend/src/services/curriculumAnalysis.ts`).
  Content source per course: inline `syllabus_text`, else latest ready РПД/material
  document. Teacher-scoped for now (учебный план is not yet a first-class entity).
  First step of the КНИТУ curriculum-intelligence roadmap (`docs/KNITU-roadmap.md`,
  `docs/KNITU-feature-map.md`).
- **Help articles for session features** — three new `/help` entries under
  «Проверка работ»: «Учебный цикл — как ИИ учится у вас», «Библиотека отзывов»,
  «Спросить студента и доработка». Existing «Как проверять работы» extended to
  cover citation links, per-criterion score editing, edit-reason picker, and
  approval history visibility.
- **Calibrated confidence thresholds** — the heuristic dispersion cut-offs are
  now data-driven: `fitThresholds()` picks std bands that best match target
  error levels on a confidence run's teacher ground truth; persisted in
  `confidence_config` (migration 027) and read (cached) by `classifyConfidence`.
- **Admin eval harness UI** (`/admin/evals`) — list past runs (flywheel +
  confidence) with live status polling; start new runs from a form (background
  execution); per-run summary tables (flywheel QWK/MAE/Spearman; confidence
  risk-coverage + per-label + selectivity); CSV download; one-click "apply
  thresholds" to calibrate confidence from a run. Routes under
  `/api/admin/evals` (platform-admin only). Replaces CLI-only access.
- **Confidence / triage** (research pillar #2 + product feature) — "thorough"
  grading runs an ensemble of grader variants (persona × temperature); their
  disagreement yields a calibrated confidence label (high/medium/low) that
  flags uncertain works for closer review (selective prediction). Pro+ gated
  (`confidenceCheck` plan feature), opt-in per grade (`thorough: true`).
  Migration `025_grading_confidence.sql` (`ai_confidence`, `ai_ensemble`).
  Risk-coverage study: `npm run eval:confidence` runs the ensemble over
  approved works and reports the coverage→error curve + dispersion→error
  calibration (migration `026_confidence_eval.sql`). First validation run:
  keeping the most-confident 80% halved mean error (10.8 → 5.2), selectivity
  gain 20.7 points. UI: "Тщательная проверка" toggle on the grading form
  (Pro-gated), confidence badge + low-confidence triage banner on the result,
  badge in the assignment detail modal, and confidence cue on pending history
  rows. `ConfidenceBadge` component shared across all four.
- **Eval harness** (flywheel research program, ФСИ «Развитие-ИИ» grant prep) —
  offline replay re-grades approved assignments through the production prompt
  path (`gradeOnce`) under controlled K-example conditions, time-respecting
  retrieval (no future leakage), resumable runs, QWK/MAE/Spearman summary +
  CSV export. Run: `npm run eval -- --teacher <id> [--course <id>] [--k 0,3,5]`.
  Migration `023_eval_harness.sql` (eval_runs / eval_results).
- `gradeOnce()` / `buildGradingMessages()` extracted from the grading service —
  single prompt path shared by production and experiments; prompt assembly is
  now fully unit-tested (10 tests).
- Quiz generator («Тесты») — 5–20 MCQ from course materials with RAG source
  citations, answer reveal, history; free tier 3/mo. Migration `022_quizzes.sql`.
- Vitest test suites in both workspaces (`npm test`) — 76 backend + 26 frontend.

### Fixed
- **RAG flywheel never worked**: DeepSeek has no `/embeddings` endpoint — every
  embedding call since launch failed silently (fire-and-forget swallowed the
  404), so similar-assignment retrieval always returned empty. Switched to
  Yandex Foundation Models textEmbedding (256-dim, in-Russia). Migration
  `024_yandex_embeddings.sql` re-dimensions both vector columns (they were 100%
  NULL — free change). **Requires the `ai.languageModels.user` role on the
  Yandex API-key service account**; backfill via `npm run backfill:embeddings`.
- Criterion names returned by the model with an echoed weight suffix
  («Структура (вес: 40%)») broke the snapshot score merge — now stripped.

### Changed
- **Onboarding first-run refresh** (`frontend/src/components/onboarding/`) —
  addresses recurring "не интуитивно, много вкладок" feedback from new users.
  `WelcomeModal` now sets accurate expectations: instead of "grading + slides" it
  shows the real feature set grouped into three (Проверка / Учебные материалы /
  Аналитика), still driving one primary action (create a subject) and pointing at
  the dashboard checklist. `OnboardingChecklist` now **persists until the first
  grade is done** — the dismiss (×) only appears once `stats.total > 0`, so a
  brand-new user can't accidentally clear their only guidance into the full menu.
  First slice of TODO item J (first-run simplification); progressive sidebar (B)
  and per-page empty-state CTAs (C) remain.
- **Legal pages — Privacy & Terms rewritten** (`frontend/src/pages/legal/Privacy.tsx`,
  `Terms.tsx`) to match what the platform now actually does. Privacy: full data-category
  list (teacher / student / content / payment / technical), processor-vs-operator roles,
  RAG reuse-of-approved-work disclosure, named sub-processors (Yandex Cloud, RU email,
  Т-Банк, Yandex Metrica public-pages-only, DeepSeek), honest **cross-border (DeepSeek,
  вне РФ)** disclosure + RU-resident-model option, RF data residency (ч.5 ст.18 152-ФЗ),
  retention/deletion/export, security measures, subject rights. Corrects the now-false
  "данные не передаются третьим лицам" claim. Terms: registration, tiers/payment (refs
  Оферта), acceptable use, **student-data lawful-basis + cross-border responsibility**,
  AI-results-are-advisory, IP, suspension/termination, liability, governing law. Aligned
  with `docs/legal/152-fz-dpa.md` + `security-overview.md`. Dates bumped to 16 июня 2026.
- **Rubrics → Criteria model** — replaced the named-rubric "bundle" concept with
  individual reusable criteria. Teachers now pick one or more criteria at grading
  time and set weights inline (sum-to-100), instead of selecting a saved rubric.
  - Migration `020_criteria_model.sql`: new `criteria` table, `assignments.criteria_snapshot` JSONB column, dropped `rubrics` table + `rubric_id` columns on `assignments` and `long_reviews`. Pre-launch cutover — no backfill.
  - New `/api/criteria` CRUD; `/api/grading/grade` accepts `criterion_ids` + `weights`; institution & admin endpoints now manage criteria (was rubrics).
  - Plan limit `maxRubrics: 5` → `maxCriteria: 15` (free tier).
  - GradingForm: chip-style multi-pick + per-criterion weight inputs with live total indicator and auto-prefill to even weights.
  - Holistic mode preserved — no criteria selected → AI grades by general academic standards (unchanged behaviour).
  - Renamed page Rubrics → Criteria (`/criteria`), help article slug, sidebar nav, copy across admin/institution panels.

---

## [2026-06-10]

### Added
- **Topic generator** — AI suggests research/practical topics from student level, field,
  interests, and practice site, calibrated to ФГОС level requirements. Yandex Search
  grounding (best-effort, degrades to model-only). Free: 3/mo, Pro/Institution: unlimited.
- Institution entitlement inheritance — active members inherit their institution's tier (full access) automatically
- Institution-shared rubrics now appear in every member's grading rubric picker (`is_institution_shared`)
- Bulk teacher invite (paste a list of emails)
- Institution audit log (admin actions) + panel page
- Email-domain auto-join (teachers with a matching domain auto-join the institution; admin-set domain)
- Moodle-compatible CSV grade export (Журнал)
- Institution CSV usage export (units only)
- Compliance collateral: `docs/legal/security-overview.md`, `docs/legal/152-fz-dpa.md`
- `FEATURES.md` feature inventory + `CHANGELOG.md`

### Changed
- Brand expansion — full name «ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов»
  now appears on landing hero (amber kicker), login & register subtitles, public footer,
  header logo tooltip, HTML meta description, and PWA manifest description.
- Auth pages (Login / Register / ForgotPassword / ResetPassword) — clickable logo + explicit
  «На главную» link so direct-arrivals can navigate back to the marketing site.
- Landing hero rewritten — «Преподавание без компромиссов» framing (tighter, sets up the
  three feature sections as compromises eliminated).
- Pricing pages refreshed (Landing tariffs section + Pricing.tsx kept in sync):
  - Free tier — added topic generator limit + 30-day history line
  - Pro tier — added ВКР review, calculation grading, topics, Moodle CSV export
  - **Institution tier price changed to «Индивидуально / По запросу»** for negotiation
    flexibility; expanded feature list (bulk invite, domain auto-join, audit log, 152-ФЗ DPA)
  - Institution CTA now correctly links to /contact (was /register / /institutions)
  - Comparison table — 7 new rows (Topics, ВКР review, STEM, Moodle CSV, domain auto-join,
    audit log, 152-ФЗ DPA)
- `/institutions` page rewritten — 9 sections (hero, pain points, 6 feature blocks, ВКР showcase,
  decision-maker breakdown by role, security & infra, ROI, procurement FAQ, final CTA) that
  cover every institutional feature we've built and address декан / IT / методический отдел each.
- `/about` page rewritten — turned from a feature-repeat-of-Landing into a manifesto-style
  About: manifesto hero, origin story, 4-principle «во что мы верим» block, analytics-philosophy
  feature, modest team paragraph, calm CTA.
- Scaling pass for 1000-user readiness:
  - PG pool `max=25` + query/connection timeouts (`backend/src/db/connection.ts`); new env `DB_POOL_MAX`
  - Migration 016 — composite + partial indexes on `assignments` for the Журнал query
  - PM2 cluster mode (`instances: 2`, `exec_mode: 'cluster'`)
  - Scheduler gated to PM2 worker 0 only (renewals.ts) so cluster mode doesn't fire it twice
  - VM ops checklist (`docs/ops/vm-tuning.md`): Postgres tuning for 2 GB, pm2-logrotate, cluster restart
  - Scaling roadmap (`docs/scaling.md`): Tier 1 (done) / Tier 2 (when needed) / Tier 3 (architectural)
- Confirmation screens — replaced platform-dependent OS emojis (✅/✉️/🙏/🎉) with a single
  brand-aligned `SuccessMark` SVG component (success-tinted circle + checkmark). Applied to
  ResetPassword, ForgotPassword, Feedback, and PaymentResult (amber tone for the celebration).
- Topic generator — generated topics can now be attached to a specific student (optional
  name + group fields with autocomplete from existing students). Migration 017 adds
  `student_name`/`student_group` columns to `topic_sets` + a partial index for lookup.
  History cards show «… · для {имя} · {группа}» when present. Student fields are stored
  for organisation only — not sent to the AI prompt (the model still uses field/interests/site
  to drive topic quality).
- **Assignment revisions** — when a student resubmits an improved version, the new
  grading run is linked to the previous one and the AI explicitly checks each prior
  improvement point as `addressed | partial | not_addressed` with a note.
  - Migration 018 adds `parent_assignment_id`, `revision_number`, `ai_revision_check` JSONB
  - Past-work detail modal gets «↻ Оценить переработку» button → navigates to
    `/grading?revision_of={id}` with form pre-filled (rubric, course, student name+group)
  - Grading form shows a revision banner («Переработка №N · ИИ сравнит с прошлой версией»)
  - Result + detail modal render a colour-coded revision-check list (success/warning/danger)
  - New endpoint `GET /api/grading/assignment/:id` for prefill
- **Editable strengths/improvements on approval** — teacher can now edit, remove, or add
  bullets in the strengths/«что улучшить» lists before approving. Migration 019 adds
  `approved_strengths` and `approved_improvements` columns. Only sent when different from
  AI defaults (keeps the DB honest about what was edited). The revision-check prompt now
  prefers `approved_improvements` over `ai_improvements` — so the AI checks v2 against
  the teacher's standards, not the AI's draft. Verified live: editing improvements to 3
  custom points results in the AI checking exactly those 3 on the next submission.
- Grading scale switched A–F → Russian 5-point (5/4/3/2) everywhere: prompts, validation,
  UI, colours. Existing grades migrated (014). Grade colour/label centralized in `frontend/src/lib/grades.ts`.
- Rubric builder simplified — removed redundant МАКС field; weights are now percentages with a live sum-to-100 check
- Landing page copy + new analytics feature pillar
- Public changelog page refreshed with real shipped features + correct dates (1.0–1.3)
- Sidebar nav icons — replaced Unicode glyphs (⊞ ✦ ◷ ☺ ▤ ◇ ◫ ☰ ◆ ⚙ ? ✉ ◉ ⎋) with
  custom inline SVG icons via new `Icon` component. Glyphs were getting hijacked by
  emoji fonts on iOS and some Android/Windows configs; SVG renders identically
  everywhere. Single component, 14 named icons, no library dep (~2 KB total).
- **«Курс» → «Предмет» in all user-facing copy** (feedback from real teachers — in RU academic
  vocab, «курс» = year of study, «предмет» = subject). Renamed sidebar nav, all labels, error
  messages, help articles, AI prompts (so the model also outputs «предмет» in feedback), and
  marketing pages. Preserved: «1–2 курс / 3–4 курс» (year of study), «Курсовая работа» (term
  paper), DB column `course_id`, URL `/courses`, all code identifiers (internal-only).
- Public changelog: added **Версия 1.4 (Июль 2026)** — Переработка работ, генератор тем,
  российская 5-балльная шкала, расширение для кафедр, редактирование пунктов перед утверждением.
  1.3 demoted from "Новое" to muted historical entry.

### Fixed
- Institution panel: shows a friendly pointer instead of 400 console errors when the
  signed-in admin has no institution (platform-admin edge case). `institution_id` now
  returned on login + `/me`.

---

## [2026-06-05]

### Added
- Long-document review (ВКР/диплом) — section-aware map-reduce: chapter analysis, defense questions, suggested grade
- STEM / calculation grading — reasoning model + optional reference solution + STEM rubric templates
- Журнал (grading history) — search, filters, pagination; revisit any past grade/review (detail modal)
- Onboarding — welcome modal, getting-started checklist, per-page intros, no-course hints
- In-app feedback (page → email + DB + admin view)
- Help center
- Institution panel (overview, usage, teachers, rubrics) + invite flow + accept-on-register
- Platform-admin institution management (create/edit, assign admins/teachers)
- Email via Unisender Go (transactional) + owner notifications (signup, purchase, feedback)
- Course document upload on creation; teacher rubric builder; student groups + Students page

### Changed
- `PlanSync` — app reconciles plan with the server on load (no more stale free-tier display)
- Bigger, clearer logout button; amber-accented feedback nav link

### Fixed
- Stale plan display after upgrade (PlanSync)
- Single-pass grading cap raised; long works routed to review pipeline

---

## [2026-06 and earlier] — pre-launch foundation

Auth (register/login/JWT/reset), grading engine + approve flow, RAG flywheel,
courses, rubrics + global templates, presentations generator, plan tiers + enforcement,
T-Bank payments (recurring, grace/dunning, fiscal receipts), 152-ФЗ account deletion,
security hardening, PWA, Yandex Cloud deployment.
