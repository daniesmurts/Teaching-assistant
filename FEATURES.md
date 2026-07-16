# ИСПУМ — Feature Inventory

Single source of truth for what's built, by user type. Update this in the **same
commit** as any feature change.

**Legend:** ✅ shipped · 🚧 in progress · 📋 planned
**Last updated:** 2026-07-10 (nightly database backups — pg_dump to a dedicated write-only Object Storage bucket, Telegram success/failure report, restore runbook, disk-snapshot guidance; earlier same day: activation tracking — admin funnel page /admin/activation, onboarding nudge-email ladder with unsubscribe, teachers.last_seen_at, weekly Telegram activation digest; production incident alerting → Telegram + production_incidents table + docs/support runbooks; earlier: LTI 1.3 NRPS roster import + course-mapping admin UI + IMS Dynamic Registration — the last three items on the LTI backlog, leaving only a launch activity log; earlier: LTI 1.3 AGS grade write-back — approving a grade for an LTI-launched submission posts the score to the Moodle gradebook automatically, sync-status badge on the grade detail; earlier same day: LTI 1.3 Deep Linking + student launch — teacher picks/creates a course-scoped published assignment from inside Moodle, students launch straight into the existing tokenised writing surface with a captured LMS identity; earlier same day: LTI 1.3 launch — teacher JIT provisioning from Moodle via OIDC launch, auto-created course context, self-serve institution-admin platform registration + test-connection UI; AGS/NRPS still to come; earlier: criterion-level RAG retrieval — past approved feedback per criterion, not just whole-assignment similarity; earlier: smarter RAG flywheel: contrastive retrieval, per-course grading-policy memo, feedback critic pass (Pro+), cohort synthesis for published assignments, eval-harness variant A/B; earlier: public Contact + Research forms now deliver to a real platform-admin inbox — `contact_messages` table, public `POST /api/contact`, admin Обращения page — instead of a fake local submit; public Research page `/research` — programme pitch, 4 research directions, partner registry component with a signed-agreement gate, application form; earlier: indicator-level РПД coverage check — индикаторы достижения + Знать/Уметь/Владеть, rolled up to competency; platform-wide activity logging: global audit middleware records every member mutation + IP/UA, new platform-admin Журнал действий with filters; earlier: programme-metadata on org units → prefilled РОП import; org-unit re-type/move + default-department placement + grant-warning UI + delete/lockout/practice-uniqueness hardening; earlier: org-structure audit logging + cross-institution stale-ties fix; discipline-scoped РПД library + coverage check + auto-detect + `program_direction` type)

---

## Roles & tiers at a glance

| Role | How assigned | Key capabilities |
|---|---|---|
| **Public visitor** | unauthenticated | Marketing site, register/login, accept invite |
| **Teacher — Free** | default on signup | Limited grading/presentations, no docs/RAG/email |
| **Teacher — Pro** | paid (T-Bank) | Unlimited, document upload, RAG, email drafts, full history |
| **Institution member** | invite or email-domain auto-join | Inherits full institution entitlements + shared criteria |
| **Institution admin** | platform admin sets the first (`admin` on the institution root); an institution admin can then grant `admin`-on-root to peers via Структура | Manage own institution (teachers, invites, criteria, usage, audit, org tree + roles) |
| **Platform admin** | set in DB | Full platform: teachers, institutions, templates, billing, feedback, errors |

**Unit-scoped roles** (`admin` / `head` / `viewer`, granted on any org unit, cascade down the tree): `admin` on the institution root = institution admin. `head`/`admin` on a `governance`/`admin_office` unit grants institution-wide programme access by unit type; on any other unit it scopes to that unit's subtree. The grant UI warns before an institution-wide grant. `viewer` is recorded but not yet consumed by any surface (labelled as such in the UI).

Entitlements are computed as the **stronger of** the teacher's own tier and their
institution's tier (`backend/src/middleware/authenticate.ts`).

