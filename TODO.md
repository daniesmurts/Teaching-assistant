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

### 14. Rework AdminUsage / AdminCapacity / AdminErrors for the fleet · Effort: M — gated on a second deployment existing

`docs/on-prem-deployment.md` §16 Track 1.7 / §5.4 originally planned all
three of these pages gaining a deployment dimension, alongside `AdminOverview`
becoming fleet cards. The `AdminOverview` half of that was deliberately
dropped — `Развёртывания` (shipped 2026-08-15) already covers the
one-card-per-deployment role, and replacing `AdminOverview`'s teacher/cost/
quality stats with fleet cards would have been redundant *and* thrown away
a page in daily use for something unrelated to fleet size. These three are
parked for a related but distinct reason: with exactly one deployment in
existence, none of "split by mode," "filter by deployment," or "group by
deployment" has anything to act on — every row collapses to the one row.
Building the UI now means designing on-prem capacity metrics (tokens/sec,
GPU saturation) before Track 0's technical spike has even measured what
those numbers look like against a real self-hosted deployment.

- **Why** — the plumbing (a `deployment_id` dimension in these queries) is
  cheap and was explicitly meant to be done "while there's one deployment
  to be wrong about" (§5.6) — but the *UI* built against that plumbing has
  nothing real to validate against yet, and guessing wrong here is more
  expensive to unwind than waiting.
- **Gate** — a second real deployment (a cloud-pilot dedicated tenant, or
  the on-prem deal actually landing) — whichever comes first. At that
  point the fields these pages need becomes an observed requirement, not a
  guess.
- **Data-source correction, worth remembering when this is picked up**:
  `AdminErrors` currently reads `api_usage_log` (AI-provider call failures —
  rate limits, timeouts). `deployment_incidents` is a *different* concept
  (uncaught 500s / DB-unavailable, via `errorHandler.ts` → `production_incidents`).
  §5.4's "AdminErrors grouped by deployment and version" means the latter —
  this should land as a new section/table, not a replacement of the
  AI-error view that's already there and already useful for its own purpose.
- **Touches** — `AdminUsage.tsx`/`AdminCapacity.tsx`/`AdminErrors.tsx`,
  their backing queries in `db/queries/usageLog.ts` /
  `db/queries/capacity.ts`, and `db/queries/controlPlane.ts` for the
  `deployment_incidents` half.

### 15. Tighten Trivy to fail CI on CRITICAL vulnerabilities · Effort: S — gated on a triaged baseline

`.github/workflows/ci.yml`'s image job (§16 Track 1.5) scans every build with
Trivy but is deliberately non-blocking (`exit-code: '0'`) — day one of
scanning is not the day to hard-fail CI on whatever the `node:20-slim` base
image and the current npm tree already carry, since that would block every
deploy on a backlog nobody has looked at yet.

- **Why** — a scan nobody acts on is a compliance checkbox, not real
  security posture. Once the current findings have been triaged (accepted,
  patched, or shown to be false positives / not reachable), failing on new
  CRITICAL findings going forward is what actually prevents regressions.
- **Gate** — do a first triage pass over `trivy-results.txt` from a recent
  run (uploaded as a workflow artifact, 90-day retention) to establish
  what's already known-accepted, then flip `exit-code: '0'` → `'1'` on the
  `Vulnerability scan (Trivy)` step, scoped to `severity: CRITICAL` only —
  HIGH stays report-only until there's more appetite for it.
- **Touches** — `.github/workflows/ci.yml` only, one flag flip once the
  triage is done.

### 16. Write the real `/docs` articles · Effort: M

The shell (`docs-site/`, build/postbuild pipeline, nav + search + version
stamp, 2026-08-15) ships with one scaffold overview article per section,
proving the pipeline end-to-end but not yet useful to a real IT admin.
Highest-value first, per the earlier discussion:

1. ~~**Настройка LTI 1.3 (Moodle)**~~ — ✅ shipped 2026-08-15
   (`docs-site/articles/integration/lti-setup.md`). Both registration paths
   (dynamic + manual, sourced from the exact `InstitutionLti.tsx` field
   labels), the Deep Linking requirement, and a troubleshooting table
   mapping every real `LTI_*` error code from `routes/lti.ts`/`services/lti.ts`
   to a plain-language cause and fix — not paraphrased, grepped directly
   from the code so the codes and Russian messages match exactly.
2. ~~**Настройка входа по SAML**~~ — ✅ shipped 2026-08-15
   (`docs-site/articles/integration/saml-setup.md`). Rewritten from
   `docs/saml-testing.md`'s "how we test it" into "how it works" — turned
   out to be a materially different article than LTI's, not just a
   find-replace: SAML has **no self-serve institution UI** (confirmed via
   `requireAdmin` gating `admin.ts`, vs. LTI's institution-scoped
   `institution.ts`) — it's platform-admin-configured on the customer's
   behalf via a panel in `AdminInstitutions.tsx`, so the article frames it
   as a two-sided value exchange coordinated out of band, not a
   self-service walkthrough, and says plainly that there's no settings page
   to go looking for. Error codes/messages (`SAML_CONFIG_INCOMPLETE`,
   `SAML_NOT_CONFIGURED`, `SAML_VALIDATION_FAILED`, `SAML_NO_PROFILE`,
   `SAML_NO_EMAIL`, `SSO_REQUIRED`, `ACCOUNT_DISABLED`) grepped verbatim
   from `services/saml.ts`/`routes/sso.ts`/`routes/auth.ts`, same discipline
   as the LTI article.
3. ~~**Модель доступа: оргструктура, роли, домены**~~ — ✅ shipped
   2026-08-15 (`docs-site/articles/integration/access-model.md`). Written
   entirely in the UI's own Russian labels (Наблюдатель/Редактор/
   Администратор; Все области/Платформа/Учебно-методическая работа/Учебный
   процесс/УМУ) — confirmed via `InstitutionStructure.tsx` that the raw
   domain slugs (`curriculum`, `umu`, etc.) are never shown to an admin, so
   the article never uses them either. Domain-axis rationale is the
   Заведующий кафедрой example, sourced from the near-identical comment
   repeated verbatim across `orgUnits.ts`/`rpdMonitor.ts`/`rpdApprovals.ts`
   — not invented, and cross-checked against ACCESS-MATRIX.md §4's own
   compliance table ("ЗК не видит Мониторинг РПД ✅ нет гранта `umu`").
   Also documents the built-in grant-form guardrails (root-only
   admin+all, governance/admin_office institution-wide warning, redundant-
   grant detection) and states plainly that invite/deactivate/primary-
   department/LTI/model/RAG settings stay root-admin-only regardless of
   any grant — matches `project_it-owns-provisioning`.
4. ~~**Управление преподавателями**~~ — ✅ shipped 2026-08-15
   (`docs-site/articles/integration/teacher-provisioning.md`). States
   plainly that provisioning is centrally IT-owned, not delegated per
   subtree, matching `project_it-owns-provisioning`. Documents two real
   gotchas found while researching, both easy to be surprised by if you
   only read the UI: (1) single-invite and bulk-invite count differently
   against the seat cap — single counts only active members, bulk also
   counts outstanding pending invites; (2) an expired/invalid invite link
   doesn't show an error — it silently degrades to a normal, org-less
   self-registration, so a teacher who "registered but doesn't see the
   organisation" almost certainly used a stale link. Also covers what
   deactivation actually does (blocks every subsequent request, not the
   login screen itself; already-published assignments/grades stay visible
   to students; fully reversible; self-deactivation blocked) — verified
   against `middleware/authenticate.ts`'s `ACCOUNT_DISABLED` check rather
   than assumed from the button label.
