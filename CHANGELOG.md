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

### Changed
- **DeepSeek V4 migration — tiered routing + thinking toggle.** Legacy
  `deepseek-chat`/`deepseek-reasoner` deprecate 2026-07-24; V4 replaces the
  two-model split with one model + a `thinking` body toggle (defaults ON, so
  it's set explicitly on every call). `llm/deepseek.ts` now routes tiered:
  **FLASH** (`deepseek-v4-flash`, thinking off) for bulk map/synthesis passes —
  same price as the old chat model, stronger base — and **PRO**
  (`deepseek-v4-pro`, thinking on + `reasoning_effort: high`) for
  reasoning-critical passes via `opts.reasoner` (recomputation, calc grading).
  Model ids are env-overridable (`DEEPSEEK_MODEL_FLASH`/`DEEPSEEK_MODEL_PRO`).
  Thinking mode keeps the reasoner's constraints (no `response_format`/
  `temperature` — `chatJSON`'s extractJSON+retry covers it); chain-of-thought
  in `reasoning_content` is read but never returned. Pricing table updated
  (flash 0.14/0.28, pro 0.435/0.87 per 1M; legacy rates retained for historical
  usage rows). Verified live against the V4 API: both tiers route correctly,
  thinking engages on PRO, JSON parses on both.

### Added
- **Учебные планы — program-level architecture analysis (institution admin).**
  New persisted entity: a department head builds an образовательная программа
  (`programs` + `program_disciplines` + `program_competencies`, migration `042`)
  as an ordered, semester-by-semester discipline list plus the ФГОС
  competencies/goals it must deliver, then runs a four-part analysis
  (`services/programAnalysis.ts`): (1) **sequencing & prerequisites** — one LLM
  pass infers prerequisite edges; ordering is classified deterministically from
  semesters (an **inversion** = a discipline taught strictly earlier than its
  prerequisite), with verdict + recommendation generated to always match the
  computed count (same-semester links are valid, not violations); (2)
  **competency progression** — per-competency
  introduce→develop→master timeline across semesters, flagging
  uncovered/thin/late; (3) **gaps & redundancy** — orphan disciplines (no
  competency contribution) and uncovered competencies; (4) **relatedness & load**
  — embedding+cosine clusters/isolated subjects (reuses the `curriculumAnalysis`
  engine) + per-semester credit/count balance. Routes under
  `/api/institution/programs/*` (`requireInstitutionAdmin`, institution-scoped);
  UI at `/institution/programs` with a semester-grid builder, a one-click example
  track (09.03.01), and a report dashboard (score, prerequisite cards, competency
  heatmap, gap columns, load bars). Latest analysis cached in `program_analyses`.
  **PDF export:** «Экспорт в PDF» downloads a **server-rendered, branded PDF**
  (`services/programReportPdf.ts`, `GET …/:id/analysis.pdf`) — hand-laid with
  pdfkit (no headless Chrome → off Google infra, works offline on the VM),
  embedding vendored PT Serif/PT Sans (Cyrillic-native). Fixed premium layout:
  cover header, score disc + verdict, stat row, sequencing/inversion cards,
  competency heatmap grid, gap columns, load bars, page footers. The frontend
  fetches it as an authenticated blob and saves it.
  **Intake by document (migration `043`):** an admin fills the official ОП header
  fields (код, наименование специальности/направления, уровень образования,
  профиль, формы обучения) and uploads two PDFs — **описание ОП** (УК/ОПК/ПК
  competencies extracted deterministically from the full document, robust to
  50–100k-char files where the matrix is deep in the text) and **учебный план**
  (parsed → disciplines/semesters/ЗЕТ/форма контроля by `services/programImport.ts`).
  `POST /api/institution/programs/import` reuses the document-extraction pipeline
  (`extractText` + Yandex Vision OCR fallback), maps multer/oversize errors to
  clean messages, degrades gracefully (a failed extraction/parse never aborts the
  import — the program is still created with warnings), and hands the admin an
  editable, ready-to-analyse plan.
- **ВКР review — Tier-5 cross-section premise pass (reasoner).** New
  document-level pass (`findPremiseIssues` in `longReview.ts`) that reasons over
  every section's summary + extracted quantities at once on v4-pro thinking —
  catching what section-grained passes structurally can't: contradictions that
  **span sections** (e.g. a combustion equation that burns methane when the
  declared gas composition has none; an apparatus described differently in the
  calc vs. another section) and **physically/logically implausible assumptions**
  (phase equilibrium / saturation pressure at the stated p,T; stoichiometric
  imbalance). New `PremiseFinding` type (`kind`: contradiction/physical/logical,
  title, explanation, severity, corrective action, quote-validated evidence) on
  `LongReviewResult.premise_findings`; new `PremiseFindingsBlock` rendered above
  the numeric blocks in both the review page and assignment modal (a wrong
  premise invalidates the numbers downstream). Soft-fail + quote-validated like
  the other tiers; result stored in the existing JSONB so no migration; empty on
  legacy rows. Verified live against V4: reproduces the cross-section
  composition-vs-reaction contradiction that the reference Opus review found.
- **Syllabus conformance — structure-aware redesign** (КНИТУ A2 v2). The check now
  **parses the РПД into ФГОС-shaped sections** before scoring: each requirement (цель /
  компетенция / индикатор достижения / Знать / Уметь / Владеть) is identified separately
  and scored against the **content sections** (§5 лекции / §6 практ. / §7 лаб. / §8 СРС /
  §8.1 контроль) — *not against the requirements section itself*. Every finding cites one
  or more content sections with a verbatim excerpt (e.g. *ПК-3.1 → §7 «Лаб. №5. Определение
  неисправности при пуске центробежного насоса»*). Fixes the previous "evidence equals
  title" bug (the model was echoing the goal back as proof) and surfaces real gaps the old
  whole-document check missed (e.g. «Владеть составлением технической документации» → ✗
  with a precise fix for СРС). New shared types: `RequirementKind`, `ContentSection`,
  `CoverageSource`, `ParsedSyllabusReport`. Two LLM calls per review (parse + score) — same
  cost as before, materially better output. Backward-compatible with РПД-студия's
  self-check (its `competencies`/`goals` inputs still override). UI: a «Что нашли в РПД»
  summary strip, findings **grouped by kind** (Цели / Компетенции / Индикаторы / Знать /
  Уметь / Владеть) with indicators nested under their parent, and per-finding section
  chips with the cited excerpt. `backend/src/services/syllabusReview.ts` rewritten;
  `frontend/src/pages/CurriculumConformance.tsx` rewritten.
- **SAML 2.0 SSO (institutional, per-institution IdP)** — teachers and admins
  at an institution can sign in through their university's identity provider
  (ADFS, Keycloak, Azure AD, ALD Pro). Email-first login: the teacher types
  their email → `POST /api/sso/discover` checks whether the domain's
  institution has SSO configured → SAML domains redirect to the IdP, everyone
  else falls through to the password field. First SAML login JIT-provisions a
  teacher row (matched by email, attached to the institution, random
  unusable password) and stamps `saml_subject` / `saml_provisioned_at`.
  Password auth keeps working alongside SSO. Backend: migration 041 adds
  `saml_*` columns to `institutions` + `teachers`; `services/saml.ts` wraps
  `@node-saml/node-saml` (per-institution AuthnRequest signing, assertion
  validation, SP metadata XML, attribute extraction with IdP-friendly
  fallbacks); `routes/sso.ts` exposes `/discover`, `/:id/metadata`,
  `/:id/login`, `/:id/acs`; one global SP keypair lives in env
  (`SAML_SP_*`, generated via `scripts/generateSamlSpKeypair.ts`). Platform
  admin configures each institution's IdP under **Admin → Организации → SSO**
  (enable toggle, IdP entity id / SSO URL / cert, attribute mapping, plus
  copy-ready SP Entity ID / ACS / metadata URLs to hand the IdP admin).
  Frontend: two-step Login, `/sso/callback` token-exchange page (excluded
  from Metrica/Webvisor so the JWT in the URL is never replay-recorded).
  SLO deferred. Local testing via `docker-compose.keycloak.yml` +
  `docs/saml-testing.md`.
- **ВКР review — Tier-4 independent recomputation + method-applicability** —
  the highest-effort tier in the long-review pipeline. (1) A new
  `findRecomputations` orchestrator step runs after the consistency pass.
  Gating: fires only if ≥1 section emitted a numeric `key_quantity` (purely
  qualitative humanities ВКР skip the call). Routes to the DeepSeek
  **reasoner** model (`opts.reasoner: true`) — slow + costly but reliable at
  arithmetic, where DeepSeek V3 isn't. The prompt asks for *real* divergence
  only (`>5%` or principled error), with verbatim quote, formula, and inputs
  carried through. Output validated against the section haystack and a
  numeric-chapter allow-list so the reasoner can't invent contexts. Soft-fail
  (logged, leaves `recomputation_findings=[]`). (2) Section prompt extended
  with explicit method-applicability instructions: empirical correlations
  (Dittus-Boelter Re > 10⁴; Stokes Ar < ~36; criteria from ГОСТ/СП/ОСТ;
  statistical tests with their assumptions) must be checked against their
  validity ranges and flagged as gaps with `severity` and `action` set
  appropriately. New shared type `RecomputationFinding` with claimed vs.
  recomputed values side-by-side; new field
  `LongReviewResult.recomputation_findings`. Empty default on legacy rows.
  Frontend: new `RecomputationBlock` rendered between Inconsistencies and
  CoverageNote in both the result page and the assignment detail modal —
  shows claim, severity dot, "В работе" vs "Перерасчёт ИИ" cards
  side-by-side, the model's discrepancy explanation, formula + inputs when
  provided, and a ↳ quote line. Sorted by severity DESC inside the block.
- **ВКР review — Tier-3 severity / action / correction on gaps** — gaps now
  surface as triaged findings rather than uniform bullets. Each ВКР gap can
  carry `severity` (critical / substantial / minor), `action` (flag = we're
  sure it's wrong → к проверке; verify = we couldn't pin it down → спросить
  автора), and `correction` (one short sentence: what to do). All three are
  optional fields on `BulletItem`, so regular grading bullets remain
  unchanged. Validated by `normaliseBullets`: hallucinated enum values fall
  back to null, correction capped at 240 chars. Both ВКР prompts updated to
  request the new fields and explain how to choose between them.
  `LongReviewBullet` renders a colour-coded severity dot before the marker
  (danger/warning/ink-tertiary), an action chip («к проверке» /
  «спросить автора»), and a "→ что сделать" subline for the correction. Gaps
  are sorted by severity DESC inside chapter and overall lists so critical
  findings rise to the top. 5 unit tests pin the validation logic
  (happy path, hallucinated enums, short corrections rejected, length cap,
  legacy string bullets stay clean). Per-finding confidence skipped on
  purpose — the existing ensemble-based assignment-level confidence is the
  calibrated one and we don't want two competing signals in the UI.
- **Practical-material generator — задания / кейсы / проекты** (КНИТУ teacher feature T1) —
  one kind-parameterized generator (`/materials/:kind`) producing **assignment / case /
  project** sets: topic + difficulty (базовый/средний/продвинутый) + optional subject → items
  with content (условие / ситуация + вопросы / цель + этапы), the skills developed, and a
  teacher hint. Copy-all + per-kind history. Single `task_sets` table with a `kind`
  discriminator (migrations 039 + 040; named to avoid the graded `assignments` table); shared
  item shape, per-kind prompt + UI labels. `POST /api/tasks/generate` (+ list `?kind=`,
  delete), `services/tasks.ts`. Surfaced as three cards in the «Материалы» hub. Count-based
  monthly limit `tasksPerMonth` (free 3/mo across kinds). Completes КНИТУ's T1 set.
- **РПД-студия — AI-assisted syllabus authoring** (`/curriculum` → tab «РПД-студия»,
  КНИТУ teacher feature T5) — pick a discipline → AI drafts РПД content (цели,
  планируемые результаты по компетенциям, тематический план, формы контроля) aimed at the
  ОПК/ПК/УК + goals declared in its РПД, then **self-checks coverage** against those
  targets (reuses A2). Sections are editable; «Перепроверить покрытие» re-scores the edited
  text — the **write → check → fix loop**. AI drafts, the teacher is author of record;
  computed live, not persisted. `POST /api/curriculum/syllabus-draft` +
  `/syllabus-review` generalised to accept raw text + targets
  (`backend/src/services/syllabusAuthor.ts`). Third tab on the `/curriculum` page — still
  no new sidebar entry. See `docs/KNITU-roadmap.md` (item T5 / TODO L).
- **Syllabus conformance review** (`/curriculum` → tab «Соответствие РПД компетенциям»,
  КНИТУ admin feature A2) — score how well a discipline's РПД covers the ОПК/ПК/УК
  competencies and goals it declares. Structurally the **grading engine pointed at a
  syllabus**: each competency/goal is a criterion, the РПД is the "submission", output is
  per-item coverage (`covered`/`partial`/`missing`) + score + verbatim evidence quote +
  gap + recommendation. Competencies/goals are auto-extracted from the РПД (or supplied).
  Reuses `chatJSON` + the grading verbatim-quote convention; computed live, not persisted.
  `POST /api/curriculum/syllabus-review` (`backend/src/services/syllabusReview.ts`). The
  `/curriculum` page is now **tabbed** (Дублирование тем + Соответствие РПД) — the «РПД
  analysis suite» under one menu item, no new sidebar entry. See `docs/KNITU-roadmap.md`
  (item A2 / TODO K).
- **ВКР review — Tier-2 cross-section consistency** — catches the class of
  error that was structurally invisible before: a number stated one way in
  chapter 2 and another way in chapter 5. (1) The section pass now extracts
  a `key_quantities` array per chapter — name + value + verbatim quote —
  alongside strengths/gaps. Quote validated against the section text;
  `chapter_index` stamped by the orchestrator. (2) A new
  `findInconsistencies` post-synthesis pass runs in two stages: deterministic
  clustering by lowercased quantity name → only candidates with ≥2 different
  numeric values, then an LLM confirmation call that filters out
  same-name-different-concept false positives ("температура реакции" vs
  "температура окружающей среды") and emits a 1-line summary per real
  contradiction. (3) A new `inconsistencies: Inconsistency[]` field on
  `LongReviewResult` + an `InconsistenciesBlock` UI surfaced above the
  coverage note in both the ВКР result page and the assignment detail modal.
  Hidden when empty so legacy rows render unchanged. 7 unit tests pin the
  deterministic clustering (case-insensitive grouping, decimal-separator
  normalisation, single-numeric-value rejection, multi-cluster output).
- **ВКР review — Tier-1 prompt overhaul** — three changes that move the long-form
  review from rubber-stamp prose to evidence-grounded analysis. (1) **Recall-bias
  framing** in both the section pass and the synthesis pass: "это
  предварительный разбор для преподавателя — лучше задать вопрос, чем
  промолчать". Gives the model permission to flag instead of hedge. (2)
  **Two-pass section analysis**: extract claims/numbers/formulas with verbatim
  quotes FIRST, then judge only over the extracted set — kills the
  confident-but-ungrounded prose. (3) **Evidence requirement** on every chapter
  strength/gap and every overall strength/gap: must include a verbatim quote
  validated against the section (analyzeSection) and the full submission
  (synthesizeReview). Bullets without resolvable quotes are dropped at the
  normaliseBullets boundary, same contract as regular grading bullets. Also
  added a `coverage_note` field on the synthesis: 1–3 sentences on what was
  actually verified vs. where evidence was thin — rendered as a small "Что
  проверено" block at the top of the review and in the assignment detail modal.
  `ChapterReview.strengths/gaps` and `LongReviewResult.overall_strengths/gaps`
  changed from `string[]` to `Array<BulletItem | string>` (legacy rows still
  hold strings; new ones hold BulletItem with quote). No DB migration — JSONB
  column. Frontend renderers go through a new shared `LongReviewBullet`
  component that tolerates both shapes.
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
- **Template picker — searchable + grouped when the list grows** — the "Начать с готового
  шаблона" picker on the Criteria and Rubrics pages was a flat wrap of chips that got hard to
  scan as templates multiplied. New shared `TemplatePicker` component: a simple flat row when
  there are ≤6 templates, but once larger it gains a **search box + subject-filter pills**
  (Все / Бизнес / Инженерия / …) and **groups results by subject**. Used by both
  `Criteria.tsx` and `Rubrics.tsx`.
- **Progressive sidebar for new users** (item J/B — the core "too many tabs" fix) — a
  brand-new account (no subject + no first grade) now sees only the essential start-here
  items (Главная / Проверка работ / Материалы / Предметы) plus the account group and a
  «Показать всё» toggle, instead of the full ~14-item menu. Once the teacher grades their
  first work (activation), the full nav appears automatically and permanently; the toggle
  choice is persisted (`ga_nav_expanded`). Defaults to the full nav while data loads so
  returning users never see a flash of the slimmed menu. Completes the first-run arc
  (A: welcome/checklist · C: empty-states · B: this).
- **«Материалы» generator hub** (`/materials`) — the three generation pages
  (Презентации / Тесты / Темы работ) are now reached through one **«Материалы»** hub
  instead of three separate sidebar items, cutting the «Генерация» group from 3 entries to
  1 (item J — nav simplification) and giving new users a clear "what can I create?"
  overview. Existing routes unchanged; «Материалы» stays highlighted while inside any child
  page (location-aware nav active state). Future КНИТУ T1 types (кейсы/проекты/задания) slot
  in as more hub cards (TODO M).
- **Empty-state CTAs on the generator pages + curriculum-prompt hardening** — extended the
  `NoCourseHint` "create your first subject" nudge to the **Quizzes** and **Topics**
  generators (was only on grading/presentations), so every AI feature page points a
  brand-new user at the first action (item J/C). Hardening: user-supplied competency/goal
  text is now run through `sanitiseForPrompt` before entering the syllabus review/author
  ИИ prompts, matching the prompt-injection posture used for submission text.
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
