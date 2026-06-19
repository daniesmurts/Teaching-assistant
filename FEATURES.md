# ИСПУМ — Feature Inventory

Single source of truth for what's built, by user type. Update this in the **same
commit** as any feature change.

**Legend:** ✅ shipped · 🚧 in progress · 📋 planned
**Last updated:** 2026-06-19

---

## Roles & tiers at a glance

| Role | How assigned | Key capabilities |
|---|---|---|
| **Public visitor** | unauthenticated | Marketing site, register/login, accept invite |
| **Teacher — Free** | default on signup | Limited grading/presentations, no docs/RAG/email |
| **Teacher — Pro** | paid (T-Bank) | Unlimited, document upload, RAG, email drafts, full history |
| **Institution member** | invite or email-domain auto-join | Inherits full institution entitlements + shared criteria |
| **Institution admin** | set by platform admin | Manage own institution (teachers, invites, criteria, usage, audit) |
| **Platform admin** | set in DB | Full platform: teachers, institutions, templates, billing, feedback, errors |

Entitlements are computed as the **stronger of** the teacher's own tier and their
institution's tier (`backend/src/middleware/authenticate.ts`).

---

## Public / unauthenticated ✅

- Landing page (hero, problem/solution, 4 feature pillars: проверка / лекции / тесты / аналитика, pricing, feature matrix)
- Marketing pages: About, Institutions, FAQ, Ethics, Contact, Pricing, Changelog, Use-cases, Offer, Privacy, Terms, Cookies
- Register (with optional `?invite=` institution invite — prefills + locks email)
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
- STEM / calculation mode (reasoning model + optional reference solution)
- Grading history / **Журнал** (search by student/group, subject + status filters, pagination)
- Revisit any past grade (read-only detail modal, incl. ВКР chapter review + revision check)
- Moodle-compatible **CSV grade export**
- Watermark on output (free tier only)
- Limits: 20 grades/mo, 3 presentations/mo, 3 topic generations/mo, 3 quizzes/mo, 3 task sets/mo, 3 subjects, 15 criteria, 30-day history

**Topics** — AI topic generator for research/practicals: student level + field + interests + practice site → level-appropriate, valuable topics (with rationale, scope, novelty). Yandex Search grounding. Optional student attachment (name + group, autocomplete from existing students) for later lookup. Free: 3/mo, Pro: unlimited
**Subjects (formerly «Курсы»)** — CRUD, level, syllabus text/upload. Renamed in UI per Russian-academic vocab («курс» = year of study; «предмет» = subject). URL `/courses` and DB `course_id` unchanged
**Criteria** — library of reusable criteria (name + description + optional subject), start from global templates. Selected at grading time with per-criterion weights and a live sum-to-100 check
**Students** — auto-collected roster from graded work, per-student grade-over-time chart, groups
**Учебный план и РПД — суите** 🚧 — one page (`/curriculum`), three tabs (КНИТУ curriculum-intelligence; teacher-scoped pending a first-class учебный план entity; see `docs/KNITU-roadmap.md`):
- **Дублирование тем** (A3) — select ≥2 disciplines → extracts each discipline's topics, compares them semantically across disciplines, flags duplicated / partially-overlapping / adjacent topics with a recommendation
- **Соответствие РПД компетенциям** (A2) — select a discipline → auto-extracts the ОПК/ПК/УК competencies + goals declared in its РПД → scores how well the content covers each (обеспечена / частично / не обеспечена) with evidence quote, gap, and a concrete fix
- **РПД-студия** (T5) — select a discipline → AI drafts РПД content (цели, результаты по компетенциям, темы, формы контроля) aimed at its ОПК/ПК/УК + goals, then self-checks coverage. Sections editable; «Перепроверить покрытие» re-scores the edited text (write→check→fix loop). AI assists; teacher is author of record
**Материалы (хаб генерации)** — single sidebar entry (`/materials`) that launches all generators below (Презентации / Тесты / Темы работ / Задания / Кейсы / Проекты), replacing separate menu items; clear "what can I create?" overview for new users
**Задания / Кейсы / Проекты** — one practical-material generator (`/materials/:kind`): topic + difficulty (базовый/средний/продвинутый) + optional subject → задания (условие), кейсы (ситуация + вопросы для разбора), or проекты (цель, результат, этапы), each with developed skills and a teacher hint. Copy-all + per-kind history. Free: 3/mo, Pro: unlimited
**Presentations** — slide-by-slide generator (title, bullets, speaker notes), copy-per-slide
**Quizzes («Тесты»)** — 5–20 multiple-choice questions on a topic, at one of three Bloom-style levels (recall / understanding / application), grounded in the subject's materials via RAG with source citations. Answer reveal, history. Free: 3/mo, Pro: unlimited
**Onboarding** — welcome modal (first login), getting-started checklist (persists until first grade), per-page "how it works" intros, no-subject hints on every generator page, and a **progressive sidebar** (new users see only essential start-here items + a «Показать всё» toggle; full nav unlocks automatically after the first grade)
**Account** — feedback page, in-app help center, settings, password change, account deletion (152-ФЗ cascade)