5. ~~**Диагностика типовых проблем**~~ — ✅ shipped 2026-08-15
   (`docs-site/articles/integration/troubleshooting.md`). Symptom-first
   triage, not a fifth copy of the other four articles' error tables — a
   routing table pointing to the right deep-dive, plus the two categories
   none of them own: plain password-login failures and file uploads.
   Documents two real gaps found while researching, both worth fixing (see
   TODO #17/#18) but documented as current behaviour in the meantime:
   deactivated accounts pass the login screen and only fail on the next
   request (cross-linked to the provisioning article rather than
   duplicated), and uploads between 20–21 MB get ИСПУМ's own clean error
   while uploads over ~21 MB hit nginx's `client_max_body_size` first and
   get its raw, unstyled default error page — a real, confirmed
   discontinuity in what the user sees, not a guess. Includes `GET
   /api/health` as the one self-serve way to rule out "is it just us"
   before assuming the fault is local configuration.
6. Expand `security/overview.md` into the fuller obzor + DPA pair, sourced
   from `docs/legal/security-overview.md` / `docs/legal/152-fz-dpa.md` —
   **needs lawyer sign-off before publishing**, per that file's own header
   ("перед передачей клиенту согласуйте с юристом"). Don't just copy it in.

- **Why** — this is the actual product of the docs site; the shell alone
  answers nobody's question. But it wasn't done in the same pass as the
  shell because writing several articles is genuinely separate work from
  building the pipeline they render through, worth its own review pass.
- **Gate** — none; can start immediately. Ordered by expected support-load
  reduction, not by ease.
- **Touches** — `docs-site/articles/<section>/*.md` only; no code changes
  once the shell exists, per `docs-site/README.md`'s workflow.

### 17. Seat-cap accounting is inconsistent between single and bulk teacher invite · Effort: S

Found while writing the teacher-provisioning docs article, not from a
support report. `POST /api/institution/teachers/invite` (single) checks
`max_teachers` against active members only — the code comment says so
explicitly ("max_teachers includes pending invites is out of scope — count
members only"). `POST /api/institution/teachers/invite-bulk` checks
`max_teachers` against active members **plus outstanding pending
invites**. Same cap, two different definitions of "how full are we,"
depending on which button an admin happens to click.

- **Why** — an admin near their seat limit gets a materially different
  answer to "can I invite one more?" depending on which form they use, with
  no indication anywhere that the two forms count differently. At best
  confusing; at worst an admin invites via the single form believing they
  have room, when the bulk form would have told them otherwise (or vice
  versa).
- **Fix** — pick one definition (bulk's — members + pending — is the more
  correct one, since a pending invite is a real claim on a seat once
  accepted) and make the single-invite endpoint match it.
- **Touches** — `backend/src/routes/institution.ts`'s `/teachers/invite`
  handler; add a regression test asserting both endpoints compute the same
  available-seats number for the same institution state.

### 18. Expired/invalid invite link fails silently instead of showing an error · Effort: S

Also found while writing the teacher-provisioning docs article.
`POST /api/auth/register` with an `invite_token` that's expired or
otherwise doesn't resolve via `findValidInviteByToken` doesn't reject the
request — the code comment confirms this is deliberate: *"An invalid/
expired token is ignored — registration still succeeds as a normal
teacher."* The person registering gets no error and no indication anything
was wrong; they just end up with a normal, org-less account instead of
joining the inviting institution.

- **Why** — this is the leading (and currently undiagnosable-by-the-user)
  explanation for "I registered but don't see my organization" support
  requests. The docs article now tells IT admins to suspect a stale link
  and re-invite, but that's a workaround for a real gap, not a fix — the
  person who actually hit the expired link gets no signal at all that
  anything went wrong.
- **Fix** — when `invite_token` is present but doesn't resolve, surface it
  distinctly (e.g. a non-blocking notice on the registration success page:
  "Приглашение больше не действительно — обратитесь к администратору
  организации за новой ссылкой") rather than registering silently as if no
  token had been provided at all. Registration should still succeed either
  way — this is about the person and the inviting admin both getting a
  correct signal, not about blocking signup.
- **Touches** — `backend/src/routes/auth.ts`'s `POST /register` handler,
  the response shape consumed by `frontend/src/pages/Register.tsx`.

### 19. Prompts → versioned content packs · Effort: L — on-prem-deployment.md §16 Track 2.3

Sized while doing the rest of Track 2's deal-agnostic slice (2.1
`DEPLOYMENT_MODE`, 2.2 runtime frontend config, 2.6 onprem fallback
denial — all shipped 2026-08-17), then deliberately not started in the
same pass. Prompts, rubric templates, criteria libraries, and FGOS
reference data are inline across 20+ files in `backend/src/services/`
(`grading.ts`, `presentations.ts`, `longReview.ts`, `topics.ts`,
`fosGenerator.ts`, …) — there is no `prompts/` module today.

- **Why** — under a quarterly release train, an on-prem customer's grading
  quality freezes for three months at a time; a prompt fix that reaches
  cloud on a Tuesday reaches them in November. Prompt iteration is the
  fastest improvement loop this product has, and self-managed deployments
  throttle it to the slowest cadence available unless prompts ship as
  versioned content independent of code. The plan doc calls this out as
  worth doing *before* the first on-prem release, not after — retrofitting
  once a customer is live means their first three months run on frozen
  prompts, and cloud benefits from the same decoupling (prompt changes stop
  requiring a deploy).
- **Why not done alongside 2.1/2.2/2.6** — those three were each a single
  well-scoped file or a small, contained change, reviewable and testable in
  one pass. This one touches the actual prompt logic behind grading,
  presentations, quizzes, ВКР review, and topic generation — the core of
  what the product does. Rushing a 20+ file refactor of that surface under
  the same time pressure as three small items risks breaking grading
  quality in a way that's hard to notice immediately and expensive to trace
  back. It needs its own design pass: what a "content pack" actually is
  (versioned how, signed how, pulled from where vs. applied from a file
  when air-gapped), and a migration plan for the existing inline prompts
  that doesn't touch all 20+ files in one commit.
- **Gate** — none; can start whenever there's a dedicated pass for it,
  same "earlier than instinct suggests" framing as the plan doc gives it.
  Not blocked on the discovery questionnaire's answers — this one is
  genuinely deal-agnostic and benefits cloud regardless.
- **Touches** — new `prompts/` (or `content-packs/`) module; every service
  file listed above; content-pack pull/apply mechanism (control plane for
  cloud, file-based for air-gapped, per §16 Track 2.3's own note).

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

**«Связка оценочного средства» check added (2026-08-20, same methodist review).** Her second item: an оценочное средство named in п.4's table must be traceable through СРС (форма подготовки), КСР (форма контроля), п.9 (баллы) and ФОС — «ДОКЛАД» → «ПОДГОТОВКА ДОКЛАДА» → «ЗАСЛУШИВАНИЕ ДОКЛАДА» → «ДОКЛАД» с баллами. Nothing checked for this before; a name in п.4 and nowhere else is an assessment that exists only on paper. `services/assessmentLinkage.ts`, registered as the 5th check in Кабинет методиста's registry. LLM extraction (§4 table / СРС / КСР / §9 out of prose, temperature 0), deterministic linkage (reuses the Russian stemmer, now in `lib/ruText.ts`). Экзамен/зачёт check against п.9 only (требовать «Заслушивание экзамена» would fire on every correct РПД).

**Truncation bug fixed (2026-08-20, same day) — §9 was routinely never shown to the model.** User-tested against a real 14-page РПД: every instrument came back "missing from п.9" even when п.9 genuinely had it with points, because `parseAssessmentLinkage` sliced `text.slice(0, 14000)` from the start and §9 sat on page 11 — outside a window covering roughly the first 5 pages. Fixed by reusing `documentReview.ts`'s heading-anchored `selectRelevantSections` (now takes optional `headings`/`priority` params, defaults unchanged for every other caller) with a linkage-specific heading set (§4/§8/§8.1/§9), budget bumped to 40000. Regression test reproduces the shape. **Open question sent to the methodist, not yet resolved:** whether an aggregate-style §9 table (points by control-point TYPE, not one line per named оценочное средство) should pass this check or is a real gap — the answer determines whether the matching logic needs a "belongs to category" concept, which the current exact-name `mentions()` doesn't have.

**Two more bugs fixed same day, both from user testing on real РПД, not synthetic examples.** (1) СРС/КСР false-missing on comma-joined instrument names («Доклад, сообщение» requiring both words together instead of either as an alternative) — `mentions()` now splits on comma/«и/или»/«или» into OR-alternatives. (2) МТО (§12) — same truncation bug as §9's, found in `mtoReview.ts` (a file this session hadn't otherwise touched): `documentText.slice(0, 20000)` from the start never reached §12, which sits after §9-11 near the end of a real РПД, so the check reported "раздел пуст" on a document that clearly listed real software. Fixed with the same `selectRelevantSections` reuse, budget 20000→40000, new `mtoReview.test.ts` (first test file for this service).

**ФОС upload path + real ФОС verification added (2026-08-20, same day).** ФОС was checked-in-name-only until now — no upload path existed, so the ФОС link was permanently unverified regardless of reality. New `program_documents` kind `'fos'` (no migration, `kind` is unconstrained TEXT) — a методист/РОП attaches the discipline's actual ФОС the same way a working programme is attached, one CURRENT file, re-upload supersedes (`findFosForDiscipline`/`supersedeFosForDiscipline`). `checkAssessmentLinkage` takes the ФОС text as an optional param; result carries `fos_available` so "checked and failed" is never conflated with "never verified" in either the backend result or `AssessmentLinkageReport.tsx`'s chip.

**Ad-hoc «Отдельный файл» can take a ФОС too (same day).** That tab is mainly used to vet a new РПД before it's published/attached to an ОП — no discipline row exists yet to persist a ФОС against. `POST /api/methodist/ad-hoc-review` gained an optional `fos_file` field (multer `uploadFields`); its text feeds `checkAssessmentLinkage` for that one run via `adHocChecks.ts`'s new `AdHocCheckOptions`, nothing persisted.

**Formulation check added (2026-08-20, methodist feedback).** A методист reviewing a real РПД found the check scoring «Знать/Уметь/Владеть» items at 100% «Обеспечена» when they were the competency indicators copy-pasted verbatim. Her rule: a ЗУВ formulation must convey the indicator's MEANING through the discipline's own content — identical wording is a defect, not a pass. `services/outcomeFormulation.ts` now flags these deterministically (no LLM — a copy is a measurable string question; token containment + a crude Russian stemmer so a re-inflected copy can't slip past), as its own findings list rather than a coverage-status demotion (delivery and wording are independent questions — see that file's header). The verdict line now refuses to report coverage without the formulation result, so a РПД whose content delivers copy-pasted ЗУВ items no longer reads as «полностью обеспечивает».

**Feed bug fixed (2026-08-24) — the check had never fired on a real РПД.** Follow-up testing with the методист: same item still «Обеспечена 90%», no warning. `reviewSyllabus` fed the detector only `competencies.flatMap(c => c.indicators)`, but a real КНИТУ РПД lists competencies flat at the indicator level (ОПК-4.1/ОПК-4.3, no parent «ОПК-4» row), which parses as top-level competencies with empty indicator arrays → empty list → early return. Now compares against competencies AND indicators; source named by code shape (dotted = индикатор) rather than parse position. Regression test at the `reviewSyllabus` level (verified red-before/green-after) — the detector's own suite was green throughout, which is exactly why it was misleading.

**Open (her same message): a formulation MEANING check.** «нужна еще проверка смысла, формулировки … и есть ли смысловая связь с дисциплиной» — the copy detector only answers "is this a literal copy"; a reworded-but-generic ЗУВ still passes. Needs its own LLM pass (genuine judgement, unlike the deterministic copy question). Decided: stays a **separate fact** from the coverage status (delivery and wording are independent — folding them makes covered/partial/missing mean two things at once), but must render **on the item card**, not only as a block at the top of the report. Also open: copied ЗУВ items are counted as their own requirements, inflating the covered/partial/missing totals — two identical texts resolving to identical citations is a cheap deterministic duplicate signal.

**Both shipped (2026-08-24).** `services/outcomeMeaning.ts` — LLM pass (deliberately, unlike the deterministic copy check), verdicts `not_reflected`/`weak_link`, judged against §5–§8.1 content, scoped to lines the copy check didn't already flag (model not called at all when every line is a copy). Throws rather than returning `[]` on provider failure, with `reviewSyllabus` recording a `warnings` entry — an empty result must keep meaning "checked, nothing wrong". Duplicate inflation surfaced via `duplicate_count` in the verdict and stat strip rather than silently subtracted, so the counts still reconcile with the visible cards. Client timeouts 120s → 180s (three sequential LLM passes now, not two).

**ФОС баллы ↔ п.9 shipped (2026-08-25, same методист).** «баллы должны брать из п.9 РП» — the КНИТУ «Макет ФОС 3++» prints that rule under its own table. `brs_items` extended to `BrsScoreRow {name, semester, min_points, max_points}` (min was being discarded, which made the check impossible); new `parseFosScoreTable` + deterministic `checkFosScores`. Three rules: per-instrument min/max equality, no instrument on one side only, each semester totalling 60/100. Per-semester throughout — a multi-semester РПД repeats instruments with different points and summing across them would flag every correct document. Found in passing: JS `\b` is ASCII-only so the «Итого» row guard silently never matched Cyrillic.

**(a) structural check SHIPPED (2026-08-25)** — `services/fosStructure.ts`, deterministic, eight required blocks + per-instrument «Критерии оценки» driven by §9; макет checked in as its own test fixture (it must pass its own check). Found two ASCII-regex bugs (`\w`/`\b` don't match Cyrillic) and a circular import, all fixed. **Still open on ФОС conformance:** **(b) criteria sums SHIPPED (2026-08-25)** — extraction folded into the same ФОС pass (`parseFosScoreTable` → `parseFosNumbers`), two rules: components sum to the block's declared total, and that total matches the перечень row. Model separates total from components because the макет's prose form interleaves them and regex-summing would double-count. No-guess cases (un-itemised block, no declared total, per-semester instrument) each tested. **(c) generator SHIPPED (2026-08-25)** — `fosMacketReference.ts` (шкала оценивания + 28-row catalogue ingested as reference data; point breakdowns deliberately excluded as illustrations) and `fosMacketSections.ts` build the макет blocks, with §9 parsed via the same `parseAssessmentLinkage` the checker uses so both sides read one source. Criteria wording from the model, points distributed in code (`distributePoints`) so sums are exact. Proven by rendering the DOCX, reading it back, and running the real checks on it — verified non-vacuous by breaking both the export and the distribution. **(d) §9 readiness SHIPPED (2026-08-25)** — `services/brsReadiness.ts`, deterministic; blocks on missing/inverted points and a semester not totalling 60/100, warns on instruments the макет catalogue doesn't describe. РПД студия had no §9 section at all, so it now drafts one with `allocateBrsPoints` making the totals exact by construction. Caught a false positive that would have hit nearly every РПД (экзамен is deliberately absent from the макет catalogue); `FINAL_ATTESTATION` and `BRS_SEMESTER_MIN/MAX` moved to `config/brs.ts` as shared institution policy. **The chain is now closed end to end: студия → §9 → ФОС → проверка.** Remaining ideas, none urgent: institution-scoping the БРС bounds and the макет itself (both КНИТУ-specific today), and a ФОС structural check for content rather than presence (e.g. whether шкала оценивания's thresholds are right). Caution for (a)/(c): most point breakdowns in the макет are «например» examples, not norms — each кафедра sets its own per положение о БРС. The макет is КНИТУ-specific (титульный лист names the university), so it is institution-scoped reference data, not platform-wide.

**ПК ↔ профстандарт/ОТФ traceability + copy-check shipped (2026-08-20, same review, item 3 — LAST of her three items, K now fully addressed for reported feedback).** Same defect one level up: ПК competencies/indicators must be derived from a specific ОТФ in a specific профстандарт at the matching qualification level, and the wording must not copy the ОТФ verbatim. New `profstandards`/`profstandard_otf` registry (migration 115, mirrors the ФГОС registry — admin-curated, draft→published, LLM extraction via `services/profstandardExtractor.ts`, `/admin/profstandards`), `program_competencies.profstandard_otf_id` + new `program_competency_indicators` table, Конструктор's ПК rows get a профстандарт→ОТФ cascading picker with a level-mismatch warning (reuses `fgosMatch.ts`'s `inferFgosLevel`, no new parsing), and `services/pkFormulation.ts` (deterministic, reuses `ruText.ts`'s now-promoted `tokenContainment`) wired into `programAnalysis.ts`'s «Проверка ОП» and inline into the competency-save response.

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
  how, and by whom — HR or us)? Feature V (shipped, see CHANGELOG) answered
  the access-model question this used to point at: no new "methodologist
  role" was needed, the existing `curriculum` domain grant (§7.10) already
  gives УМЦ the horizontal, cross-faculty read access this needs too — HR
  can reuse the same `requireDomain('curriculum', 'view')` gate rather than
  inventing a distinct role.
- **Touches (provisional, will change with design):** new survey-import
  endpoint + table, new aggregation layer alongside `services/umcDashboard.ts`'s
  (per-teacher/course quality rollup — same pattern, different source rows),
  new `services/facultyProfile.ts`, new HR-facing pages, likely a Research.md
  design section before any of this is final.
- **Sequencing:** after V (shipped) — reuses its aggregation-layer pattern,
  and its lower-risk shape was the better first proof point for this kind of
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
  no new data sources, only shipped tables. v2 can follow V's (shipped)
  aggregation-layer precedent. v3 after real LTI/АСУ adoption at a pilot
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
  adapter interface), УМЦ review queue page (natural extension of the
  shipped `pages/institution/UmcDashboard.tsx` surface, Feature V), export
  endpoint. (v2: `services/asuSync.ts` write path per #12's touches.)
- **Gating:** Institution tier — this is an УМЦ/institution workflow
  end-to-end; no per-teacher plan story.
- **Sequencing:** v0 now (awaiting greenlight). v1 after the field-model
  spec exists (ask 2 is a hard prerequisite — don't guess the template);
  V's УМЦ dashboard already exists to extend rather than build. #12's
  auto-fetch rides the same v0 outcome and should ship under whatever
  access mechanism this negotiates.

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

### AG. Presentation generation depth + images · Effort: Phase 0 S, 🟢 SHIPPED (2026-07-29) · Phase 1 M–L, 🟢 SHIPPED (2026-07-29) · Phase 2 M, 🟢 SHIPPED (2026-07-29) · Phase 3 M, 🟢 SHIPPED (2026-07-29)

Teacher feedback (2026-07-29): decks generated without a pasted conspectus
are shallow — speaker notes too short to actually talk from (feedback
estimated ≥1min30s of speaking material per slide) — and engineering
lectures get little to no imagery. Root causes, not a prompt-wording
problem: `presentationMaxTokens()` (`services/presentations.ts`) budgets the
*entire deck* in one `chatJSON` call (~220 tokens/slide including JSON
overhead — nowhere near 1min30s of Russian speech per slide); without
`source_text`, the model gets only the topic string + 500 words of
`syllabus_text` + up to 6 RAG chunks truncated to 280 chars (a display
constant leaking into the prompt) as source material; and `image` is
hardcoded `null` at generation — only `diagram`-type slides can carry one at
all, filled in later only if the teacher manually opens the picker per
slide.

- **Phase 0 (shipped, this entry) — survive concurrent load before adding
  depth.** Moved generation off the request thread onto pg-boss
  (`presentation_jobs` + `presentationJobWorker.ts`, migration 102) and
  added a platform-wide daily spend circuit breaker (`globalSpendCap.ts`) —
  necessary *before* Phase 1, since outline+expansion multiplies LLM calls
  per deck ~5x, and nothing today bounds concurrent generations or
  aggregate spend across many teachers each under their own monthly cap.
  See CHANGELOG for full detail.
- **Phase 1 (shipped, 2026-07-29) — outline + parallel expansion, real
  depth.** Split generation into a cheap outline call (`buildOutlinePrompt`
  — type/title/one-line brief per slide, no RAG) + parallel expansion calls
  (`buildExpansionPrompt`, `EXPANSION_BATCH_SIZE=5` slides/call,
  `EXPANSION_CONCURRENCY=3`), each with its own full token budget
  (`expansionBatchMaxTokens`: ~700 tokens/slide standard, ~1000 deep —
  replaces the removed `presentationMaxTokens`). Notes rewritten as a
  structured speaking script (why-it-matters → explanation → concrete
  example → misconception → transition) with a word target behind a new
  `depth: 'standard' | 'deep'` selector (`shared/types.ts`'s
  `PresentationDepth`) gated via `canUseFeature('presentationDeepMode')` —
  `deep` is Pro+, `standard` (180–220 words/slide) is the baseline for every
  tier. RAG now retrieves per expansion batch (query = that batch's slide
  titles/briefs) instead of once for the whole topic, feeds the prompt full
  untruncated chunk text (280-char truncation now only applies to the
  persisted popover excerpt), and a new `SourcePool` dedupes chunks reused
  across batches so `[N]` citations stay consistent. `slide_count_target`'s
  validated ceiling raised 30 → 50 now that batching removed the single-call
  8192-token wall. See CHANGELOG for full detail; not done yet: images (Phase
  2) and an eval harness to validate depth quality, not just length (Phase 3).
- **Phase 2 (shipped, 2026-07-29) — images as a first-class part of
  generation.** Added optional `image_query`/`image` to `SlideBase`
  (`shared/types.ts`) so any slide type can carry a visual — `DiagramSlide`
  deliberately kept its own `body.image_query`/`body.image` rather than
  migrating (avoids orphaning every already-persisted diagram slide's
  image). New `autoFillImages()` in `services/presentations.ts` auto-calls
  `yandexImageSearch` in parallel (bounded concurrency) for every slide with
  a query, including diagram (previously always left `null`), right after
  expansion completes. `image_query` phrasing pushed toward object + viewer
  word (`разрез`, `схема`, `чертёж`) in the expansion prompt. Cheap ranking
  shipped in `yandexImages.ts`'s `rankImageCandidates()` (drops <500px when
  known, sinks known stock-photo hosts rather than dropping them). Verified
  live: a real generated deck's diagram slide got a real auto-picked
  schematic. **Deferred, not done**: the "remaining candidates cached for a
  one-click swap" idea — dropped as unnecessary since the picker already
  re-searches live on demand; a code-enforced minimum image-share quota per
  deck (currently instruction-only, no repair pass); a UI entry point to add
  an image to a slide the model didn't suggest one for (backend route
  already supports the override, frontend just doesn't surface it yet);
  generated Mermaid/SVG schematics for process/flow slides where search
  reliably returns junk; and PPTX export still only embeds diagram images
  (the other 5 layouts have bespoke fixed-position math that needs a real
  layout decision per type, not just wiring through).
- **Phase 3a (shipped, 2026-07-29) — web-search grounding when RAG is thin.**
  `shouldUseWebGrounding()` pure decision function: grounds when there's no
  `source_text` AND (no `courseId` OR the course has zero RAG chunks —
  checked via new `hasAnyChunksForCourse()`). `fetchWebGrounding()` calls
  `webSearch` (already built in `services/yandexSearch.ts`, previously unused
  here), picks the top `WEB_GROUNDING_RESULTS=5` results, feeds them into
  both the outline and expansion prompts as `renderWebGroundingBlock()` so the
  model can cite them. Falls back gracefully (search failure → no grounding,
  not an error).
- **Phase 3b (shipped, 2026-07-29) — eval harness.**
  `services/presentationEvalHarness.ts` + `scripts/evalPresentations.ts` (new
  CLI: `npm run eval:presentations`). Scores on `avgNotesWordCount`,
  `minNotesWordCount`, `notesBelowTargetShare` (the key Phase 1 regression
  guard), `bulletsShare`, `imageCoverageAmongEligible`, `citedSlideShare`.
  Title excluded from notes-word stats; title + summary excluded from image
  eligibility. 13 unit tests in `presentationEvalHarness.test.ts`. 8 default
  engineering/humanities topics in the CLI.
- **Gap 1 (shipped, 2026-07-29) — "Add image" entry point for slides the
  model didn't suggest a query for.** `SlideContent.tsx` now shows a
  `+ Добавить изображение` link below any non-title/summary slide that has
  neither an auto-generated query nor a manually-picked image, so teachers
  can add a visual to any slide at any time. The backend route already
  accepted the override; the frontend just wasn't surfacing it.
- **Gap 2 (shipped, 2026-07-29) — PPTX export embeds non-diagram images.**
  `services/presentationExport.ts`'s five non-diagram slide renderers
  (bullets, concept, formula, comparison, discussion) now support side-image
  layout: `contentRegion(hasImage)` narrows the text region to `7"` when a
  `3"` right-column image is present; `addSideImage()` fetches and embeds the
  image via `fetchImageAsDataUri`, drawing a dashed placeholder on fetch
  failure. Title and summary slides are unchanged (no image field).
- **Why:** direct response to negative teacher feedback on a shipped,
  GA feature (FEATURES.md) — not a speculative improvement.
- **Touches:** `services/presentations.ts`, `services/presentationJobWorker.ts`,
  `services/yandexImages.ts`, `validation/presentationValidation.ts`,
  `shared/types.ts` (`Slide`/`SlideBase`), `PresentationForm.tsx`.

### AL. Capacity + unit-economics dashboard — headroom, margin, and provider ceilings · Effort: Phase 0 M, 🟢 SHIPPED (2026-07-30) · Phase 1 M, 🟢 SHIPPED (2026-07-30) · Phase 2 M, 🟢 SHIPPED (2026-07-30) · Phase 3 S–M, 🟢 SHIPPED (2026-07-30) · Phase 4 S, 🟢 SHIPPED (2026-07-30) · 🏁 ALL PHASES SHIPPED

Designed 2026-07-29, out of the Feature AG scaling conversation ("will the
system hold at 1000 concurrent presentations?"). Two questions the platform
currently cannot answer from its own data: **when do we need to spend money on
infrastructure**, and **does a teacher/institution cost more than they pay**.

**Framing.** [docs/scaling.md](docs/scaling.md) is already the model — a
hand-maintained table of bottlenecks each with a "Trigger" line (`assignments`
embeddings > 50k, Postgres RAM > 70%, daily DeepSeek cost > $5). Every one is a
threshold a human has to remember to go check. This feature turns that doc into
a live instrument. Evidence the static form doesn't hold: scaling.md still
lists "Grading is synchronous (60s)" as an open Tier 2 item, but `grade_jobs` +
`services/gradeJobWorker.ts` shipped and grading is async — **the doc has
already silently drifted from reality.**

**Not prediction — headroom.** With a young product, extrapolating *when* is
noise. What's arithmetic is: (1) derive per-active-teacher coefficients from
`api_usage_log` + row counts; (2) encode the ceilings scaling.md documents
(4 GB RAM, 20 GB disk, pool `max=25` × 2 PM2 workers, pgvector `lists=100`
≈10k rows, 2 vCPU); (3) divide. Output is an **ordered list of what breaks
first, in users-until-breach** ("Postgres connections bind at ~340 active
teachers; disk at ~1,200; RAM fine to 5,000") — not a resource-over-time
chart. The human supplies the growth assumption via a scenario input; the page
supplies headroom. Deterministic, every number traceable to
`coefficient × N vs. ceiling` — a forecast the operator can't check by hand
won't be trusted enough to justify spending.

**Audience is the founder AND outside parties (incl. potential investors)** —
confirmed 2026-07-29. Same data layer, two framings: an **operator view**
(prescriptive, dense, mostly empty when nothing needs doing) and an
**investor view** (the derivative — is cost/teacher falling?). Two
consequences: the trend framing forces a retained-history rollup (below), and
named teacher data must not be the default rendering (152-ФЗ; teachers are
natural persons and `getUsageByTeacher` currently returns names + emails
beside cost). Pseudonymise by default ("Преподаватель #7"), names behind an
explicit toggle; a presentation mode that aggregates institutions is cheap
insurance while КНИТУ is a live pilot partner.

**The framing that is both honest and favourable:** split **fixed** infra
(VM — flat regardless of user count) from **variable** AI cost per active
teacher. Today the fixed cost dominates and blended margin looks bad; at 1,000
teachers it's noise. A single blended margin number actively understates the
business right now, and the split is the same fact as headroom restated as
capital efficiency ("we can absorb 5× users on the current VM").

- **Phase 0 — make the ledger true. 🟢 SHIPPED (2026-07-30, see CHANGELOG).**
  Nothing downstream is correct without this, so it wasn't really phase-able
  — all five pieces landed together.
  - **Yandex cost blind spot.** Every Yandex-billed call (chat/embed/vision/
    images/search) now writes a real, correctly-priced usage row instead of
    `costUsd:0` or nothing — was the prerequisite this whole phase depended
    on. `cost_native` / `currency` / `fx_rate_used` landed on
    `api_usage_log`, `cost_usd` stays the canonical converted figure, and
    the FX piece below shipped with it.
  - **FX**: rate from **ЦБ РФ** (canonical Russian accounting source, free
    public endpoint), cached daily, `AbortController` + 8s, fail-open to
    last known rate — an FX lookup must never break a grading call. Display
    ₽ **with the rate and its date shown**, never silently picked.
  - **`variant` column** (migration 104) — presentation depth
    (`'standard' | 'deep'`) now flows through `CallContext.variant` into
    every usage row for a generation (outline + expansion calls, plus
    auto-image/web-grounding calls, which now correctly carry the same
    context object instead of a separately-built literal that had been
    missing `institutionId`). Deliberately NOT a new `feature` enum value —
    `getDailyUsage` filters `feature = 'presentation'` and a
    `'presentation_deep'` value would silently halve every existing
    aggregate.
  - **`account` column** (migration 104) — every `createUsageLog` call in
    `deepseek.ts` now tags `account: account.label`, so a 402/429 burst is
    attributable to a specific account, not just visible in aggregate.
  - **Fixed `activeThisWeek`** — `routes/admin.ts`'s `/overview` was
    computing `COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7
    days')` **on the `teachers` table**, i.e. *signups*, not active users
    (`new_this_month` was the same metric on a wider window — that was the
    tell). Now `COALESCE(last_seen_at, created_at)` — `last_seen_at` has
    existed since migration 073, touched on every authenticated request.
  - **`institution_contracts`** (migration 105) — `institution_id`,
    `annual_value_rub`, `seats_purchased`, `term_start`, `term_end`,
    `notes`, `created_by`, one row per contract term. Institution revenue
    did not exist anywhere in the DB before this: `payments` is
    `teacher_id NOT NULL` with plans `'pro_monthly'|'pro_annual'` only, and
    `institutions` has just `name`/`plan_tier`/`max_teachers` (a licensing
    cap, not a price). Deals are negotiated offline via 44-ФЗ procurement,
    so a manual record is the correct model, not an integration — **the
    only new data-entry surface in this whole feature**. Full CRUD
    (`db/queries/institutionContracts.ts` + routes on `routes/admin.ts`) and
    a platform-admin UI panel on `AdminInstitutions.tsx` (expandable row,
    same pattern as the existing SAML config panel) — add/list/delete, an
    "действует" badge on the contract whose term covers today. Verified
    live end-to-end against a real dev DB: create → shows in the list with
    the active badge → delete removes it.
  - 2 new unit tests (`deepseek.test.ts`: account label + variant
    passthrough), 12 new integration tests
    (`institutionContracts.integration.test.ts`, against a real Postgres DB
    — CRUD, current-term lookup, cascade delete, CHECK constraints). Caught
    two bugs during implementation: `annual_value_rub` is parsed to a real
    `number` by `connection.ts`'s existing global NUMERIC type-parser, not
    left as a string as first assumed; and DATE columns come back from `pg`
    as a JS `Date` at UTC midnight, one `.toLocaleDateString()` away from a
    timezone display bug — fixed by casting `term_start`/`term_end` to
    `'YYYY-MM-DD'` text in every query rather than trusting the driver's
    default. Also fixed a real layout bug the new table column exposed:
    `AdminInstitutions.tsx`'s table wrapper was `overflow-hidden`, not
    `overflow-x-auto` — the table was already wider than its container
    before this change and the overflow columns were silently unreachable,
    not just visually cut off.
- **Phase 1 — unit economics. 🟢 SHIPPED (2026-07-30, see CHANGELOG).**
  Backend + CLI only, by design — Phase 2 is where this becomes a page.
  - **`usage_rollup_monthly`** (migration 106, one row per teacher-month):
    effective tier, institution snapshot, calls, tokens, cost, amortized
    personal-payment revenue, **frozen FX rate + rate date**. Teacher-month
    grain, not one pre-aggregated row per (month, tier) — p50/p95/max can
    only be computed from per-teacher figures, and a year of these rows
    (thousands, not hundreds of thousands) is cheap to scan without losing
    that granularity. Freezing the FX rate is load-bearing — re-deriving ₽
    at render time would make historical margin rewrite itself daily.
  - **`institution_rollup_monthly`** (migration 107, one row per
    institution-month): active seats, seats purchased (from
    `institution_contracts`), overhead cost, amortized institution revenue,
    frozen FX rate. Companion table, not a duplicate — institution margin
    needs overhead cost + contract revenue, neither of which belongs on a
    per-teacher row.
  - **`services/usageRollup.ts`** — the ETL. Uses `lib/planTier.ts`'s
    `computeEffectiveTier` (not raw `teachers.plan_tier`, which
    misclassifies institution members and lapsed Pro). `amortizedRevenueForMonthRub()`
    spreads `pro_annual` payments across 12 months from `confirmed_at`
    (`pro_monthly` stays a one-month unit, no spreading) — pure and unit
    tested against the exact "fake January spike" scenario the design
    doc named. `OVERHEAD_FEATURES = ['rpd_reminder']` routes that one
    feature's cost to institution overhead instead of the triggering
    teacher; **cohort synthesis and institution-pool RAG retrieval are
    NOT yet separably tagged by `feature`** (`cohortSynthesis.ts` logs as
    `'grading'`) and still land on the triggering teacher's row — a
    documented gap, not a silent one, left for whoever retrofits that
    instrumentation.
  - **Excludes platform admins** (`teachers.is_platform_admin = TRUE`) from
    every aggregate — the only DB-level signal available; ad-hoc test
    teacher accounts that aren't flagged platform-admin can't be
    automatically excluded (no such flag exists) and are a residual gap
    for backfilled months containing heavy founder testing.
  - **Two CLI scripts, no page** (`npm run rollup:backfill` /
    `npm run rollup:report`), matching this codebase's script-first
    pattern (`evalPresentations.ts`). `unitEconomics.ts` prints cost
    distribution per effective tier (n/mean/p50/p95/max — the free-tier
    p95 outlier count is what actually matters for freemium margin, not
    the mean) and per-institution seats/cost/revenue/margin/cost-per-seat.
    Labels "tracking since &lt;month&gt;" and warns explicitly when fewer
    than 3 months are rolled up, per the "a 2-point line is worse than no
    line" design note.
  - 10 unit tests (pure amortization/percentile/overhead-classification
    logic) + 9 integration tests against a real Postgres DB (idempotent
    upsert, platform-admin exclusion, overhead routing, effective-tier
    snapshot, seat utilization, missing-contract null-handling). Verified
    live end-to-end against the real dev DB: backfilled 2 real months,
    report printed a correct institution margin computed from the real
    test contract created during Phase 0's live verification.
  - **Caught two more `pg` driver default-type gotchas** (same class as
    Phase 0's NUMERIC/DATE surprises): `BIGINT` columns (`total_tokens`)
    come back as a JS string, not a number, unless explicitly cast —
    caught immediately by a unit test asserting `.toBe(2500)` against a
    string. Also fixed both CLI scripts hanging past their process's
    natural exit — an open `pg.Pool` keeps the Node event loop alive, so
    every CLI here now calls `process.exit(0)` explicitly on its success
    path, matching `evalPresentations.ts`'s existing convention.
  - **`startUsageRollupScheduler()`** (`services/usageRollup.ts`, wired
    into `index.ts`) — the rollup is a snapshot, not a live query
    (`getCapacityOverview` reads `usage_rollup_monthly`/
    `institution_rollup_monthly` directly), so without a scheduler it only
    ever advances when someone remembers to re-run `rollup:backfill`. Every
    6h, recomputes current + previous UTC month (upsert, so re-running is
    free; previous month catches usage that landed just before a calendar
    boundary). PM2-worker-0-gated, same precedent as
    `renewals.ts`/`resourceSampler.ts`; a failed run logs and retries next
    tick rather than crashing the process. `rollup:backfill` remains the
    tool for cold-starting a new environment (e.g. first deploy to the VM)
    or backfilling further back than 2 months — the scheduler only keeps
    already-backfilled data current.
- **Phase 2 — the `AdminCapacity` page. 🟢 SHIPPED (2026-07-30, see
  CHANGELOG).** Operator framing by default (real institution names,
  dense), investor framing as a second mode (pseudonymised institutions —
  "Организация #N" — by default, revealed via an explicit checkbox), a
  scenario input ("сценарий: активных преподавателей") that live-recomputes
  every projection. Reuses `AdminLayout` exactly — no new design language,
  same table/card conventions as `AdminUsage`/`AdminInstitutions`.
  - **`services/capacityModel.ts`** — the headroom engine, deliberately
    scoped to what's honestly computable today without Phase 3/4's
    infrastructure: `pg_database_size`, `pg_stat_activity` connection
    count, and embedded-`assignments` row count (the pgvector reindex
    trigger — 50,000 rows, scaling.md's own number, not the imprecise
    "≈10k" this doc originally paraphrased it as). `computeBreaksAtTeachers()`
    projects each linearly (coefficient × scenario vs. ceiling) — explicitly
    a MEAN-based estimate, not a peak one, and the DB-connections row says
    so in its own UI note; DB size carries no ceiling at all (disk % isn't
    queryable from inside Postgres — that's Phase 4's resource sampler) and
    renders as informational only, not a fake threshold.
  - **Unit economics finally has a UI** — Phase 1's `usage_rollup_monthly`/
    `institution_rollup_monthly` tables, rendered as the tier-distribution
    table (n/mean/p50/p95/max) and per-institution
    seats/utilization/cost/revenue/margin/cost-per-seat cards, both modes.
  - **Fixed/variable cost split** (investor mode) — variable cost/teacher
    computed live from the rollup; fixed infra cost reads a new
    `MONTHLY_INFRA_COST_USD` env var, honestly showing "—" with a
    "MONTHLY_INFRA_COST_USD не задан" note when unset rather than a guessed
    number, matching the Yandex-pricing-placeholder precedent from
    Improvement #13.
  - 13 unit tests (`capacityModel.test.ts` — pure distribution/outlier/
    headroom-projection math) + 4 integration tests
    (`capacityModel.integration.test.ts`, against a real Postgres DB).
    Verified live end-to-end in the browser against the real dev database:
    both modes render correct numbers matching the Phase 1 CLI report
    exactly, the pseudonymisation toggle correctly swaps the real
    institution name for "Организация #1" and back, and the scenario input
    live-recomputes every projected value (verified at N=500: pgvector
    23→11,500 rows, connections 6→3,000 — correctly shown blowing past the
    50-connection ceiling, the honest signal a real capacity page should
    give).
- **Phase 3 — capacity report + provider ceilings. 🟢 SHIPPED (2026-07-30,
  see CHANGELOG).**
  - **Peak-to-mean ratio** — `services/providerCeilings.ts`'s
    `getHourlyVolume`/`computePeakToMeanRatio`: total calls and the single
    busiest hour's volume over a trailing window (default 30 days), mean
    computed across the WHOLE window including silent overnight hours (not
    just hours with activity, which would understate the ratio). Feeds
    straight into `capacityModel.ts`'s `db_connections` headroom row as a
    new `breaksAtTeachersPeakAdjusted` field — `AdminCapacity` now shows
    both the naive mean-based estimate and the peak-corrected one side by
    side, fulfilling the note Phase 2 left as "Phase 3 will refine." Only
    applied to `db_connections` — `pgvector`/`db_size` are cumulative
    totals, not concurrency-bound, so a peak correction doesn't apply to
    them.
  - **Rate limit (429) — derived empirically, not guessed.**
    `computeRateLimitKnee()` brackets the ceiling from real data: the
    smallest hourly DeepSeek call volume that actually tripped a 429 (upper
    bracket) and the largest hourly volume that stayed clean (lower
    bracket). When production has never been rate-limited in the window —
    true for this platform's traffic today — reports `observed: false`
    explicitly rather than fabricating a number; TODO.md's own framing
    ("if production has never rate-limited there's no knee to find yet")
    is rendered verbatim as the page's empty state, not silently dropped.
  - **Balance (402) + pool depth** — `getAccountCeilings()`, keyed off the
    `account` column Phase 0 added: burn rate per account ($/day, from
    real `cost_usd`), 402 count, any-failure count, last success/failure
    timestamps. **Real per-account balance isn't tracked anywhere in
    ИСПУМ** (only DeepSeek's own dashboard has it), so this reports burn
    rate as a top-up-cadence *input*, not a "days until broke" prediction —
    honest about what we don't know. Pool depth is similarly a **historical
    proxy, not live state**: `deepseek.ts`'s `downUntil` cooldown map is
    in-memory and per-PM2-worker (confirmed not centrally queryable — the
    architectural fact TODO.md flagged going in), so `possiblyUnhealthy`
    is "last event was a failure with no success since," not "currently
    cooling down." The page says this explicitly next to the status column
    rather than implying it reads live worker state.
  - **Yandex embed SPOF** — recorded as a static risk note on the page
    (`yandexEmbedSpofNote`), not a metric: invariant #9 forces all
    embeddings through Yandex and `llm/yandex.ts` has no multi-account pool
    (DeepSeek got one after a real 402 incident; Yandex has the same
    exposure and no mitigation, and can't fail over to another provider by
    architectural design). Nothing to compute here — worth recording as a
    risk, not something Phase 3 can fix on its own.
  - New `db/queries/providerCeilings.ts` (3 queries, all reading
    `api_usage_log`'s existing columns — no new tables) +
    `services/providerCeilings.ts` (pure functions + orchestrator). Wired
    into the existing `GET /api/admin/capacity/overview` response
    (`providerCeilings` field) rather than a second endpoint, and rendered
    as a new "Провайдеры и пиковая нагрузка" section on `AdminCapacity`,
    shared identically between operator and investor modes.
  - 11 unit tests (`providerCeilings.test.ts` — pure ratio/knee/ceiling
    math) + 7 integration tests (`providerCeilings.integration.test.ts`,
    against a real Postgres DB). Verified live against the real dev
    database: peak-to-mean computed a real 248.1× ratio (extreme, but
    mathematically correct — this platform's dev traffic is low-volume and
    concentrated in short testing bursts, exactly the kind of noise a
    young product's capacity numbers should honestly show rather than
    smooth over), the 429 knee correctly reported "not observed" with its
    bracket, and the accounts table correctly showed its own honest empty
    state (no `account`-tagged rows exist yet in this dev DB, since that
    column only started being populated after Phase 0 shipped).
- **Phase 4 — guardrail + in-process sampler. 🟢 SHIPPED (2026-07-30, see
  CHANGELOG).**
  - **Per-feature spend cap** (`services/featureSpendCap.ts`) — the third
    variant of a pattern that already existed twice (`spendCap.ts`
    per-teacher monthly, `globalSpendCap.ts` platform daily). Checked
    alongside both existing caps at the same choke point
    (`llm/registry.ts`'s `chat`/`chatJSON`) so no caller can forget it.
    **Variant-aware**: `FEATURE_SPEND_CAP_PRESENTATION_DEEP_USD` checks on
    top of (not instead of) `FEATURE_SPEND_CAP_PRESENTATION_USD` — a
    deep-specific ceiling can trip while standard-depth presentations keep
    working, the exact blast radius the motivating example asked for
    ("imagine deep mode becomes very popular; I wouldn't want the numbers
    to sink the whole business"). Both disabled (`Infinity`) by default,
    same posture as `globalSpendCap.ts` — zero effect until an operator
    sets a number. New `FeatureSpendCapExceededError` (503).
  - **`resource_samples`** (migration 108) — sampler on PM2 worker 0 (same
    gating precedent as `renewals.ts`), ~60s interval:
    `process.memoryUsage()` (RSS/heap — previously **zero** visibility into
    process memory anywhere in ИСПУМ), `os.loadavg()`, `os.freemem()`,
    `pg_database_size()`, `pg_stat_activity` count, and the row count
    gating the pgvector reindex (reuses `db/queries/capacity.ts`'s existing
    live-read functions, unchanged). Self-prunes to a 30-day retention
    window on every tick (a cheap indexed range delete — no separate
    cleanup job needed at ~43,200 rows/month). `getResourceSamplePeaks()`
    reports the PEAK over a window, not the mean — the whole point of
    sampling is catching the worst moment, not smoothing over it, unlike
    Phase 2's headroom model which had no choice but a single live
    snapshot before this existed. Deliberately backend-only in this pass —
    no `AdminCapacity` wiring yet, matching the same "ship the substrate,
    then the page" sequencing Phase 1→2 already used; the natural next
    step for whoever picks this up is showing peak-24h connections instead
    of Phase 2/3's live snapshot.
  - **Deliberately NOT integrating the Yandex Cloud Monitoring API.** It's
    blind to every constraint that actually binds us (DB pool exhaustion,
    pgvector row counts, per-worker rate-limit state, provider account
    health), and Yandex already shows CPU/RAM in its own console for free.
    The high-value metrics are the ones only visible from inside the app.
    Since Postgres shares the VM (scaling.md Tier 3), in-process RSS + DB size
    is a fair proxy for the whole box.
  - 6 unit tests (`featureSpendCap.test.ts` — pure parsing/env-key logic) +
    6 integration tests (`featureSpendCap.integration.test.ts`, including
    the variant-vs-feature-level independence case) + 5 integration tests
    (`resourceSampler.integration.test.ts` — real measurement, peak-not-mean
    aggregation, retention pruning). Verified live against the real dev
    server: the sampler auto-started on the running `tsx watch` process
    without a manual restart and had written 5 real samples within 5
    minutes, values consistent with Phase 2/3's own live readings taken
    earlier the same session (`embedded_assignments=23` matching exactly,
    `db_size≈29MB` matching the ~30MB read earlier).
- **Also deliberately not building:** ML/regression forecasting (linear
  coefficients + explicit seasonal multipliers only — an unexplainable
  forecast won't be trusted with money); a new alerting system (capacity
  thresholds should reuse the existing Telegram incident channel);
  real-time streaming (60s samples and monthly rollups are ample for a
  "should I buy a bigger VM" decision).
- **Why:** two unanswerable questions with real money attached. `GLOBAL_DAILY_SPEND_CAP_USD`
  is still unset because nobody knows what number is right — this is the
  instrument that says. AG Phase 1 multiplied presentation LLM calls ~5x and
  nothing is watching that land in the cost data. And the freemium tier's
  `monthlySpendCapUsd` in `config/planLimits.ts` is currently set by
  judgement, with no evidence of what a free user actually costs.
- **Touches:** migration (`api_usage_log` columns, `institution_contracts`,
  `usage_rollup_monthly`, `resource_samples`), `db/queries/usageLog.ts`,
  new `db/queries/usageRollup.ts` / `institutionContracts.ts`,
  new `services/fxRate.ts` / `capacityModel.ts` / `unitEconomics.ts`,
  new `scripts/capacityReport.ts`, `routes/admin.ts`,
  new `pages/admin/AdminCapacity.tsx`, `config/planLimits.ts`,
  `docs/scaling.md` (becomes the doc the page renders, not a parallel copy).

### AM. Кабинет методиста — one place for a методист to run every РПД/ОП check · Effort: Phase 0 M, 🟢 SHIPPED (2026-08-19) · Phase 1 M, 🟢 SHIPPED (2026-08-19) · Phase 2 M, 🟢 SHIPPED (2026-08-20) · Phase 3 M, 🟢 SHIPPED (2026-08-20) · 🏁 ALL PHASES SHIPPED

Prompted by user testing (2026-08-19) with a real методист: the role's grants
were correct, but every check they needed (РПД competency coverage, «Место
дисциплины», МТО, overlap) lives inside РПД-студия или РОП-студия, both keyed
off structures a методист doesn't own. To get anything done they had to jump
between the two studios and act like a teacher.

**Root cause, not just navigation.** `POST /programs/:id/disciplines/:disciplineId/studio-course`
([routes/programs.ts](backend/src/routes/programs.ts)) find-or-creates a
**personal предмет** owned by the caller, seeded from the uploaded РПД, so
that РПД-студия has something to work off. The draft then persists to
`syllabus_studio_drafts`, keyed by `(course_id, teacher_id)`
([db/queries/syllabusStudioDrafts.ts](backend/src/db/queries/syllabusStudioDrafts.ts)).
Same anchor problem reaches the teacher-side checks — `syllabus-review` and
`overlap` used to resolve their target text through
`resolveCourseText(courseId, teacherId)` → `findCourseById(courseId, teacherId)`
([routes/curriculum.ts](backend/src/routes/curriculum.ts)). A методист owns no
courses, so checking a whole ОП means accumulating one phantom personal course
per discipline — burning the plan's `maxCourses` cap mid-audit — and the work
is invisible to everyone else. Fixing this is what actually ends the
studio-jumping; a new page on top of the same anchor would just relocate it.

- **Why:** the platform already has every check a методист needs
  (`reviewDocumentCoverage`, `reviewPlacement`, `reviewMto`, `analyzeProgram`,
  `analyzeCurriculumOverlap`, `diffWorkingProgrammes`) — none of it is
  reachable without borrowing a teacher's course ownership. De-anchoring +
  giving the role one home is pure UX/access work, no new AI service.
- **Scope decision (2026-08-19):** УМУ-family-scoped.
  🟢 **МУМЦ gate resolved (2026-08-19):** gating on the `umu` domain outright
  excluded `Методист УМЦ` (МУМЦ) — Table A gives МУМЦ only `curriculum:edit`,
  no `umu` grant. Widening МУМЦ's bundle to `umu:view` was rejected: `umu`
  also gates Мониторинг РПД/Готовность УМК, verified "строго УМУ + РУМЦ" in
  [docs/ACCESS-MATRIX.md](docs/ACCESS-MATRIX.md) §4 — that would have
  silently widened those too. Shipped instead: a narrow `methodist_access`
  flag (`resolveGrantOnUnitTypes(scope, 'curriculum', 'view',
  METHODIST_UNIT_TYPES)`, `METHODIST_UNIT_TYPES = ['admin_office']` in
  `services/accessScope.ts`), same pattern as `criteria_access`/
  `org_overview_access`. Admits УМУ/РУМЦ/МУМЦ (all sit on `admin_office` or
  institution-root) while excluding ЗК/РОП/РПГ/ДИ/ДЕК (their `curriculum`
  grants sit on `department`/`program`/`cluster`/`division`) — matches how
  the кабинет's checks already gate access via `getProgramAccessScope`
  (`curriculum` domain), so `umu` was never the real dependency. Wired into
  `routes/auth.ts` (auth payload), `shared/types.ts`, and all three frontend
  gates that read it: `InstitutionLayout.tsx`'s NAV, `Sidebar.tsx`'s
  «Организация» link visibility, and `App.tsx`'s `InstitutionRoute` guard —
  the last one is load-bearing; missing it there would have redirected МУМЦ
  to `/dashboard` before ever reaching the NAV filter. 2 new tests in
  `accessScope.test.ts` (admits admin_office, rejects department).
- **Phase 0 — de-anchor (backend only, no UI change).** 🟡 slice 1 shipped
  (2026-08-19): `services/methodist/target.ts`'s `resolveProgramDisciplineText`
  resolves `{programId, disciplineId}` → `{text, declared competencies}` via
  `findWorkingProgrammeForDiscipline` + the programme's own competency codes,
  gated on `getProgramAccessScope`/`canReadProgram` (the same read check
  `/api/institution/programs` already uses — no new access primitive). Wired
  into `POST /api/curriculum/syllabus-review` as a third target alongside
  `course_id` and raw `syllabus_text`, so the richer §5–§8 evidence-citation
  report (the one `CurriculumConformance.tsx` runs, distinct from the
  programme-level `/review` competency-coverage check Feature K already
  shipped) is reachable without a personal course. No UI yet — Phase 1 wires
  a picker to it.
  🟡 slice 2 shipped (2026-08-19): `resolveProgramDisciplinesText` (batch
  variant — one programme fetch + access check, then per-discipline text,
  skipping missing/undocumented disciplines instead of failing the whole
  request) wired into `POST /api/curriculum/overlap`. Required decoupling
  `services/curriculumAnalysis.ts`'s `analyzeCurriculumOverlap` from
  `courseIds`/`findCourseById` entirely — it now takes pre-resolved
  `{id, name, content}` items, and course-vs-programme resolution moved up
  into `routes/curriculum.ts`. 5 new tests in `curriculumAnalysis.test.ts`
  pin the decoupled contract (dedup, per-item skip, preSkipped passthrough).
  🟢 **Phase 0 SHIPPED (2026-08-19).** ФОС/БРС and `syllabus-draft`
  (authoring) are **out of scope, permanently, not deferred** — decided
  2026-08-19: a методист's role is checking/analysing what teachers and РОПы
  already authored against the standard, not generating or owning artifacts
  themselves ("they don't really create/generate anything unless they are
  also a teacher at the same time"). ФОС/БРС stay exactly where they are —
  teacher-owned, course-anchored, gated by the teacher's own plan tier —
  and `studio-course` stays in place, marked deprecated only insofar as the
  РОП path still uses it.
- **Phase 1 — Кабинет методиста shell + «Проверка РПД» tab.**
  🟢 slice 1 shipped (2026-08-19): `/institution/methodist`
  ([InstitutionMethodist.tsx](frontend/src/pages/institution/InstitutionMethodist.tsx)),
  one `NAV` entry
  ([pages/institution/InstitutionLayout.tsx](frontend/src/pages/institution/InstitutionLayout.tsx))
  gated on `methodist_access` (resolved above) — that's the entire auth
  surface. Programme → discipline picker (sourced from the same
  `GET /api/institution/programs` scope the РОП Студия already uses) →
  runs the §5–§8 evidence-citation check via `reviewProgramDisciplineSyllabus`.
  Extracted `SyllabusReviewReport` out of
  [CurriculumConformance.tsx](frontend/src/pages/CurriculumConformance.tsx)
  into
  [components/curriculum/SyllabusReviewReport.tsx](frontend/src/components/curriculum/SyllabusReviewReport.tsx) —
  both pages now render the identical report off one component, no
  duplication.
  🟢 slice 2 shipped (2026-08-19): the «Проверка дисциплины» tab now runs
  four checks side by side, each independently selectable —
  §5–§8 coverage, competency coverage (`reviewDiscipline`), «место в
  структуре» (`reviewDisciplinePlacement`), and МТО
  (`reviewDisciplineMto`); the last three never had the course-anchor
  problem (`routes/programs.ts`'s discipline routes were already
  programme-anchored), they just weren't reachable from one screen before.
  New «Пересечение содержания» tab: multi-select disciplines within a
  programme → `analyzeProgramOverlap`. Two renderer extractions made this
  possible without duplicating ~470 lines:
  [components/curriculum/CheckPanels.tsx](frontend/src/components/curriculum/CheckPanels.tsx)
  (placement/MTO/coverage panels, pulled out of
  [InstitutionProgramDetail.tsx](frontend/src/pages/institution/InstitutionProgramDetail.tsx) —
  2588 → 2305 lines) and
  [components/curriculum/OverlapReport.tsx](frontend/src/components/curriculum/OverlapReport.tsx)
  (pulled out of [Curriculum.tsx](frontend/src/pages/Curriculum.tsx) — 319 →
  171 lines); both original pages now import the shared components instead
  of owning a copy. Verified: both typechecks clean, 803 backend tests pass,
  `/institution/methodist` and `/curriculum` both load without a console
  error post-extraction. **Not done yet:** Phase 2's registry/pg-boss runs
  and Phase 3's cross-programme triage queue + ad-hoc upload target.
- **Phase 2 — check registry + pg-boss runs.** 🟢 SHIPPED (2026-08-20).
  [services/methodist/checks.ts](backend/src/services/methodist/checks.ts):
  a registry (`RUNNERS: Record<CheckKey, ...>`) where each of the 4 entries
  is a thin adapter onto an existing service — `reviewSyllabus`,
  `reviewDocumentCoverage`, `reviewPlacement` (incl. the same best-effort
  topology-graph densification the programme-page route performs — a run
  from here behaves identically to one from `/institution/programs/:id`,
  not a lesser version), `reviewMto`. Each persists to the SAME table the
  equivalent programme-page route already writes
  (`program_document_reviews`/`program_placement_reviews`/`program_mto_reviews` —
  no parallel result store; `syllabus` is the one exception, stored inline
  on the run row since it has no dedicated table anywhere in the codebase).
  `runCheck` converts any thrown error into a per-check `{status:'error'}`
  outcome instead of aborting the batch — a run missing one discipline's
  competency codes still returns the other 3 results — except
  `NotFoundError` (bad target), which aborts the whole run since every
  check shares one target.
  [routes/methodist.ts](backend/src/routes/methodist.ts): `POST /runs`
  (validates target+access via `loadReadableDiscipline` *before* enqueueing,
  so a bad id 403/404s immediately instead of queuing a run that's certain
  to fail), `GET /runs/:id` (poll), `GET /runs` (recent history). Runs go
  through [services/jobQueue.ts](backend/src/services/jobQueue.ts) (pg-boss,
  `services/methodist/runWorker.ts` — mirrors `fosWorker.ts`) — up to 4
  independent LLM calls in parallel, bounded by the slowest one, too slow to
  hold an HTTP request open for. New additive table `methodist_runs`
  (migration 114: target refs + status + `checks: CheckOutcome[]` — pointers
  into the existing tables, `result_id` per check, not duplicated content).
  Frontend: `InstitutionMethodist.tsx`'s «Проверка дисциплины» tab now
  enqueues one run instead of 4 parallel synchronous mutations, polls
  (`api/methodist.ts`, same poll-loop shape as `FosStudio.tsx`), then
  re-fetches each `ok` outcome's full result from its table by
  `result_id` (`getDisciplineReviews`/`getPlacementReviews`/`getMtoReviews`
  — already-existing endpoints, no new GET-by-id routes needed) and renders
  per-check error banners for any `status:'error'` outcome instead of
  silently dropping it. 5 new backend tests (`checks.test.ts`) pin the
  per-check error-isolation contract. Verified: backend typecheck clean, 807
  tests pass, frontend typecheck clean, `/institution/methodist` loads
  without a console error.
  🟢 **UX fix, same day (caught in review):** neither picker showed which
  disciplines had a working programme document attached — a методист could
  select disciplines with no РПД at all and get either a doomed request
  (overlap: fewer than 2 with content → throws before producing anything,
  only a transient global toast) or a run that returns nothing useful. Both
  pickers now show a `disciplinesWithRpd` badge/warning per discipline
  (derived from `program.documents`, already returned by `GET
  /institution/programs/:id` — no new endpoint), `run()` in both tabs
  pre-empts a doomed request client-side with a clear message, and the
  overlap tab's error now renders as a banner that stays on screen instead
  of relying solely on the transient toast.
- **Phase 3 — Очередь tab (cross-programme triage), «Проверка ОП»** (programme
  analysis + overlap + per-discipline coverage roll-up), ad-hoc file-upload
  target, exports via the existing `services/programReportPdf.ts` /
  `services/rpdReportXlsx.ts`.
  🟢 **Очередь tab shipped (2026-08-20).** Now the default landing tab.
  Reuses `services/umcDashboard.ts`'s aggregation (Feature V) wholesale — new
  `GET /api/methodist/queue` route
  ([routes/methodist.ts](backend/src/routes/methodist.ts)) calls the exact
  same `getUmcDashboard()` the Готовность УМК page calls, just gated
  differently: `requireDomainOnUnitTypes('curriculum', 'view',
  METHODIST_UNIT_TYPES)` instead of `requireDomain('umu', 'view')`.
  **Deliberately not a widened gate on the existing `/institution/umc-dashboard`
  route** — docs/ACCESS-MATRIX.md documents "Готовность УМК строго УМУ + РУМЦ"
  as a real, incident-driven exclusion (a plain РОП reaching institution-wide
  stats was the original bug); this is a separate screen for a different
  audience (adds МУМЦ) reading the same underlying signals, not a change to
  that invariant. Frontend: new `QueueTab` in
  `InstitutionMethodist.tsx` filters the full readiness matrix down to only
  "needs attention" rows (`queueUrgency`: no РПД → not yet reviewed →
  reviewed with <50% coverage, in that priority order) instead of
  reproducing Готовность УМК's exhaustive matrix — triage, not a duplicate
  dashboard. Clicking a row jumps straight into «Проверка дисциплины» with
  that programme+discipline preselected (`disciplineId` state lifted from
  `DisciplineChecksTab` to the page root to make the cross-tab jump
  possible). 5 new frontend unit tests (`InstitutionMethodist.test.ts`) pin
  `queueUrgency`'s classification, including the null-coverage-counts-as-low
  edge case. Verified: both typechecks clean, 807 backend + 46 frontend
  tests pass, page loads without a console error (after clearing a stale
  Vite dep cache unrelated to this change — a dev-server artifact from
  repeated restarts this session, confirmed by the same crash occurring on
  the unrelated `/` route before the cache clear).
  🟢 **«Проверка ОП» shipped (2026-08-20).** New tab reuses
  `services/programAnalysis.ts` wholesale via the exact same
  `analyzeProgram`/`getAnalysis`/`downloadAnalysisPdf` endpoints the
  programme detail page's Report tab already calls — nothing new
  server-side, satisfying the Phase 3 "exports via the existing
  `services/programReportPdf.ts`" clause for free. Cached analysis loads on
  tab open (`getAnalysis`); a button re-runs it (`analyzeProgram`, ~2–3 min,
  synchronous like `analyzeProgramOverlap` — not pg-boss, matching how the
  programme page already runs it).
  New [components/curriculum/ProgramAnalysisSummary.tsx](frontend/src/components/curriculum/ProgramAnalysisSummary.tsx)
  extracts the small reusable atoms out of
  [InstitutionProgramDetail.tsx](frontend/src/pages/institution/InstitutionProgramDetail.tsx)'s
  `Report` (`scoreColor`, `Stat`, `SectionLabel`, `OutcomeDeliveryCard`,
  `GapColumn`, `EdgeCard` — all now imported by both pages, not duplicated)
  plus a NEW `ProgramAnalysisSummary` composite — deliberately **not** a
  byte-identical port of `Report`. It keeps score/verdict/warnings/outcome-
  delivery/sequencing-inversions/gaps/load (exactly what a методист is
  checking for) and drops the competency-progression heatmap table and the
  dependency-layer pathway graph — both wide, editing-adjacent
  visualisations that don't fit a ~700px results column and belong more to
  the РОП's authoring workspace (`/programs/:id`) than a методист's
  read-only check. `InstitutionProgramDetail.tsx`'s own `Report`/`TopologyTab`
  untouched in content, only rewired to import the shared atoms — 2305 →
  2203 lines, zero behaviour change. Verified: both typechecks clean, 807
  backend + 46 frontend tests pass, `/institution/methodist` and `/programs`
  both load without a console error.
  🟢 **Ad-hoc file target shipped (2026-08-20) — Phase 3 complete.** New
  «Отдельный файл» tab + `POST /api/methodist/ad-hoc-review`
  ([routes/methodist.ts](backend/src/routes/methodist.ts)): the §5–§8
  evidence-citation check for a РПД that isn't attached to any programme at
  all (arrived by email, still being drafted) — the one target that has no
  `getProgramAccessScope` to check, gated purely on `methodist_access`
  (`requireDomainOnUnitTypes('curriculum', 'view', METHODIST_UNIT_TYPES)`).
  Accepts either an uploaded file (same MIME allowlist/magic-byte
  verification as every other upload path — `uploadConfig` +
  `verifyFileContent`) or pasted text; calls `services/documentExtractor.ts`'s
  `extractText` for the file case, then `reviewSyllabus` directly with no
  competencies/goals — the parser extracts them from the document's own
  declared sections, same as the raw-text path `routes/curriculum.ts`'s
  syllabus-review already supports. **Nothing persisted anywhere** — no
  run row either, since a single check with no programme/discipline target
  has nothing worth polling for; the result lives only in the tab's client
  state, same as every other in-flight check here. Frontend:
  `reviewAdHocSyllabus` (`api/methodist.ts`, `FormData` upload, mirrors
  `api/mySyllabi.ts`'s `submitSyllabusFile`), a file/text mode toggle, and
  the same `SyllabusReviewReport` every other syllabus check in this app
  renders through. Verified: both typechecks clean, 807 backend + 46
  frontend tests pass, page loads without a console error.
- **Touches (Phase 3 complete — all slices shipped):**
  `services/methodist/target.ts`,
  `services/methodist/checks.ts`, `services/methodist/runWorker.ts`,
  `routes/methodist.ts`, `validation/methodistValidation.ts`,
  `db/queries/methodistRuns.ts`, migration 114 (`methodist_runs` table),
  `pages/institution/InstitutionMethodist.tsx`, `api/methodist.ts`,
  `components/curriculum/SyllabusReviewReport.tsx` / `CheckPanels.tsx` /
  `OverlapReport.tsx` / `ProgramAnalysisSummary.tsx` (renderer extraction),
  `pages/institution/InstitutionProgramDetail.tsx` (rewired, not rewritten),
  `docs/ACCESS-MATRIX.md` (Table B + §4, МУМЦ resolution).
- **Not doing:** no new domain — `methodist_access` (§ above) is a
  unit-type-narrowed derived flag on the existing `curriculum` domain, same
  shape as `criteria_access`/`org_overview_access`, not a fifth domain. No
  docs-site article (no new IT-visible integration surface — internal role
  tooling only).

---

### AN. Кафедральная библиотека — teacher-contributed materials + figure library as RAG scope · Effort: Phase 0 S–M, Phase 1 M, Phase 2 M–L, Phase 3 S · 🟢 SHIPPED (2026-09-04)

**Status:** All four phases shipped. Phase 2 covers both `.docx` embedded
images (`documentExtractor.ts`'s `extractDocxFigures`) and PDF — rasterizing
text-sparse pages (`extractPdfFigures`, reusing `yandexVision.ts`'s
`rasterizePdfPages`, now exported), since most real separately-scanned
чертежи/схемы arrive as PDF rather than embedded in a .docx. Figure
captioning tries true VLM image understanding first — `services/llm/deepseek.ts`'s
`captionImage()`, DeepSeek's experimental `deepseek-v4-flash-vision-exp`
model, gated behind `DEEPSEEK_VISION_ENABLED` (default off) — falling back to
the original OCR + text `chatJSON` path on any failure or when disabled. See
CHANGELOG.md [Unreleased] for the full writeup of both the figure library and
the vision follow-up.


Origin: mechanical-engineering courses expose a hard ceiling on what the
models know. For детали машин / начертательная геометрия / ЕСКД-governed
disciplines the model either lacks the specific information or doesn't have
enough of it, while the teachers of those courses have been accumulating
drawings, конспекты and worked examples for decades. The proposal: let
(some) teachers contribute that corpus so generated content is *correct*
and fits the Russian curriculum instead of being reconstructed from an
anglophone prior.

**The idea splits in two, and bundling them is the main design risk:**

- **(a) The text gap** — ГОСТ/ЕСКД conventions, кафедра methodology, Russian
  terminology the model gets subtly wrong. This is ordinary RAG and the
  machinery is already shipped end-to-end (`documents` →
  `services/documentExtractor.ts` → `services/chunker.ts` →
  `document_chunks` pgvector → `db/queries/chunks.ts`'s
  `findRelevantChunks`, consumed by `services/presentations.ts`,
  `services/quizzes.ts`, `services/docChat.ts` with verbatim-validated
  citations). Nothing new to build for ingestion.
- **(b) The drawing gap** — the one actually named, and RAG-over-text cannot
  solve it. A chunk of a чертёж is OCR noise. Today an embedded drawing is
  flattened by `ocrDocxImages` and the geometry is lost; presentations then
  illustrate themselves via `yandexImageSearch` against the open web, which
  is precisely where correct Russian engineering figures aren't. This needs
  a **retrievable figure library**: images kept as assets, VLM-captioned,
  embedded *by caption*, offered to the slide generator ahead of web image
  search.

(b) is the differentiated feature; (a) is its enabler. Sequence them, don't
ship them as one thing.

- **The real gap is scope, not ingestion.** `findRelevantChunks` retrieves
  `WHERE course_id = $1` — document RAG never crosses a course boundary.
  Meanwhile grading RAG *already* has an institution pool
  (`institutions.shared_rag_enabled` + `courses.share_rag_with_institution`
  + `rag_institution_uses`, Rule 7). The pooling primitive exists on the
  assignments axis and is simply missing on the documents axis. Most of
  this feature is: **give `document_chunks` the scope ladder `assignments`
  already has.**
- **"Approval process" = the org tree, not a moderation queue.** Feature P's
  domain grants (§7.10) already express exactly this. Scope is a ladder
  anchored to `org_units`, and promotion is a field change by someone who
  already holds the grant:

  | Tier | Who promotes | Status today |
  |---|---|---|
  | `course` | teacher | already the (implicit) behaviour |
  | `unit` (кафедра/факультет subtree) | `edit` on that unit, domain `umu` | **where the value is** |
  | `institution` | root admin, gated on existing `shared_rag_enabled` | toggle already modelled |
  | `platform` | ИСПУМ editorial only | see copyright below |

  No new permissions concept and no review UI to start. Build a queue only
  once there is a backlog to queue — same posture as U's marketplace.
- **Copyright is the blocking constraint, not a footnote.**
  `documentExtractor.ts` already carries the comment "a screenshot-built
  conspectus is typically one image per textbook page" — scanned учебники
  are demonstrably already being uploaded. One teacher's scan on their own
  course is fine; pooling it across an institution is redistribution, and
  ГОСТ texts are separately licensed through Росстандарт and not
  redistributable at all. Therefore, non-negotiable from the first commit
  (retrofitting provenance is the §5.1.2 mistake all over again):
  - promotion above `course` requires a per-document provenance attestation
    — `own_work` / `open_licence` / `institution_owned` / `unknown` —
    stored and surfaced at retrieval time next to the existing `file_name`
    citation;
  - `unknown` may be shared **within** the institution (internal use,
    defensible) and never platform-wide;
  - **the `platform` tier is curated-only** — licensed or authored by
    ИСПУМ, never user-upload. Conveniently the same tier where one bad
    contribution would poison every customer, so the legal and quality
    incentives point the same way.
- **Contribution incentive is attribution, not payment.** "Why would I hand
  over twenty years of materials" is answered by reuse visibility ("ваш
  чертёж использован 34 раза на кафедре"), which falls out of Phase 0's
  tracking table for free. No ratings, no karma, no contributor
  marketplace — reuse count is the honest metric and the only one that
  can't be gamed into noise at this scale.

**Phases**

- **Phase 0 — scope ladder.** Migration 116 (expand-only, Rule 12):
  `documents.visibility_scope` (default `'course'`), `documents.scope_unit_id`,
  `documents.provenance`. Defaults reproduce today's behaviour exactly.
  Widen `findRelevantChunks` / `findRelevantChunksScored` to take a resolved
  scope set instead of a bare `course_id`, built from the caller's org path
  the way `routes/institution.ts`'s `resolveTeachingPrefixes` does — and
  with the same root-anchored-grant caveat (CLAUDE.md §7). Add
  `rag_document_uses` mirroring `rag_institution_uses`.
- **Phase 1 — contribution surface.** «Библиотека кафедры»: upload as
  `document_type = 'material'`, choose scope, attest provenance. Promotion
  gated on `requireDomain('umu', 'edit')` for the target unit. Plan-gate the
  `institution` tier through `canUseFeature` (Rule 4) — a concrete
  institution-plan selling point.
- **Phase 2 — figure library (the differentiated one).** New
  `document_figures`: `document_id`, page/index, object-storage key
  (`services/objectStorage.ts`), VLM-generated Russian caption including
  recognised обозначения, `caption_embedding vector(1536)` via Yandex
  (Rule 9), scope inherited from the parent document. Extract during
  ingestion from PDF page regions and `word/media/*` — both already reached
  by `documentExtractor.ts`. Then in `services/presentations.ts` prefer a
  library figure over `yandexImageSearch` when the scored match clears a
  threshold. This is the change that makes a generated deck on детали машин
  stop looking like a stock-photo collage.
- **Phase 3 — reuse signal.** Per-document and per-figure reuse counts
  surfaced to the contributing teacher and to the кафедра. Data already
  collected in Phase 0.

- **Touches (projected):** migration 116 (+ a later one for
  `document_figures`), `db/queries/chunks.ts`, `db/queries/documents.ts`,
  new `db/queries/documentFigures.ts`, `services/documentExtractor.ts`,
  `services/chunker.ts`, `services/presentations.ts`, `services/quizzes.ts`,
  `services/docChat.ts`, `services/accessScope.ts`,
  `middleware/requireDomain.ts` callers, `routes/documents.ts`,
  `routes/presentations.ts`, `config/planLimits.ts`, a new
  `pages/institution/` library page, `docs/ACCESS-MATRIX.md`.
- **Not doing:** open platform-wide upload, a contributor marketplace, and
  per-item peer review — all three presume contribution volume that doesn't
  exist yet, and the first two carry the copyright exposure without the
  institutional containment that makes the `unit`/`institution` tiers
  defensible. No new domain either: this is `umu` (filing/УМК compliance
  already lives there), not `curriculum`.
- **Depends on:** P (org tree — shipped) for scoping; AG's presentation
  image pipeline (shipped) for the Phase 2 insertion point.

### AO. Презентации — from vending machine to workspace · Effort: Phase 0 S–M, 🟢 SHIPPED (2026-09-04) · Phase 1 M, 🟢 SHIPPED (2026-09-04) · Phase 2 M, 🟢 SHIPPED (2026-09-05) · Phase 3 M–L, 🟢 SHIPPED (2026-09-05) · Phase 4 M, 🟡 PARTIALLY SHIPPED (2026-09-05) (phased, independently shippable)

Presentations are one of the features teachers actually use daily (FEATURES.md,
GA since AG). AG fixed *generation quality* — outline+expansion, real notes
depth, auto-images, web grounding, PPTX. What it did not fix is that a deck is
**write-once and then it leaves**: the only mutation endpoint is
`PATCH /api/presentations/:id/slides/:idx`, and it only sets an image
(`routes/presentations.ts`). A teacher who dislikes slide 7 has exactly two
options — regenerate the whole deck (new job, new spend, minutes of wait, and
every slide they *liked* gets rerolled), or download the PPTX and fix it in
PowerPoint, at which point the deck permanently forks out of ИСПУМ and every
downstream feature we could ever build on it is dead.

Two consequences follow from that single fact, and they're the actual subject
of this entry:

1. **No edit loop** → the teacher receives a verdict instead of authoring a
   lecture, and the only escape hatch is the exit.
2. **No usage signal** → grading has the RAG flywheel (approve → embed →
   retrieve next time, CLAUDE.md invariant); presentations learn *nothing*
   from being used. `presentationEvalHarness.ts` scores `avgNotesWordCount`,
   `bulletsShare`, `imageCoverageAmongEligible`, `citedSlideShare` — all
   structural proxies, all offline, none of them "was this slide any good".
   The signal we're missing (*which slides did teachers edit, regenerate or
   delete*) is a **byproduct of Phase 1**, not separate work.

- **Phase 0 (shipped, 2026-09-04) — outline approval gate. Highest leverage
  per line of code in this entry.** The outline pass is cheap and fast; expansion is ~20 LLM
  calls behind a 2.5s poll loop showing a spinner
  (`PresentationForm.tsx`'s `pollJob`). Split the job in two: return the
  outline at ~10s, render it as an editable list (title / type / order,
  add + delete row), expand on «Продолжить». `normaliseOutline` already
  returns exactly the object the UI needs, and `OutlineSlideSpec` is already
  a clean public type. Buys three things at once — structural errors get
  fixed *before* we pay for 20 expansions (real spend reduction, see AL's
  cost ledger), perceived latency collapses from minutes to seconds, and the
  teacher gets authorship over the deck's shape. Needs a second job state
  (`outline_ready` → awaiting-confirmation → `expanding`) in
  `presentation_jobs` + `presentationJobWorker.ts`, with a TTL sweep for
  outlines nobody confirms. Keep a «Сразу генерировать» escape for teachers
  who don't want the extra click.
  **As built:** `planPresentation()`/`expandPresentation()` split in
  `services/presentations.ts` (composed by `generatePresentation`, so the
  legacy sync route and the eval harness are untouched), a `stage`
  discriminator on the worker payload, `outline_ready` status + `params` /
  `outline` / `web_grounding` / `outline_ready_at` columns (migration 118),
  `OutlineEditor.tsx`, and an hourly `scheduleWithLease` sweep that expires
  24h-old plans and clears the stored conspectus with them. Grounding is
  captured once and replayed; RAG scope is re-resolved at expansion. Usage is
  billed in `expandPresentation`, not at plan time — an abandoned outline
  produced no deck. See CHANGELOG for full detail. **Not done here:** no
  «сгенерировать заново только план» button (regenerating the plan means
  starting the form again), and the deck-level structure editing stops at the
  gate — once expansion runs, the slides are as immutable as they were before
  (that's Phase 1).
- **Phase 1 (shipped, 2026-09-04) — per-slide edit + regenerate.** Widen
  `PATCH .../slides/:idx` to accept `{ title, body, notes }` (validated per
  slide type, same `coerceSlide` boundary the generator already goes
  through), and add `POST .../slides/:idx/regenerate` taking an optional
  free-text instruction («короче», «добавь пример с числами», «это не по
  теме»). Expansion is already batch-scoped — a batch of one is nearly free
  and reuses `buildExpansionPrompt` unchanged. Insert / delete / reorder
  rounds it out. **This is also the instrumentation**: log per-slide
  `edited` / `regenerated` / `deleted` / `kept_verbatim`, which is the first
  real quality metric this feature has ever had.
  **As built:** `PATCH /slides/:idx` widened with a `{ slide }` body beside
  the existing `{ image }`, plus `POST /slides/:idx/regenerate`,
  `DELETE /slides/:idx`, `POST /slides`, `POST /slides/move`; edits cross the
  same `coerceSlide` boundary as model output (`normaliseEditedSlide`);
  regeneration reuses the deck-wide expansion prompt with a batch of one and
  keeps the slide's type, title and picked image; migration 119 persists
  `source_text`/`strict_source` so a rewrite is grounded the way the deck was;
  `presentation_slide_events` records edit/regenerate/delete/insert/reorder
  fire-and-forget. `SlideEditor.tsx` is one form per slide type. See CHANGELOG.
  **Not done here:** `kept_verbatim` is derived (a slide index with no event),
  not stored — recording it would mean a row per slide per deck to say nothing
  happened, and the deck-level «Готово» that would make it meaningful is
  Phase 2's, not this one's. No undo/version history on an edit: the previous
  text is gone once saved. Insert adds an *empty* slide (type + placeholder
  title) rather than generating one in place — «Переписать» fills it, which
  is one extra click. Decks generated before migration 119 regenerate without
  their conspectus.
- **Phase 2 (shipped, 2026-09-05) — close the flywheel.** Feed Phase 1's kept-verbatim slides back
  as few-shot examples scoped to course → кафедра (same scope-gate posture
  as `ragScope.ts`, same "teacher approval is what makes it a training
  signal" rule as grading — invariant 3 applies unchanged: an *unedited*
  slide is a weaker signal than an approved grade, so require an explicit
  «Готово» on the deck before anything becomes an example). Add the
  edit/regenerate rates to `presentationEvalHarness.ts`'s summary so the
  offline harness and live usage report the same axis.
  **As built:** migration 122's `presentations.approved_at` + a «Готово»
  toggle; `findApprovedExemplarSlides` / `selectExemplars` inject at most one
  approved slide per type into the expansion prompt as an explicit style (not
  content) reference, on the `ragFlywheel` plan flag; `computeLiveEditRates`
  prints edit/regenerate/approval rates alongside the harness's structural
  scores. **Two deliberate deviations, both explained in CHANGELOG:** examples
  come from *all* slides of an approved deck (an edited slide is the teacher's
  own writing — the best example, not the worst), and scope is the teacher's
  own decks only. **Кафедра pooling: 🟢 SHIPPED (2026-09-05)** — migration
  123 adds `visibility_scope`/`scope_unit_id` to presentations on AN's ladder,
  gated on the same `umu`/`edit` grant documents require, with no
  `institution` rung (teaching style is a кафедра-level thing) and a
  «Лекции кафедры» shelf. Sharing requires «Готово»; un-approving removes it
  from both shelf and flywheel. Colleagues' decks open read-only. No embeddings: style, not content, so type+recency
  beats similarity — revisit only if exemplars start feeling off-topic.
- **Phase 3 (shipped, 2026-09-05) — wire the deck into the platform instead
  of leaving it a leaf.** In rough order of value:
  - **Дек → тест → аудитория.** 🟢 SHIPPED (2026-09-05).
    `POST /api/presentations/:id/quiz` builds the test from the deck's slides
    *and speaker notes*, framed in the prompt as a lecture just delivered
    (questions stay inside what was covered); RAG is skipped since the deck is
    the material; image placeholders stripped. Migration 120's
    `quizzes.presentation_id` is `ON DELETE SET NULL` so deleting a deck can't
    take a gradebook-linked test with it. Quiz quota shared via
    `assertQuizQuota()` — a test from a deck is still a test.
    `DeckQuizPanel.tsx` sits above the slides with count + Bloom level and the
    Тесты page's pacing toggle. **Not done:** the panel launches the newest
    test for the deck and only *says* when there are others (no picker); no
    "regenerate the test after editing slides" prompt, so a deck edited after
    its test was made keeps the stale test until the teacher makes a new one.
  - **Дек → раздатка.** 🟢 SHIPPED (2026-09-05).
    `GET /:id/handout.pdf` (`services/presentationHandoutPdf.ts`, pdfkit),
    `?notes=0` for a write-on skeleton. No LLM call — the notes are already
    prose. Diagram images deliberately not embedded (greyscale printing).
    Formulas and inline `$…$` flattened via the PPTX exporter's
    `latexToPlainText`, then through a substitution map for glyphs the
    vendored PT fonts lack — **without it every lowercase Greek letter
    printed as a tofu box**, found by rendering the PDF and looking at it.
    The substitution stopgap was replaced the same day: DejaVu Sans/Serif are
    vendored in `assets/fonts` (with licence + README) and `faceFor()` swaps to
    the DejaVu face of the same weight for any paragraph PT can't set. Neither
    family alone sufficed — PT has the operators and no Greek, Noto the
    reverse. **Not done:** no cover page options, no 2-up slide-thumbnail
    layout; `programReportPdf.ts`/`fosReportPdf.ts` still use PT alone (no
    formulas there today, but the same rule is one line if that changes).
  - **Дек ← РПД / тематический план.** 🟢 SHIPPED (2026-09-05).
    Migration 121's `course_lecture_topics` + `presentations.lecture_topic_id`;
    `services/lecturePlan.ts` extracts the plan from `syllabus_text` or the
    latest ready syllabus/material document, on demand and cached;
    `GET/PUT /api/courses/:id/lecture-plan` and `.../extract`. The form offers
    the тема (filling topic + lecture number without overwriting what was
    typed) and feeds the РПД's own wording into the outline prompt.
    **Not done:** no UI to edit the plan itself (the PUT exists, nothing calls
    it — a wrong тема has to be re-extracted or worked around); no
    компетенция/индикатор link yet, which is the other half of what would make
    a deck full УМК evidence; nothing surfaces "which темы of this course have
    a lecture built" — the obvious next screen, and the one AM's Кабинет
    методиста would actually consume.
  - **Дек → published assignment.** 🟢 SHIPPED (2026-09-05).
    `POST /:id/assignment` renders `discussion` slides into a draft published
    assignment — no LLM call, `expected_angles` withheld. Back-link 🟢 SHIPPED (2026-09-05):
    migration 124's `published_assignments.presentation_id`, so a second click
    returns the existing draft rather than making another over the teacher's
    edits.
- **Phase 4 (partially shipped, 2026-09-05) — fidelity + institutional
  finish.** Independent of the above, ordered by how often each one gets
  raised. **Shipped:** PPTX import, the 16:9 fit warning, free-tier history.
  **Still open:** institution branding, OMML formulas, generated schematics,
  persisted image candidates, the кафедра deck bank — each with its reason
  inline below.
  - **Import existing PPTX.** 🟢 SHIPPED (2026-09-05).
    `services/pptxImport.ts` + `POST /api/presentations/import`. No new
    dependency (`jszip`/`fast-xml-parser` were already present), no model
    call, so no quota and no plan gate. Slide order comes from `<p:sldIdLst>`
    (filenames lie once a deck has been reordered); notes are matched through
    each slide's own rels (a deck with partial notes numbers them
    independently, so slide3 can own notesSlide1); title = placeholder, else
    the largest text on the slide. Round-trip tested through this repo's own
    PPTX exporter rather than a fixture. Bulk notes: 🟢 SHIPPED (2026-09-05) —
    `writeMissingNotes()` + `POST /:id/notes` (queued, costs one generation,
    button appears only when slides lack notes). **Not done:** slides still
    import as `bullets` bar a cover slide, so type upgrades remain one
    «Переписать» at a time.
  - **Institution branding.** `presentationExport.ts` hardcodes one palette
    (`const C`). Титульный лист, logo, кафедра naming — cheap to build,
    impossible to argue with in a B2B demo, belongs next to the existing
    institution settings surface.
  - **Formulas export as PNG** via `formulaRenderer.ts` — readable, but not
    editable in PowerPoint. Emitting OMML makes them native equation
    objects; `ommlToLatex.ts` already exists for the inbound direction.
  - **The viewer isn't a slide.** 🟡 fit check SHIPPED (2026-09-05).
    `shared/slideFit.ts` compares each slide's *visible* text (speaker notes
    excluded — they are never drawn) against per-type budgets taken from the
    exporter's own regions, and the viewer shows a «Много текста» chip.
    Deliberately a character/line budget, not real text measurement: catching
    the slide with eleven bullets is the point, policing the one that runs two
    words over is not. **Not done:** an actual 16:9 preview — the chip says a
    slide will overflow, it does not show what it will look like.
  - **`diagram` slides hunt for a photo.** Generating an SVG/Mermaid
    schematic from the brief beats top-1 image search for process/flow
    content and sidesteps the licensing question a web image on a university
    projector quietly raises. (Carried forward from AG Phase 2's deferred
    list, still not done.)
  - **Auto-image takes `results[0]` only** (`autoFillImages`). Persisting
    the 3 top candidates for a one-click inline swap removes the most common
    manual step. AG Phase 2 dropped this as unnecessary because the picker
    re-searches on demand; that reasoning holds only while opening the picker
    is rare, which per-slide editing changes.
  - **Free tier has `presentationHistory: false`** — 🟢 SHIPPED
    (2026-09-05), now `true`. Depth, PPTX export and the style flywheel stay
    the paid lines; losing work you made is not an upsell.
  - **No кафедра deck bank.** 🟢 SHIPPED (2026-09-05) — migration 123, the
    same scope machinery AN built for documents, surfaced as «Лекции
    кафедры». **Not done:** no filtering or search on the shelf (a 50-deck
    cap and newest-first ordering is all it has), and nothing surfaces the
    bank inside AM's Кабинет методиста, which is where a методист curating
    it would actually be working.
- **Why:** the generator is mature; the *workflow around it* is not. Phases
  0–2 convert a shipped, actively-used feature from a vending machine into a
  workspace, and pay for themselves twice — less wasted expansion spend, and
  the first genuine quality signal this feature has ever produced. Phase 3 is
  what makes the deck the centre of the lecture rather than a step before it.
  If only three things get built: **Phase 0, Phase 1, and Phase 3's
  дек → live-quiz link.**
- **Touches:** `services/presentations.ts`, `services/presentationJobWorker.ts`,
  `services/presentationExport.ts`, `services/presentationEvalHarness.ts`,
  `routes/presentations.ts`, `validation/presentationValidation.ts`,
  `db/queries/presentations.ts` (+ migration: job outline state, per-slide
  edit events), `shared/types.ts`, `PresentationForm.tsx`,
  `SlideContent.tsx`, `config/planLimits.ts`.
- **Depends on:** AG (shipped) for the outline/expansion split Phase 0 gates
  on and the image pipeline Phase 4 extends; Y (shipped) for the live-quiz
  link; AN (shipped) for the кафедра-scope machinery a deck bank would reuse;
  AL's cost ledger (shipped) to verify Phase 0's spend reduction is real
  rather than assumed.

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
