# ИСПУМ — Feature Inventory

Single source of truth for what's built, by user type. Update this in the **same
commit** as any feature change.

**Legend:** ✅ shipped · 🚧 in progress · 📋 planned
**Last updated:** 2026-06-06

---

## Roles & tiers at a glance

| Role | How assigned | Key capabilities |
|---|---|---|
| **Public visitor** | unauthenticated | Marketing site, register/login, accept invite |
| **Teacher — Free** | default on signup | Limited grading/presentations, no docs/RAG/email |
| **Teacher — Pro** | paid (T-Bank) | Unlimited, document upload, RAG, email drafts, full history |
| **Institution member** | invite or email-domain auto-join | Inherits full institution entitlements + shared rubrics |
| **Institution admin** | set by platform admin | Manage own institution (teachers, invites, rubrics, usage, audit) |
| **Platform admin** | set in DB | Full platform: teachers, institutions, templates, billing, feedback, errors |

Entitlements are computed as the **stronger of** the teacher's own tier and their
institution's tier (`backend/src/middleware/authenticate.ts`).

---

## Public / unauthenticated ✅

- Landing page (hero, problem/solution, 3 feature pillars: проверка / лекции / аналитика, pricing, feature matrix)
- Marketing pages: About, Institutions, FAQ, Ethics, Contact, Pricing, Changelog, Use-cases, Offer, Privacy, Terms, Cookies
- Register (with optional `?invite=` institution invite — prefills + locks email)
- Login (password reveal, inline errors)
- Forgot / reset password (email link, 1-hour token)
- Yandex Metrica analytics (public pages only; Webvisor never runs on authenticated pages — 152-ФЗ)

---

## Teacher — Free ✅

**Grading**
- AI grading via DeepSeek (rubric-based or holistic) — score, letter grade, per-criterion breakdown, strengths, improvements
- Teacher review + approve flow (AI never final; approval feeds RAG)
- STEM / calculation mode (reasoning model + optional reference solution)
- Grading history / **Журнал** (search by student/group, course + status filters, pagination)
- Revisit any past grade (read-only detail modal, incl. ВКР chapter review)
- Moodle-compatible **CSV grade export**
- Watermark on output (free tier only)
- Limits: 20 grades/mo, 3 presentations/mo, 3 courses, 5 rubrics, 30-day history

**Courses** — CRUD, level, syllabus text/upload
**Rubrics** — builder (weights as %, live sum check), start from global templates
**Students** — auto-collected roster from graded work, per-student grade-over-time chart, groups
**Presentations** — slide-by-slide generator (title, bullets, speaker notes), copy-per-slide
**Onboarding** — welcome modal (first login), getting-started checklist (tracks real progress), per-page "how it works" intros, no-course hints on grading/presentations
**Account** — feedback page, in-app help center, settings, password change, account deletion (152-ФЗ cascade)

---

## Teacher — Pro ✅

Everything in Free, plus:
- **Unlimited** grades, presentations, courses, rubrics
- **Document upload** — PDF / DOCX / image with OCR (Yandex Vision), auto-fills submission
- **RAG flywheel** — grading learns from approved grades (course-scoped few-shot)
- **Long-document review** — ВКР/диплом section-aware map-reduce: chapter-by-chapter analysis, defense questions, suggested grade
- **Feedback email generation** — draft email to student (teacher sends from own client)
- **Presentation history**
- Full grading history, no watermark
- Billing: monthly / annual via T-Bank (recurring, grace period + dunning, 54-ФЗ fiscal receipts)

---

## Institution member ✅

A teacher in an institution-tier org (via invite or email-domain auto-join):
- Automatically gets **full institution entitlements** (= Pro-level: unlimited, uploads, RAG, email)
- Sees **institution-shared rubrics** in the grading rubric picker, alongside own + global templates

---

## Institution admin ✅

Panel at `/institution` (gated to `institution_admin` / `platform_admin`):
- **Overview** — teacher / grade / presentation counts, 30-day activity chart
- **Usage** — tokens + grade/presentation counts over time, **CSV export** (never shows cost)
- **Teachers** — list, activate/deactivate (frees a seat), single invite, **bulk invite** (paste list), revoke invites
- **Rubrics** — create institution-shared rubrics (appear in every member's grading picker)
- **Audit log** — record of admin actions (invites, activations, shared-rubric creation)
- Invite flow: branded email (Unisender) → `/register?invite=` → auto-joins institution

---

## Platform admin ✅

Panel at `/admin` (direct URL only, `platform_admin`):
- **Overview** — platform stats + today's cost
- **Usage** — by day / feature / teacher (cost visible here only)
- **Teachers** — search, change role / plan / institution assignment, activate/deactivate
- **Institutions** — create/edit (tier, seat cap, **email auto-join domain**), teacher counts
- **Rubric templates** — global templates teachers start from (incl. STEM)
- **Feedback** — browse in-app user feedback (category filter, reply link)
- **Errors** — recent AI/service errors
- **Subscription management** — grant/extend Pro, cancel, refund (T-Bank)

---

## Cross-cutting / platform ✅

- **Email** — Unisender Go transactional (cluster go2): registration, password reset/changed, institution invite, renewal dunning; **owner notifications** (new signup, purchase, feedback) to `ADMIN_NOTIFY_EMAIL`
- **Auth** — JWT (7-day), bcrypt-12, password-change token invalidation, role middleware
- **Security** — helmet, CORS allowlist, rate limiting, express-validator, parameterized SQL, prompt-injection sanitisation, magic-byte file validation
- **PWA** — installable, offline, Workbox service worker
- **Infra** — Yandex Cloud VM (RU), nginx, PM2, PostgreSQL + pgvector, numbered SQL migrations, `/api/health`
- **Compliance docs** — `docs/legal/security-overview.md`, `docs/legal/152-fz-dpa.md` (templates, need legal review)

---

## Planned / backlog 📋

- **Invoicing / seat billing** — счёт generation, institution-level expiry, seats-paid vs used
- **AI data residency** — RU-hosted reasoning model for institutions (parked — see `docs/TODO-ai-data-residency.md`)
- **Domain ownership verification** — DNS TXT before honoring auto-join (currently admin-set only)
- **Department analytics** — cohort comparison, at-risk students across an institution
- **Uptime monitoring + public status page** (external monitor on `/api/health`)
- LMS deeper integration, SSO/SAML, white-label