---

## Public / unauthenticated ✅

- Landing page (hero, problem/solution, 4 feature pillars: проверка / лекции / тесты / аналитика, pricing, feature matrix)
- Marketing pages: About, Institutions, Research (`/research` — исследовательская программа, направления, партнёры, заявка), FAQ, Ethics, Contact, Pricing, Changelog, Use-cases, Offer, Privacy, Terms, Cookies
- Legal docs hub (`/legal`) — single entry point listing all legal documents (Пользовательское соглашение, Политика допустимого использования, Публичная оферта incl. Условия оплаты и возврата, Конфиденциальность, Cookie, Этика ИИ); every legal page shows a persistent sidebar (`LegalSidebar`) for cross-navigation instead of routing back through the footer
- Contact + Research application forms deliver to a real inbox: public `POST /api/contact` → `contact_messages` table + admin-owner email notification (not a `mailto:` or fake local submit)
- Register (with optional `?invite=` institution invite — prefills + locks email)
- **Deferred email verification** — signup never gated; welcome email carries a «Подтвердить почту» link (confirm-button page, scanner-safe), in-app banner nags until confirmed with a re-send button. Invite/SSO/LTI accounts are verified from birth (address already attested). Unverified addresses are excluded from marketing/nudge sends; an SSO/LTI launch that lands on an unverified password account rotates its password (pre-hijack guard)
- Login (password reveal, inline errors)
- Forgot / reset password (email link, 1-hour token)
- Yandex Metrica analytics (public pages only; Webvisor never runs on authenticated pages — 152-ФЗ)

---

## Teacher — Free ✅

**Grading**
- AI grading via DeepSeek — pick one or more criteria at grading time + per-criterion weights (sum to 100%), or grade holistically with no criteria. 5-point Russian scale (5/4/3/2), per-criterion breakdown, strengths, improvements
- Teacher review + approve flow (AI never final; approval feeds RAG)
- **Editable strengths/improvements lists on approval** — teacher can add/remove/edit bullets before approving; teacher-edited improvements drive the revision check on the next resubmission
- **Assignment revisions** — when a student resubmits an improved version, link from the past-work detail modal («↻ Оценить переработку») → AI sees v1's feedback as context and returns a per-point check (`addressed` / `partial` / `not_addressed`) with notes; revision badge + colour-coded list on the result
- **«За семестр» trajectory** — when a submission has a known student, both the live grading result panel and the История detail view show their last 3 grades (score/grade history) plus **per-criterion movement** vs. the most recent prior occurrence of each criterion (e.g. «72 → 85 (+13)»), scoped to the current course. Pure history lookup, no AI calls
- STEM / calculation mode (reasoning model + optional reference solution)
- **Async grading jobs** — every проверка runs as a durable pg-boss job (202 + poll, same machinery as ВКР reviews): no HTTP timeout can kill a slow reasoner chain, and an in-flight проверка survives page refresh (resume banner) and PM2 restarts
- **Задание и контекст** — optional free-text field (collapsed by default) where the teacher pastes the assignment brief and/or situational context (e.g. «ознакомительная практика, проводилась в аудитории»); model is instructed to grade strictly within this scope instead of guessing the assignment from the submission alone. Applies to the primary grade and to all «Тщательная проверка» ensemble samples
- Grading history / **Журнал** (search by student/group, subject + status filters, pagination)
- Revisit any past grade (read-only detail modal, incl. ВКР chapter review + revision check)
- Moodle-compatible **CSV grade export**
- Watermark on output (free tier only)
- Limits: 20 grades/mo, 3 presentations/mo, 3 topic generations/mo, 3 quizzes/mo, 3 task sets/mo, 3 subjects, 15 criteria, 30-day history