---

## Teacher — Pro ✅

Everything in Free, plus:
- **Unlimited** grades, presentations, courses, criteria
- **Document upload** — PDF / DOCX / image with OCR (Yandex Vision), auto-fills submission
- **RAG flywheel** — grading learns from approved grades (course-scoped few-shot)
- **Тщательная проверка (confidence)** — opt-in per grade; runs a grader ensemble and flags low-confidence works for closer review (selective-prediction triage)
- **Long-document review** — ВКР/диплом section-aware map-reduce: chapter-by-chapter analysis, defense questions, suggested grade
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

## Institution admin ✅

Panel at `/institution` (gated to `institution_admin` / `platform_admin`):
- **Overview** — teacher / grade / presentation counts, 30-day activity chart
- **Usage** — tokens + grade/presentation counts over time, **CSV export** (never shows cost)
- **Teachers** — list, activate/deactivate (frees a seat), single invite, **bulk invite** (paste list), revoke invites
- **Criteria** — create institution-shared criteria (appear in every member's grading picker)
- **Audit log** — record of admin actions (invites, activations, shared-criterion creation)
- Invite flow: branded email (Unisender) → `/register?invite=` → auto-joins institution

---

## Platform admin ✅

Panel at `/admin` (direct URL only, `platform_admin`):
- **Overview** — platform stats + today's cost
- **Usage** — by day / feature / teacher (cost visible here only)
- **Teachers** — search, change role / plan / institution assignment, activate/deactivate
- **Institutions** — create/edit (tier, seat cap, **email auto-join domain**), teacher counts; **SAML SSO config** per institution (IdP entity id / SSO URL / cert, attribute mapping, copy-ready SP metadata + ACS URLs)
- **Criterion templates** — global templates teachers start from (incl. STEM)
- **Feedback** — browse in-app user feedback (category filter, reply link)
- **Errors** — recent AI/service errors
- **Subscription management** — grant/extend Pro, cancel, refund (T-Bank)

---

## Cross-cutting / platform ✅

- **Email** — Unisender Go transactional (cluster go2): registration, password reset/changed, institution invite, renewal dunning; **owner notifications** (new signup, purchase, feedback) to `ADMIN_NOTIFY_EMAIL`
- **Auth** — JWT (7-day), bcrypt-12, password-change token invalidation, role middleware; **SAML 2.0 SSO** — email-first login routes to the institution's IdP when configured, JIT-provisions the teacher on first login (password auth still works alongside); SLO deferred
- **Security** — helmet, CORS allowlist, rate limiting, express-validator, parameterized SQL, prompt-injection sanitisation, magic-byte file validation
- **PWA** — installable, offline, Workbox service worker
- **Infra** — Yandex Cloud VM (RU), nginx, **PM2 cluster (2 workers)**, PostgreSQL + pgvector with tuned config, numbered SQL migrations 001–019, `/api/health`
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
- LMS deeper integration (LTI 1.3, Moodle roster/grade sync, SCIM provisioning), white-label
