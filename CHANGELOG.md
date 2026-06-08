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
- Rubric builder simplified — removed redundant МАКС field; weights are now percentages with a live sum-to-100 check
- Landing page copy + new analytics feature pillar
- Public changelog page refreshed with real shipped features + correct dates (1.0–1.3)

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