**Topics** — AI topic generator for research/practicals: student level + field + interests + practice site → level-appropriate, valuable topics (with rationale, scope, novelty). Yandex Search grounding. Optional student attachment (name + group, autocomplete from existing students) for later lookup. Free: 3/mo, Pro: unlimited
**Subjects (formerly «Курсы»)** — CRUD, level, syllabus text/upload. Renamed in UI per Russian-academic vocab («курс» = year of study; «предмет» = subject). URL `/courses` and DB `course_id` unchanged
**Criteria** — library of reusable criteria (name + description + optional subject), start from global templates. Selected at grading time with per-criterion weights and a live sum-to-100 check. **«Улучшить» AI-assist** on the description field rewrites a rough draft into clearer grading-prompt input — teacher accepts/rejects the suggestion, nothing is overwritten silently. **Share to org unit**: a teacher can share their own criterion/rubric up their own chain (department → faculty → whole institution) via a picker on the Критерии/Рубрики pages — no institution-admin step required. Visibility follows the org tree (§7): a teacher sees a shared item when their own primary unit sits at-or-under the unit it was shared with. Free: 5/mo, Pro: unlimited
**Students** — auto-collected roster from graded work, per-student grade-over-time chart, groups. Student profile shows **rework analytics**: first submissions vs доработки, median time between versions, average score progress across versions, «Работа с замечаниями» panel (how many feedback points the student fixed / partially fixed / ignored, from the AI revision check), works list grouped into revision chains with «версия N» badges and score deltas. **«По группе» cohort tab** — overall grade-distribution histogram, per-group breakdown (count + average score), top-3 weakest criteria across the cohort, and «Требуют внимания» — students whose recent grades dropped meaningfully vs. their own prior average, click-through to their profile. Pure aggregation, no AI calls
**Учебный план и РПД — суите** 🚧 — one page (`/curriculum`), three tabs (КНИТУ curriculum-intelligence; teacher-scoped pending a first-class учебный план entity; see `docs/KNITU-roadmap.md`):
- **Дублирование тем** (A3) — select ≥2 disciplines → extracts each discipline's topics, compares them semantically across disciplines, flags duplicated / partially-overlapping / adjacent topics with a recommendation
- **Соответствие РПД компетенциям** (A2) — select a discipline → auto-extracts the ОПК/ПК/УК competencies + goals declared in its РПД → scores how well the content covers each (обеспечена / частично / не обеспечена) with evidence quote, gap, and a concrete fix. Each finding can be **«Оспорить»**-ed (Pro) — re-verified against its own cited content-section excerpts
- **РПД-студия** (T5) — select a discipline → AI drafts РПД content (цели, результаты по компетенциям, темы, формы контроля) aimed at its ОПК/ПК/УК + goals, then self-checks coverage. Sections editable; «Перепроверить покрытие» re-scores the edited text (write→check→fix loop). AI assists; teacher is author of record
**Материалы (хаб генерации)** — single sidebar entry (`/materials`) that launches all generators below (Презентации / Тесты / Темы работ / Задания / Кейсы / Проекты), replacing separate menu items; clear "what can I create?" overview for new users
**Задания / Кейсы / Проекты** — one practical-material generator (`/materials/:kind`): topic + difficulty (базовый/средний/продвинутый) + optional subject → задания (условие), кейсы (ситуация + вопросы для разбора), or проекты (цель, результат, этапы), each with developed skills and a teacher hint. Copy-all + per-kind history. Free: 3/mo, Pro: unlimited
**Presentations** — slide-by-slide generator with typed layouts (title, понятие, формула с KaTeX, сравнение, схема, обсуждение, итоги — модель выбирает тип под содержание) + спикерские заметки и подбор изображения Yandex Images для слайдов-схем, copy-per-slide
**Quizzes («Тесты»)** — 5–20 multiple-choice questions on a topic, at one of three Bloom-style levels (recall / understanding / application), grounded in the subject's materials via RAG with source citations. Answer reveal, history. Free: 3/mo, Pro: unlimited
**Onboarding** — welcome modal (first login), getting-started checklist (persists until first grade), per-page "how it works" intros, no-subject hints on every generator page, and a **progressive sidebar** (new users see only essential start-here items + a «Показать всё» toggle; full nav unlocks automatically after the first grade)
**Account** — feedback page, in-app help center (article 👍/👎 rating with an optional "what's missing" comment on 👎, plus silent logging of searches that return no results), settings, password change, account deletion (152-ФЗ cascade)

---

## Teacher — Pro ✅

Everything in Free, plus:
- **Unlimited** grades, presentations, courses, criteria
- **Document upload** — PDF / DOCX / image with OCR (Yandex Vision), auto-fills submission
- **«Спросить документ»** — grounded Q&A over a subject's uploaded reference materials (ГОСТы, методички), opened from the grading screen. Answers cite `[N]` back to the source document/page and are built **only** from retrieved material — a deterministic gate (no relevant chunk found → fixed refusal, never falls back to the model's general knowledge) sits ahead of a reinforcing prompt-level instruction. Multi-turn (short conversation history resent for continuity), retrieval re-runs fresh each turn
- **RAG flywheel** — grading learns from approved grades (course-scoped few-shot). Now includes: **contrastive retrieval** (when the top similarity hits are all one grade, a grade-contrasting neighbour is added so the model sees the boundary, not just one side of it); a **per-course «профиль оценивания» memo** distilled from recurring teacher corrections (ai_* vs approved_* deltas) and injected into every grading prompt, auto-refreshed every ~10 approvals or on demand from Предметы; a **feedback critic pass** (Pro+) that checks every strength/improvement bullet is grounded in the submission and concretely actionable, rewriting or dropping vague ones before the teacher sees them; and **criterion-level retrieval** — past approved feedback on the *same criterion* (e.g. «аргументация») surfaces alongside the criterion being graded, not just whole-assignment similarity, reusing the submission's own embedding so it costs no extra AI calls
- **Тщательная проверка (confidence)** — opt-in per grade; runs a grader ensemble and flags low-confidence works for closer review (selective-prediction triage)
- **Long-document review** — ВКР/диплом section-aware map-reduce: chapter-by-chapter analysis, defense questions, suggested grade. **Чертежи** (drawings, up to 6 PDF/photo files) can be attached alongside the ПЗ — OCR'd and cross-checked against the written text for **text-vs-drawing contradictions** (a dimension or label that disagrees between the ПЗ and the chertyozh), surfaced in both the cross-section consistency check and the document-level premise pass, labelled «Чертёж: файл.pdf» in the findings
- **Задания студентам (published assignments)** 🚧 — publish an assignment definition (condition + due date), build a student roster, and share per-student tokenised links; track «N сдано из M» and open/close the assignment. Students write in-platform at `/write/:token` (no account) — TipTap editor behind a consent gate, autosave, and **process-of-creation attestation**: the platform records aggregate authoring telemetry (active time, revisions, paste sizes) to evidence authorship (§5.1). Teacher opens each submitted work and sees a **process report** — active time, revisions, paste ratio + largest insertion, with neutral observations and the full text (facts only, no score; the teacher judges) — and grades it with one click («Проверить»): the work becomes a normal journal entry (carrying the provenance) reviewed/approved in the Журнал. *Full loop shipped: publish → student writes (attested) → teacher reviews process + grades. Holistic grading for v1 (criteria-scoped grading + §5.3 trajectory view + §5.5 metacognition rubric are follow-ups).*
- **Аналитика по группе (cohort synthesis)** — on a published assignment's detail page, once ≥5 submissions are approved, "Построить анализ" aggregates all approved feedback into class-wide insight: recurring gaps (with frequency), grade distribution, standout strengths, and suggested topics to revisit in the next lecture. Regenerated on demand (not automatic — cost scales with cohort size).
- **«Оспорить»** — per-item challenge on any grading bullet, criterion comment, or РПД coverage finding the teacher thinks is wrong. Re-verifies against the same source text the original claim was checked against and returns a grounded verdict (подтверждено / уточнено / отозвано) — never just a free-form apology; a non-confirm verdict requires a fresh verbatim quote from the source, validated server-side the same way grading citations are, so pushback can't talk the model into caving without evidence. Verdict is one click to apply back onto the bullet/criterion text. Every challenge is persisted (`feedback_challenges`) as a quality signal, independent of the eval harness.
- **Feedback email generation** — draft email to student (teacher sends from own client)
- **Presentation history**
- Full grading history, no watermark
- Billing: monthly / annual via T-Bank (recurring, grace period + dunning, 54-ФЗ fiscal receipts)

---

## Institution member ✅

A teacher in an institution-tier org (via invite or email-domain auto-join):
- Automatically gets **full institution entitlements** (= Pro-level: unlimited, uploads, RAG, email)
- Sees **institution-shared criteria** in the grading criteria picker, alongside own + global templates

---

## Head of an educational programme (РОП) ✅

A teacher granted `head` on a `program` or `program_direction` org_unit sees **«Образовательные программы»** (`/programs`) filtered to their programme(s) only, with full read + edit rights. Programmes are grouped by направление in the list — a направление with several профилей collapses into one heading + nested cards. Imports their own ОП via the intake form (описание ОП + учебный план PDF); the picker (now first in the form) pre-selects when they head exactly one unit and forces a choice when they head several, prefixing each option with `ОП: ` or `Направление: ` so the linked level is unambiguous. **Picking the unit auto-fills the ФГОС header** (код, наименование направления, уровень, формы обучения) from metadata the admin recorded on that unit — уровень is a dropdown and формы are checkboxes (national-standard sets), профиль stays the РОП's to enter. Non-clickable breadcrumb on the detail page shows the ancestor chain of the linked unit so the РОП sees which институт their programme sits under.

Per-programme surfaces on the detail page:
- **Конструктор** — edit the extracted disciplines and competencies by semester.
- **Отчёт (analysis)** — headline **«Достижение результатов программы»** (does the whole plan deliver the graduate profile: verdict обеспечены / частично / есть пробелы + delivery score + covered/thin/late/uncovered breakdown, rolled up from the competency progression); sequencing & prerequisites (incl. a **holistic «Дерево зависимостей»**: dependency layers foundational→профильные, key prerequisite chains, isolated disciplines — whole-plan view derived from the edges), competency progression map, gaps & redundancy, relatedness clusters + per-semester load. Cached; last analysis exportable as a branded PDF.
- **Документы** — per-discipline РПД library. Every discipline gets its own upload slot; on upload we extract the text and **auto-detect which competency codes the РПД declares** (filtered against the programme's own competency set), pre-populating `competency_codes` so «Проверить соответствие компетенциям» works without a конструктор detour. The check scores the РПД at the **индикатор level** — each competency is decomposed into its индикаторы достижения (ОПК-14.1/.2/.3) with their Знать/Уметь/Владеть layer, each scored against the discipline content (лекции/практ/лаб/СРС/ФОС) with an evidence quote + note; the competency's covered/partial/missing status is the roll-up of its indicators, so «частично» shows exactly which indicator is the gap. Indicators render nested under each competency inline in the row (also mirrored in the Report tab). Each discipline with an uploaded РПД also offers **«Открыть в РПД-студии»** — a bridge that find-or-creates the caller's personal предмет (name-matched case-insensitively so repeat clicks reuse it; syllabus seeded from the РПД's extracted text, never overwriting a предмет that already has one) and deep-links to `/curriculum?tab=studio&course=<id>`, closing the gap between the programme document library and the teacher-scoped студия. Практики stay programme-scoped (fixed 4-type set).

The tool is analysis-only — programme content is authored in the university's own system; here we ingest, correct extracted content, and analyse.

## Oversight roles (начальник УМЦ, проректор) ✅

A teacher granted `head` or `admin` on a `governance` or `admin_office` org_unit sees **all** programmes in the institution, with **read + write + analyse** rights (collaborates on corrections and analysis alongside РОП). Optional programme-unit picker on import — they can bulk-import without linking and connect programmes to units later via the detail page's «Подразделение в структуре» select. Default-on by unit type — the IT admin's role grant is the access signal, no extra configuration required.

## Intermediate authorities (polygroup / institute heads) ✅

A teacher granted `head` or `admin` on any non-horizontal unit (`cluster` = polygroup, `division` = institute / факультет, `department` = kafedra) with programmes in their subtree sees + edits + imports for **only those programmes** — a single materialised-path walk from every held unit unions all `program` units within. Dual roles (polygroup head who is also directly the РОП of one programme) fall out of the same query. The import picker shows only their subtree's units, so they can't accidentally link a new programme outside their authority.

## Unit leader (head / sub-unit admin) ✅

A teacher granted `Руководитель` or sub-unit `Администратор` on any org_unit gets a dedicated read-only **«Руководство»** panel at `/leadership`:
- **Unit picker** — single direct holding shown as a chip, multiple as a select (choice persists per browser). Platform owner sees all institution roots.
- **Two cards** — teachers in the subtree, проверки за 30 дней.
- **30-day activity chart** — daily grades, zero-filled.
- **Teacher table** — name, primary kafedra, проверок за 30 дней, последняя активность (most-active first).
- Subtree resolved via the materialised path on org_units; per-request scope re-checked through `canActOnUnit` so a head on кафедра X cannot peek into кафедра Y.
- V1 is **grades-only and read-only** for the subtree view. Clicking any teacher row opens a **per-teacher drill** at `/leadership/teachers/:id` with 30-day totals (проверок, доля утверждений, средняя правка балла), zero-filled activity sparkline, active subjects, and the last 20 grades — gated per-target by `canActOnUnit`. Presentations / published-assignments overview cards tracked under Feature P tail d in TODO.md.
- **Programme state** section for polygroup / институт / РОП heads: every `program` org_unit in the picked subtree with a state pill (не импортирована / требуется план / готова к анализу / анализ выполнен + date), ✓ chips for the two PDFs, discipline + competency counts. Auto-hides for subtrees without programmes (e.g. kafedra heads without programmes underneath).

---

## Institution admin ✅

Panel at `/institution` (gated to `institution_admin` / `platform_admin`):
- **Overview** — teacher / grade / presentation counts, 30-day activity chart
- **Структура (org-structure tree builder)** 🚧 — build the institution's unit tree (управления/центры → институты/факультеты → полигруппы → УГСН → направления подготовки → образовательные программы (профили) → кафедры) at flexible depth: add units under any node (one at a time *or* «Списком» — paste many siblings of one type in a single batch, up to 200), rename, **change a unit's type or move it (with its whole subtree) under a new parent** via the «Тип и размещение» panel (re-type guarded against orphaning teachers/programmes; move rejects cycles and rewrites subtree paths in one transaction), delete (blocked until the unit is emptied of sub-units, teachers, **and linked programmes**). On `program`/`program_direction` units the admin can also record the **ФГОС header** (код, наименование, уровень, формы обучения) once — it prefills the РОП's import form when they pick the unit. `ugsn` («УГСН», the XX.00.00 grouping like 09.00.00) is a pure grouping tier with no programme semantics; `program_direction` (Направление подготовки, the ФГОС level like 09.03.04) and `program` (ОП/профиль nested under its направление, e.g. «Искусственный интеллект и большие данные») are both valid programme anchors — a направление with one ОП links directly, one with several профилей links at the ОП children. Each unit shows its subtree headcount. Below the tree, **«Преподаватели и роли»**: assign each teacher to a kafedra and grant per-unit roles — Администратор / Руководитель / Наблюдатель — that cascade down the tree (revoking the last *active* root admin is blocked to prevent lockout; the grant picker warns before an institution-wide grant, and «Наблюдатель» is labelled as not-yet-consumed). New institution members auto-land in the default kafedra so they're immediately visible in headcounts/leadership. §7 org model; remaining step is switching all admin routes onto the unit-scoped authoriser.
- **Usage** — tokens + grade/presentation counts over time, **CSV export** (never shows cost)
- **Teachers** — list, activate/deactivate (frees a seat), single invite, **bulk invite** (paste list), revoke invites. Pending invites whose email was rejected by the provider show «Письмо не доставлено» with the reason (migration 048).
- **Criteria** — create institution-shared criteria (appear in every member's grading picker)
- **Учебные планы (program architecture analysis)** — register an образовательная программа (header reqs + upload **описание ОП** and **учебный план** PDFs → disciplines & ФГОС competencies/goals auto-extracted), or build it manually by semester. Then analyse the whole plan: sequencing & prerequisite inversions, competency progression map (introduce→develop→master across semesters), gaps & redundancy (orphan disciplines / uncovered competencies), relatedness clusters & per-semester load. Persisted; last analysis cached. One-click example track for evaluation. **Export the analysis as a server-rendered branded PDF** (pdfkit, embedded PT Serif/PT Sans, fixed premium layout).
- **Audit log** — record of member activity in the institution: admin actions (invites, activations, shared-criterion creation, org-structure changes, unit-role grants/revocations, kafedra assignments) **plus every state-changing action any member takes** (grading, courses, rubrics, presentations, documents…), captured automatically by the global audit middleware
- Invite flow: branded email (Unisender) → `/register?invite=` → auto-joins institution
- **LTI 1.3 integration (launch, Deep Linking, grade write-back, roster sync, course mapping, Dynamic Registration)** ✅ — Settings → Organisation → LTI: register a Moodle (or other LTI 1.3 platform) issuer/client ID/deployment ID/endpoints, test connection to the platform's JWKS, or use one-click **Dynamic Registration** (paste a generated link into Moodle's own registration screen instead of copying fields by hand). Teachers click "Open in GradeAssist" from a Moodle course → OIDC launch → JIT-provisioned into GradeAssist (same session JWT shape as password/SAML login) → lands directly in the grading view for a course auto-created from the Moodle context on first launch. Teachers can also add GradeAssist as a Deep-Linked Moodle activity — picks or creates a published assignment, course-scoped from creation, and can **import the Moodle class roster (NRPS)** straight into the invite list instead of typing students one at a time. Students who launch that activity from Moodle land straight on the existing tokenised `/student/:token` writing surface (no separate login), with an LMS-verified identity captured at launch. When the teacher approves a grade for an LTI-launched submission, the score posts back to the Moodle gradebook automatically (AGS) — a small "✓ Moodle" / "⚠ Moodle" badge on the grade detail shows sync status. An institution admin can also **map each auto-created course to an org-tree unit** for institutional reporting rollups (purely additive — never gates whether a teacher can grade). Only a launch activity log remains on the backlog

---

## Platform admin ✅

Panel at `/admin` (direct URL only, `platform_admin`):
- **Overview** — platform stats + today's cost
- **Usage** — by day / feature / teacher (cost visible here only)
- **Платежи** — business metrics: revenue this month / 30 days, active auto-renew subscriptions, failed charges, teachers in grace period; monthly revenue table; full payment list (who/when/plan/amount, покупка vs продление via `rb_` order-id prefix) with status filter + pagination
- **Активация** — activation funnel (signup → предмет → первая проверка → презентация, derived retroactively from existing data), 24h/72h/7d aha-conversion + median time-to-first-grade, weekly signup cohorts, «застрявшие» triage list (48h+ old, never graded, not seen 48h)
- **Teachers** — search, change role / plan / institution assignment, activate/deactivate
- **Institutions** — create/edit (tier, seat cap, **email auto-join domain**), teacher counts; **SAML SSO config** per institution (IdP entity id / SSO URL / cert, attribute mapping, copy-ready SP metadata + ACS URLs)
- **Criterion templates** — global templates teachers start from (incl. STEM)
- **Feedback** — browse in-app user feedback (category filter, reply link); per-article help-center 👍/👎 aggregate table and a "not found" search-query list, derived client-side from the same feed
- **Обращения** — public Contact/Research form submissions (topic filter, unread/read state, reply link)
- **Errors** — recent AI/service errors
- **Журнал действий** — cross-institution activity log (every recorded user action; filter by action/date, paginated; shows actor + IP)
- **Subscription management** — grant/extend Pro, cancel, refund (T-Bank)

---

## Cross-cutting / platform ✅

- **Email** — Unisender Go transactional (cluster go2): registration, password reset/changed, institution invite, renewal dunning; **owner notifications** (new signup, purchase, feedback, public contact-form message) to `ADMIN_NOTIFY_EMAIL`; **activation nudges** — hourly sweep emails teachers who never graded (24–72h: «первая проверка за 2 минуты»; 72h–7d: first-steps video), idempotent via `activation_nudges`, HMAC unsubscribe link → `nudge_emails_enabled`
- **Ops alerting** — unhandled 500s / DB outages → rate-limited Telegram push + `production_incidents` row (per-client blast radius); weekly Monday Telegram activation digest (signups / activated / stalled / nudges); support runbooks + triage flow in `docs/support/`
- **Auth** — JWT (7-day), bcrypt-12, password-change token invalidation, role middleware; **SAML 2.0 SSO** — email-first login routes to the institution's IdP when configured, JIT-provisions the teacher on first login (password auth still works alongside); SLO deferred
- **Security** — helmet, CORS allowlist, rate limiting, express-validator, parameterized SQL, prompt-injection sanitisation, magic-byte file validation
- **PWA** — installable, offline, Workbox service worker
- **Infra** — Yandex Cloud VM (RU), nginx, **PM2 cluster (2 workers)**, PostgreSQL + pgvector with tuned config, numbered SQL migrations 001–019, `/api/health`
- **Backups** — nightly `pg_dump` → dedicated write-only Object Storage bucket with Telegram success/failure report (`npm run backup:db`), bucket lifecycle rule for retention, restore runbook (`docs/support/runbooks/restore-database.md`); Yandex Compute disk snapshot schedule for whole-VM recovery
- **Performance** — pg pool tuned (`max=25`), composite indexes on hot queries (migration 016), pm2-logrotate, Postgres 512 MB shared_buffers — sized for ~1000 users on current 2 GB VM (see `docs/scaling.md` for Tier 2/3 roadmap)
- **Design system** — custom SVG `Icon` component (14 named icons, no library dep), brand-aligned `SuccessMark` for confirmation screens, replacing platform-dependent OS emojis
- **Compliance docs** — `docs/legal/security-overview.md`, `docs/legal/152-fz-dpa.md` (templates, need legal review)

---

## Planned / backlog 📋

- **Invoicing / seat billing** — счёт generation, institution-level expiry, seats-paid vs used
- **AI data residency** — RU-hosted reasoning model for institutions (parked — see `docs/TODO-ai-data-residency.md`)
- **Domain ownership verification** — DNS TXT before honoring auto-join (currently admin-set only)
- **Department analytics** — cohort comparison, at-risk students across an institution
- **Uptime monitoring + public status page** (external monitor on `/api/health`)
- LMS deeper integration remaining scope: launch activity log, SCIM provisioning, white-label (everything else — launch, Deep Linking, student launch, AGS grade write-back, NRPS roster sync, course-mapping UI, Dynamic Registration — already shipped, see Institution admin section)
