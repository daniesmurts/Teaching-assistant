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
- **`/programs` — clear action-vs-list hierarchy (UI/UX).** The import trigger
  was a white card identical to the programme-list cards, so "which is the
  button and which is the list?" was genuinely ambiguous. Fixed by giving the
  page a single **primary CTA** — an amber «＋ Импортировать программу» button in
  the header (hidden for read-only viewers, who keep the «Только просмотр» chip).
  The intake form no longer masquerades as a list card: it opens from the CTA as
  a **distinct amber-tinted panel** with its own titled header + close, clearly
  an input zone. The programme list now sits under a labelled **«Ваши программы ·
  N»** section header («Программы организации» for oversight viewers), so content
  reads as content. No behaviour change to import/analysis.
- **`/institution/structure` — level accenting + scalable roster (UI/UX).**
  Two readability problems on the org-structure page. (1) **Tree levels now
  read at a glance**: every row gets vertical **depth guide rails** (one line
  per ancestor level, aligned across siblings) and a per-level **colour spine**
  on its left edge, and the type badge is tonally tiered. Honouring the
  amber-only accent rule, levels are differentiated by neutral tones (root =
  darkest/authoritative, management chain mid-neutral, kafedra quietest) and
  **amber is reserved for the one tier that carries meaning** — programme
  anchors (`program` / `program_direction`), which hold the ФГОС data and are
  the РОП's unit. No rainbow, no second accent. (2) **The «Преподаватели и
  роли» roster scales to hundreds**: a sticky controls bar with name/email
  **search**, four **quick-filters with live counts** (Все / С ролями / Без
  ролей / Без кафедры — the last two are the real triage needs), **client-side
  pagination** (20/page, resets on filter change), a result count with correct
  Russian pluralisation, and a proper **no-results** state. Pagination over
  virtualization deliberately — no new dependency, and it's plenty for the
  scale. Row hover switched to a background highlight so the colour spine
  survives. Typecheck + production build clean.

### Added
- **Programme metadata on org units → prefilled РОП import (migration 055).**
  The РОП import form made every user retype standardised ФГОС header data
  (код, наименование направления, уровень, формы обучения) that the
  institution already knows. Now the IT/УМЦ admin records it once on the
  `program`/`program_direction` org_unit (new `code` / `specialty_name` /
  `education_level` / `forms_of_study` columns), and when a РОП picks that unit
  in the import form the four fields auto-fill. The picker moved to the top of
  the form so the flow is pick-unit → confirm-prefilled-data → add профиль +
  PDFs. Two fields that were free text became national-standard controls —
  уровень образования is a dropdown, формы обучения are checkboxes
  (`EDUCATION_LEVELS` / `STUDY_FORMS` in shared) — since they're not
  per-institution and never needed admin pre-entry. Профиль stays the РОП's to
  fill (it's per-programme: one направление hosts several). Prefill only
  overwrites fields the unit actually carries, so a unit with no metadata
  leaves typed input intact. Admin UI: a «Данные программы (ФГОС)» block in the
  add-unit form and the «Тип и размещение» gear panel, shown only for
  programme-anchor types. When adding a programme unit the tree **Название
  auto-composes from код + наименование** (e.g. «09.03.01 Информатика и
  вычислительная техника») so the admin enters it once — editable for a custom
  label (touching the field stops the auto-sync); existing units keep name
  independent (rename via the pencil). Backend threads the metadata through create/update
  (gated to programme types — a kafedra rename never touches the columns),
  `pickable-units` returns it, validation caps lengths. Metadata round-trip
  (create/read/partial-update/clear/type-gating) verified against dev DB; both
  typechecks clean, 143/143 tests green.
- **Org units — deliberate re-type and move operations (structure page).**
  Until now a mis-typed or mis-placed unit was stuck: `updateOrgUnit` only
  edited name/short_name/external_code, and delete is (correctly) blocked
  while a unit has children/teachers — so an admin who built a subtree under a
  wrongly-typed node had no fix. (The 2026-07-02 note that KNITU's direction
  units "can be reclassified via the tree UI" now actually holds.) Two new
  audited endpoints under `/api/institution/structure`: `POST /units/:id/retype`
  (change `type_code`) and `POST /units/:id/move` (re-parent). Re-type is kept
  separate from the rename PATCH because type drives authorisation
  (governance/admin_office grant institution-wide programme access by type
  alone); it's guarded — can't re-type the root, can't leave `department` while
  teachers point at it, can't leave the program/program_direction pair while a
  programme is linked. Move recomputes the materialised path for the unit AND
  its whole subtree in one prefix-rewrite UPDATE (transactional), rejects
  cycles (new parent inside the moved subtree) and cross-institution moves, and
  maps the sibling-name UNIQUE violation to a clean Russian error. New queries
  `retypeOrgUnit`, `moveOrgUnit`, `countDirectPrimaryMembers`; validation
  `retypeOrgUnitRules` / `moveOrgUnitRules`; audit actions `org_unit.retyped` /
  `org_unit.moved`. Frontend: a «Тип и размещение» (gear) panel per non-root
  unit on `/institution/structure` with a type select + a parent select that
  excludes the unit's own subtree (client-side cycle guard mirroring the
  server). Verified path recompute + cycle rejection end-to-end against dev DB;
  both typechecks clean, 143/143 tests green.
- **Grant-role UI — blast-radius warnings + viewer honesty (S4/L8).** The
  role-grant picker on the structure page now warns before an
  institution-wide grant: `admin` on the institution root («равнозначно
  администратору организации») and `head`/`admin` on a governance/admin_office
  unit («дают доступ ко всем образовательным программам… а не только к этому
  подразделению») — the type-based programme-access rule was previously
  invisible at grant time. `viewer` now carries a note that it's recorded but
  doesn't yet open any surface (nothing consumes the role), pointing the admin
  at «Руководитель» for actual dashboard access.

### Fixed
- **Institution members without a primary unit — silent leadership
  undercounting (L1).** Migration 045/047 placed teachers who existed at §7
  rollout into a default kafedra, but everyone who joined SINCE (invite,
  email-domain auto-join, SAML JIT) landed with `primary_org_unit_id = NULL` —
  invisible in leadership dashboards / structure headcounts and uncounted by
  the delete guard. New `assignDefaultDepartmentIfUnset` (prefers the seeded
  «Кафедра (по умолчанию)», else the institution's oldest department, never
  overwrites an explicit placement) runs on every attach path: register via
  invite/auto-join, SAML find-or-create (new and first-time-attached existing),
  and the admin institution-move. Migration 053 heals the rows that went stale
  in between (idempotent). Verified assignment + non-overwrite against dev DB.
- **Lockout guard counted deactivated admins (S5).** `countRoleOnUnit` counted
  `org_unit_roles` rows without checking `is_active`, so with one active + one
  deactivated root admin, the last active admin's role could be revoked (count
  = 2) leaving the org with zero usable admins. It now joins `teachers.is_active`;
  the revoke route also skips the guard when the *holder* is already
  deactivated (revoking from them can't worsen lockout). Verified active-vs-
  deactivated counting against dev DB.
- **Unit delete silently stranded linked programmes (L2).** The delete guard
  checked child units + teachers but not `programs.org_unit_id` (ON DELETE SET
  NULL) — deleting a `program`/`program_direction` unit unlinked the programme,
  instantly dropping the РОП's access with no warning. `getOrgUnitDependents`
  now also counts linked programmes and the route refuses the delete with a
  clear Russian error pointing at the programme's «Подразделение в структуре»
  detach control.
- **Practice-type uniqueness now enforced (L4).** FEATURES claimed "same
  practice type can't be used twice on one programme" since migration 050, but
  nothing enforced it: the import batch never deduped `practice_types` and the
  attach endpoint inserted a second file of the same type freely. Now: the
  attach route replaces-on-reupload (`deletePracticeForType`, mirroring the
  working_programme convention), the import route rejects duplicate types in the
  batch, and migration 054 backs it with a partial unique index
  `(program_id, practice_type) WHERE kind='practice'` (dedupes existing
  violations, keeping the newest per type, first).
- **Programme import was non-transactional (L5).** `POST /programs/import`
  validated the practice file/type set AFTER `createProgram`, so a mismatched
  count or unknown/duplicate type threw a 400 with the programme + disciplines +
  competencies already persisted — the client retried into a duplicate. All
  practice validation is now hoisted ahead of any row creation.

- **Security: cross-institution leakage via stale org ties after a teacher
  reassignment.** When a platform admin moved a teacher between institutions
  (PATCH /api/admin/teachers/:id), the teacher's `org_unit_roles` rows and
  `primary_org_unit_id` in the OLD institution were never cleaned up. Two
  leaks followed: (a) the moved teacher kept `/leadership` access to the old
  org's subtree — `hasLeadershipRole` / `listDirectLeadershipUnits` filtered
  by teacher only, never by institution; (b) the old org's heads could keep
  drilling into the moved teacher's grades, because the drill gate walks the
  target's (stale) primary unit. Fixed in four layers: (1) new
  `clearOrgTiesOutsideInstitution` (transactional) runs on every real
  institution change in the admin PATCH — deletes foreign-institution role
  rows and nulls a foreign primary unit, before `syncRoleToTree` so a role
  sync re-grants in the NEW tree only; (2) `hasLeadershipRole` and
  `listDirectLeadershipUnits` now take the caller's `institution_id` and
  filter on it (auth payload's `is_leader`, `requireLeader`, and the unit
  picker all updated); (3) `/api/leadership/overview` adds an explicit
  same-institution guard (404, so foreign unit ids don't leak) and the
  per-teacher drill compares the target's `institution_id` against the
  caller's before the tree walk; (4) migration 052 heals rows that went
  stale before the fix (idempotent). Verified end-to-end against dev DB with
  synthetic two-institution data (move, same-institution survival, detach —
  zero residue); both typechecks clean, 143/143 tests green.

### Added
- **Audit logging for org-structure and role operations.** The
  `/api/institution/structure` surface — the most security-sensitive admin
  surface in the product (role grants confer leadership/programme access) —
  wrote no audit records at all. Every operation now records to the existing
  institution audit log: `org_unit.created` / `bulk_created` / `updated` /
  `deleted`, `org_member.primary_set` (kafedra assignment), and
  `org_role.granted` / `org_role.revoked` (with role, unit name and unit
  type in metadata — enough to answer "who granted this authority and
  when"). Role/member entries resolve the target teacher's email so the
  журнал reads like the invite entries do. Frontend «Журнал действий» gains
  Russian labels + icons for the seven new actions; unknown actions keep the
  raw-string fallback. Same fire-and-forget `recordAudit` path as the
  existing invite/activation entries — auditing never blocks the action.

---

## [2026-07-02]

### Changed
- **Coverage check surfaces the full breakdown inline in the Documents tab.**
  Previously the discipline row only showed a bare "покрытие 75%" summary and
  the useful part (per-competency covered/partial/missing with evidence quotes
  + notes) was one tab away in the Report. On a fresh check the row now
  auto-expands with the full breakdown right there — same content the Report
  tab has always shown, just next to the file the user just checked — plus a
  «Скрыть / Показать разбор» toggle. Header stats change from a bare % to
  colour-coded counts split by status (`X раскрыто · Y частично · Z не
  раскрыто`), which carries more signal than a weighted overall %.
- **Auto-detect: broader recall.** The `detectDeclaredCompetencyCodes` prompt
  used to look only in the «Планируемые результаты обучения» section and
  dropped codes it saw elsewhere. РПД documents in the wild list codes across
  multiple places (declared section, competency matrix, content descriptions,
  assessment rubrics) — the prompt now instructs the model to include a code
  if it appears anywhere as formed by the discipline. Recall test on a
  three-code fixture (`УК-1, УК-2, УК-5`): old prompt returned 2 of 3
  (dropped `УК-2` mentioned only in matrix + content); new prompt returns
  all three. `maxTokens` bumped from 800 to 1500 so longer programme
  competency sets don't get truncated.

### Added
- **Auto-detect declared competency codes on РПД upload.** When a рабочая
  программа is attached to a discipline and the discipline currently has no
  `competency_codes`, one cheap `chatJSON` pass extracts which codes the РПД
  itself declares (from its «Планируемые результаты обучения» / «Компетенции»
  section), filtered against the programme's own `program_competencies.code`
  set so OCR noise or off-programme codes are silently dropped. Populates
  `program_disciplines.competency_codes` in place — never clobbers a manual
  entry (guarded by a `cardinality = 0` check in `fillDisciplineCompetencyCodesIfEmpty`).
  Verified in dev: on real text mentioning УК-1, УК-5 as declared and УК-2 as
  a passing reference ("также затрагивает"), the model correctly picked only
  УК-1 and УК-5. Response includes `detected_competency_codes` so the client
  can toast the count; the invalidated `program` query rehydrates the
  discipline row and the "Проверить соответствие компетенциям" button lights
  up without any manual step.

- **Programme list groups by направление.** A направление подготовки often
  hosts several учебных планов — one per профиль/специализация (e.g. `15.03.02
  Технологические машины и оборудование` in KNITU carries "Оборудование
  нефтегазопереработки", "Вакуумная и компрессорная техника", etc., each with
  its own учебный план + set of РПД). The programme list on `/programs` now
  buckets programmes that share the same `org_unit_id` (falling back to the
  `code`+`specialty_name` pair for programmes not yet linked into the tree) and
  renders multi-profile buckets as a small heading + nested card list; single-
  profile buckets keep the flat compact card the list has always shown. The
  profile field within each card is what distinguishes rows within a group.
  No schema change — a programme's profile continues to live in
  `programs.profile` (the intake form already asks for it); the same
  Documents + Analysis tabs work per-programme so per-profile document
  libraries and coverage checks come for free.

- **`program_direction` org-unit type — «Направление подготовки».**
  The org tree now distinguishes ОП (`program`, e.g. `15.00.00 Машиностроение` —
  the УГСН grouping) from the specific направление подготовки (`program_direction`,
  e.g. `15.03.02 Технологические машины и оборудование`) that sits under it. A
  broad ОП hosts multiple направления with different РОПы; a narrow ОП that
  already IS at direction granularity (like `16.03.01 Холодильная техника`)
  stays a leaf without children. `programs.org_unit_id` and РОП `head` grants
  can attach at either level — programme-access queries widen to
  `type_code IN ('program', 'program_direction')` so subtree walks pick up both
  transparently. No DB migration (`type_code` is unconstrained TEXT); enum
  extension only. Tree-builder dropdown gains the new type as an option; the
  programme-link picker (intake form + detail page) prefixes each entry with
  `ОП: ` or `Направление: ` so the level being linked at is unambiguous.
  Existing 9 units in KNITU's «Инженерно-технологическая» polygroup are
  unchanged — the 3 direction-level entries can be reclassified via the tree
  UI when convenient.

### Changed
- **Email deliverability — Reply-To + List-Unsubscribe + emoji-free admin subjects.**
  Three additive sender-reputation wins after observing invites landing in
  Yandex's Спам folder despite verified SPF/DKIM/DMARC: (a) admin-notification
  subjects in [emailTemplates.ts](backend/src/lib/emailTemplates.ts) no longer
  start with 🎉 💰 💬 (Yandex/Mail.ru classifiers weight emoji-loaded subjects
  against the whole sender reputation, even though those go to the owner);
  replaced with `[ИСПУМ]` prefix. (b) Every send now carries a `Reply-To`
  header (default `support@ispum.ru`, override via `EMAIL_REPLY_TO`) instead
  of leaving replies to bounce into the `noreply@` void. (c) Non-security
  emails now carry `List-Unsubscribe: <mailto:unsubscribe@ispum.ru?…>` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` — Gmail/Yahoo's Feb-2024
  sender rules made these de facto required for inbox placement, and they
  signal legitimacy to spam classifiers. `EmailPayload` gains an optional
  `category: 'security' | 'transactional'`; `passwordResetEmail` /
  `passwordChangedEmail` mark themselves `security` so they skip the
  unsubscribe headers (security-critical mail must not be unsubscribable).
  Wired through both the Unisender Go API (`message.reply_to` + `message.headers`)
  and the nodemailer SMTP fallback. Env-overridable: `EMAIL_REPLY_TO`,
  `EMAIL_UNSUBSCRIBE_MAILTO`.

### Added
- **Programme document attachments — рабочая программа + практики (Migration 050).**
  The intake form now accepts КНИТУ's fuller per-направление document set
  beyond the two documents used for analysis: (a) one **Рабочая программа**
  PDF; (b) up to four **Практики**, each with a type dropdown constrained to
  the canonical set (производственная технологическая / преддипломная /
  учебная ознакомительная / учебная эксплуатационная) — same type can't be
  used twice on one programme. Files are stored as originals in Yandex
  Object Storage under `programs/<id>/<doc_id>_<name>`, metadata in the new
  `program_documents` table. Extended `POST /programs/import` accepts the
  new multipart fields (multer `working_programme` + `practices` array with
  parallel `practice_types` body values). New endpoints on the programme:
  `POST /:id/documents` (attach later, one file at a time), `GET
  /:id/documents/:docId/download` (JWT-authenticated stream), `DELETE
  /:id/documents/:docId` (best-effort object cleanup on delete). Programme
  detail response now includes `documents[]`. Frontend: intake form gains
  a рабочая программа FileField + dynamic Practices list with per-row type
  dropdown; detail page gains a **«Документы»** tab that groups by kind,
  shows filename + size + upload date, and offers download + delete
  (deletes gated by `can_edit`). Parsing/analysis integration of the new
  files is a separate follow-up — this PR is storage + retrieval only.

- **Discipline-scoped рабочая программа + coverage check (Migration 051).**
  Migration 050 assumed one aggregate РПД PDF per programme; in reality
  КНИТУ carries one per **discipline** (dozens per направление), gathered
  incrementally. `program_documents.kind='working_programme'` now carries a
  `discipline_id` (FK → `program_disciplines`, replace-on-reupload — one
  current file per discipline) plus a cached `extracted_text` column so
  review runs don't re-parse the PDF each time. The intake form no longer
  gathers рабочая программа at all — it's attached later, per discipline,
  from the programme's Documents tab, which now lists every discipline with
  an upload/replace affordance instead of a single slot.
  New: **`services/documentReview.ts`** — Feature K
  ([TODO.md](TODO.md), "РПД ↔ competency/goals conformance check") scoped to
  a programme discipline instead of a standalone syllabus upload. One
  `chatJSON` call scores the discipline's uploaded РПД against the
  competencies it declares (`program_disciplines.competency_codes` →
  `program_competencies`), classifying each as covered/partial/missing with
  a verbatim evidence citation (same citation-validation contract as
  grading). Results persist in the new `program_document_reviews` table
  (one row per run; latest per discipline is read back). New routes: `POST
  /:id/disciplines/:disciplineId/review`, `GET /:id/discipline-reviews`.
  Frontend: the Report tab gains a **«Соответствие РПД компетенциям»**
  section — an expandable per-discipline table that fills in incrementally
  as more disciplines get checked, with no requirement that every
  discipline be covered before it's useful. Practices remain
  programme-scoped (unchanged); the review mechanism is written generically
  enough to point at them later without a new service.

### Changed
- **Programme scope now walks the subtree — polygroup heads (and any
  intermediate authority) fit naturally.** Between УМЦ (institution-wide via
  `admin_office`) and the РОП (direct `program` grant), KNITU has 4 polygroup
  heads managing groups of РОПs, some of whom are also РОПs themselves. The
  previous scope helper knew only two shapes and left polygroup heads with
  `none` — inaccessible page. `getProgramAccessScope` now walks the
  materialised path of every unit the caller holds head/admin on
  (cluster / division / department / program) and unions the `program` units
  found underneath. Dual roles (polygroup head + direct РОП) fall out of the
  same DISTINCT — one query resolves it. Governance / admin_office still get
  `all-rw`. New `GET /api/institution/programs/pickable-units` returns the
  server-computed set for the import picker so РОПы and polygroup heads
  (who can't call the institution-admin structure endpoint) populate the
  picker without leaking the tree. Frontend renamed `isRop → isScoped` since
  the guard now covers polygroup and institute heads too; copy on the picker
  hint reflects it («ваше направление / институт»).
- **Programmes rescoped: РОП + УМЦ + проректор can all import and edit.**
  Corrects a positioning mistake in the first version of Feature P role-driven
  programme access. Programme content is authored in the university's own
  system; ИСПУМ ingests via PDF and runs analysis. In practice, РОПы create
  the import (of their own programmes) and collaborate on corrections and
  analysis with УМЦ and проректор — so head/admin on `governance` or
  `admin_office` now returns `all-rw` instead of `all-ro`, and `specific`
  (РОП) can now POST /api/programs, POST /api/programs/import, and DELETE
  their own programme (backend rejects any `org_unit_id` on write that isn't
  in the caller's held program units). РОП must pick their programme's unit
  in the import form — picker auto-selects when they head exactly one, forces
  a choice when they head several. All-rw callers see all `program` units in
  the tree with an optional «— не связывать сейчас —» option so IT can bulk
  import before linking. Intro copy rewritten: no more «программы создаёт
  администратор организации» — it's honestly framed as an analysis tool with
  external authorship. The `all-ro` scope enum branch stays for a future
  viewer-role surface but no active role maps to it.

### Added
- **«Руководство» surfaces programme state — polygroup / институт / РОП heads
  land on something useful.** The dashboard was grading-focused (teachers + 30d
  проверок), which reads as empty for a polygroup or институт head whose real
  job is programme oversight, not classroom grading. New «Образовательные
  программы» section between the activity chart and the teacher table lists
  every `program` org_unit in the picked subtree with a state pill:
  «Не импортирована» (unit exists in the tree but no linked programme yet — hint
  points the viewer at РОП / УМЦ to import), «Требуется учебный план» (linked
  but учебный план PDF missing), «Готова к анализу» (docs uploaded, no analysis
  yet), «Анализ выполнен · dd mmm yyyy». Each linked programme card also shows
  ✓ chips for the two PDFs, discipline count, competency count — clickable
  through to `/programs/:id`. Auto-hides for subtrees with no `program` units
  (e.g. kafedra heads without programmes under them). Backend:
  `listProgramUnitStateForSubtree(unitPath)` — LEFT JOIN of `org_units` to
  `programs` on `org_unit_id` with derived flags + analysis timestamp.
  `/api/leadership/overview` extended with `program_units[]`.
- **«Руководство → Преподаватель» drill page (Leadership V2 slice 1).** Any
  teacher row on `/leadership` is now clickable and lands on
  `/leadership/teachers/:id` — a read-only per-teacher panel scoped by the
  caller's tree access. Backend: `GET /api/leadership/teachers/:id` gates via
  `canActOnUnit` on the *target teacher's* `primary_org_unit_id` (not the
  caller's leadership unit) so a кафедра head can only drill teachers whose
  primary unit is theirs; an институт head reaches every teacher in their
  subtree. Platform admin bypasses. Response includes: 30-day totals
  (проверок, доля утверждений, средняя правка балла — the RAG-flywheel
  quality signal), zero-filled daily activity, active subjects with
  per-subject grade counts, and the last 20 assignments. Four new queries in
  `db/queries/leadership.ts`: `getTeacherLeadershipProfile`,
  `getTeacherLeadershipActivity`, `listTeacherActiveSubjects`,
  `listTeacherRecentGrades`. Frontend: new `LeadershipTeacher.tsx` page with
  three stat cards, sparkline (reuses the overview bar-chart style), active
  subjects list, recent grades table. Presentations + published-assignments
  slices tracked separately under Feature P tail d.
- **Role-driven access to «Образовательные программы» (Feature P tail c/1 —
  РОП + начальник УМЦ + проректор).** Programs surface is no longer locked to
  institution-root admins. Migration 049 adds `programs.org_unit_id` linking a
  programme to its `program` org_unit; the IT admin sets this on the detail
  page via a new «Подразделение в структуре» select (only visible to all-rw).
  New `services/programAccess.ts::getProgramAccessScope` resolves the caller
  into one of four buckets: **all-rw** (institution-root admin / platform
  owner — full read/write across the institution), **all-ro** (head/admin on
  a `governance` or `admin_office` unit — aggregate oversight, read-only,
  default-on by unit type per KNITU model), **specific** (head/admin on a
  `program` unit — the РОП — sees + edits only their own programmes), or
  **none** (regular teachers, page hidden). New `requireProgramAccess`
  middleware attaches the scope to `req`; every /api/programs route enforces
  read/edit gates via `canReadProgram` / `canEditProgram`. Detail response
  now also returns `can_edit` (server-computed per this caller × this
  program) and `org_unit_ancestors` (root-first ancestor chain for a
  non-clickable breadcrumb so an РОП sees which институт their programme
  sits under). Auth payload gains `program_access: 'none'|'all-rw'|'all-ro'|'specific'`
  so the new main-nav «Образовательные программы» entry renders without an
  extra round trip. Read-only viewers see a «Только просмотр» chip and a
  disabled Builder (via `<fieldset disabled>` — cascades to every input,
  select and button inside without threading a `disabled` prop through
  dozens of controls). The InstitutionLayout sub-nav now points at the same
  top-level `/programs` URL; old `/institution/programs` remains as a
  backward-compat route. Follows KNITU's model: IT owns tree topology and
  role grants; features unlock automatically once roles are assigned.

### Changed
- **Copy sweep: «ИИ» → «ИСПУМ» in marketing, onboarding and FeatureIntro cards.**
  Replaced the generic «ИИ» placeholder with the product name (or «платформа»)
  in selling / onboarding copy across: Grading FeatureIntro (per-screenshot
  rewording), Onboarding checklist, WelcomeModal, UpgradeModal feature
  bullets, Landing.tsx (intro, "Обучается на ваших оценках" section, the
  "Доверьте рутину" three-step block, both feature/comparison tables),
  Pricing (feature list + comparison row), UseCases, MaterialGenerator x3,
  Topics, Courses (description + step), Criteria FeatureIntro title,
  Quizzes, Presentations, Institutions STEM block, CurriculumStudio
  (description + step + tagline), LearningLoop FeatureIntro
  (title + description + steps), Materials TopBar subtitle, helpArticles.ts
  intro bullets. **Left untouched** where «ИИ» is genuinely the topic, not a
  stand-in for the product: Ethics page, About page philosophy taglines,
  FAQ questions (users search by «ИИ»), ConfidenceBadge labels, error
  messages naming the AI subsystem, internal admin metric titles, Перерасчёт
  ИИ artefact labels, the «ПроверитьИ» action button name, the helpArticles
  technical sections about provider switching and the «Модель ИИ под капотом»
  article (they describe the AI model itself).

### Added
- **Settings page — edit display name.** New `PATCH /api/account/profile` (2–100
  char validated) lets a teacher fix a name they mistyped at signup without
  going through support. Inline «Изменить» affordance on the Аккаунт card —
  switches to an input with Enter-to-save / Esc-to-cancel, updates the auth
  store on success so the sidebar avatar reflects the change immediately.
  Scope deliberately tiny: name only. Email stays auth-coupled; university
  stays institution-derived. Adding more profile fields later is additive.
- **Invite link prefills university from the invite.** When a teacher arrives
  at `/register?invite=<token>`, the университет field now prefills with the
  inviting institution's name alongside the already-prefilled email. They're
  joining that institution by definition — leaving the field empty just made
  them retype it. Still editable in case the institution display name differs
  from how they want to spell it.
- **«Вам предоставлен бесплатный доступ к ИСПУМ Pro» email on admin grant.**
  When the platform owner comps a teacher via
  `POST /api/admin/teachers/:id/subscription/grant` (the existing freebie path
  used for pilots / support / institutional gifts), the teacher now gets a
  congratulations email listing what Pro includes and the expiry date.
  Triggered only from the admin grant path — the paid path in
  `services/paymentFulfillment.ts` continues to send its own receipt
  (no duplicate). Fire-and-forget; respects the new Reply-To +
  List-Unsubscribe sender-reputation headers. New `proGrantedEmail` template
  with Russian-correct день/дня/дней pluralisation.
- **Invite email delivery status surfaced in the admin panel.** Until now invite
  send was fire-and-forget: the admin saw «приглашён» the moment the row was
  inserted, even when Unisender / SMTP rejected the recipient (e.g. free-tier
  domain-whitelist 403s). Migration 048 adds `teacher_invites.email_delivered`
  + `email_error` (tri-state, NULL = pre-migration). `sendEmail` now returns
  `{ ok, error? }` so callers can record the outcome; the single + bulk invite
  routes await it and call `markInviteEmailStatus`. The «Ожидают принятия»
  panel renders a danger «Письмо не доставлено» chip and shows the provider's
  error message inline when `email_delivered === false`. Existing pending
  invites (`email_delivered = NULL`) render unchanged. Diagnosed by a live
  prod log audit — the smoking-gun example was Unisender code 903 on
  yandex.ru / mail.ru recipients (free tier whitelists checked domains only).
- **«Руководство» dashboard — V1 (Feature P tail d, grades-only).** New
  `/leadership` surface visible to any teacher holding `head` or `admin` on a
  unit (or the platform owner). Until now those role grants were recorded but
  inert; this is the first surface that consumes them. Backend:
  `requireLeader` middleware (cheap existence check); `GET /api/leadership/units`
  returns the picker list — direct holdings for regular leaders, all
  institution roots for platform owner; `GET /api/leadership/overview?unitId`
  scoped per-request via the existing `canActOnUnit` path-walk, returns the
  subtree's teacher list (most-active first) and a zero-filled 30-day daily
  grade series via a `generate_series` LEFT JOIN. Frontend: `Leadership.tsx`
  with a unit picker (single-unit holders see a chip, multi-unit holders a
  select; choice persists in `localStorage` so revisits land on the same
  subtree), two cards (teachers, grades 30d), bar chart, teacher table. Auth
  payload gains `is_leader: boolean` so the sidebar entry renders without an
  extra round trip. V2 (presentations, published assignments, per-teacher
  drill) tracked under Feature P tail d in TODO.md.
- **«Доступна новая версия» prompt on deploy.** Switched vite-plugin-pwa from
  `autoUpdate` to `prompt` mode so a freshly deployed service worker waits for
  explicit user action instead of silently reloading mid-session (which would
  wipe unsaved grading edits). New `<NewVersionToast>` (mounted in App.tsx)
  uses `useRegisterSW` to surface the prompt as a bottom-left card with
  «Обновить» (calls `updateServiceWorker(true)`) and «Позже». Periodic check
  every 10 min while the tab is visible so long-running sessions notice
  deploys instead of waiting for the next manual reload. Added
  `vite-plugin-pwa/client` to tsconfig types so the `virtual:pwa-register/react`
  module resolves.
- **Collapse/expand for the org structure tree.** Each unit with children gets
  a chevron; clicking toggles its subtree. Default-collapsed for `division`,
  `program`, `department` so a 9-institute / 100-kafedra tree no longer renders
  as a scroll wall — the management chain stays expanded. Collapsed nodes show
  «N внутри» so you know there's content underneath. Expanded state persists
  per-browser in `localStorage` (`ga_org_expanded_v1`). Page-level «Свернуть
  всё / Развернуть всё» toggle at the top of the tree. Opening the «+» on a
  node auto-expands it so a newly added child is immediately visible.
- **Paste-many bulk add for org units.** The «+» form on every unit in the
  structure page gained a «Списком» tab: pick a type once, paste one unit per
  line (`Название | Сокращение`, short optional), and the whole batch is
  created under the parent in a single transaction. Server-side cap of 200 per
  request. Cuts setup time from N round-trips to one when adding a wave of
  institutes / kafedras at the same level. New endpoint
  `POST /api/institution/structure/units/bulk` (validated by
  `bulkCreateOrgUnitsRules`); query `bulkCreateOrgUnits` reuses the existing
  path-from-parent calculation. The single-add mode is unchanged.

### Fixed
- **New institutions now seed an org-tree root + default department.** Migration
  045 backfilled a root `institution` org_unit + `Кафедра (по умолчанию)` for
  every institution that existed when §7 shipped, but `createInstitution()`
  (POST /api/admin/institutions) was never updated to do the same — so any
  institution created since then arrived with zero org_units and the structure
  page rendered "Корневое подразделение не найдено. Обратитесь в поддержку
  платформы." `createInstitution` now seeds the root + default dept in the same
  transaction as the institutions insert. Migration 047 re-runs the same
  guarded backfill (idempotent — institutions already healed are skipped) to
  fix existing prod institutions in this state and attach any teacher whose
  `primary_org_unit_id` was left NULL by the same gap.

### Changed
- **Frontend route gates read org-tree-derived admin flags (Feature P tail b).**
  `/api/auth/login` and `/api/auth/me` now return `is_platform_admin` and
  `is_institution_admin` (the latter = holds `admin` on the institution root,
  via `isInstitutionAdmin`) on the teacher payload. The React gates
  (`AdminRoute`, `InstitutionRoute`, `Sidebar`, `InstitutionLayout`) read these
  instead of the legacy `teachers.role` enum, with a `?? role` fallback so
  sessions stored before the upgrade keep working until the next `/me`. Closes
  the divergence where a teacher granted `admin` purely via the org-role UI
  (which doesn't touch `teachers.role`) was authorised by the backend but
  bounced by the frontend gate. Both typechecks clean, 132/132 tests green.
  (Tail c — true per-subtree admin scoping — deliberately deferred; see TODO
  Feature P.)
- **Admin authorisation now resolves from the §7 org tree (Feature P increment 3).**
  `requireAdmin` / `requireInstitutionAdmin` (still the same export names, all 5
  route files unchanged) are reimplemented on the tree: `requireAdmin` reads
  `teachers.is_platform_admin`; `requireInstitutionAdmin` reads `admin` on the
  institution root via the new `isInstitutionAdmin` query. The legacy
  `teachers.role` enum is **no longer authoritative server-side** — it's kept as
  a synced mirror by `syncRoleToTree`, called from `PATCH /api/admin/teachers/:id`
  whenever role changes (platform_admin → `is_platform_admin`; institution_admin
  → grant admin-on-root; else clear flag + revoke admin-on-root). This closes the
  critical coupling where a teacher promoted after migration 045 would otherwise
  be locked out. The role-based **frontend** route gate still reads `teachers.role`
  (which stays in sync), so no frontend change needed. **Still institution-wide**
  — admin on a sub-unit is not institution admin; true per-subtree admin routes
  are future work. Behaviour-equivalent to before for existing admins (verified
  against dev DB: backfilled admin recognised, promotion/demotion sync correctly);
  typecheck clean, 132/132 tests green.

### Added
- **Published assignments — AI grading of submissions (Feature Q4b).** Closes the
  loop: from the submission-review page, «Проверить» grades the work through
  the existing grader (`POST /api/published-assignments/:id/submissions/:inviteId/grade`,
  `aiLimiter`). The grader materialises an ordinary `assignments` row, then
  `attachSubmissionToGrade` (transactional) stamps it with `published_assignment_id`
  + the submission telemetry + `submitted_at` and links `assignment_invites.assignment_id`
  — so the graded work is a normal journal entry the teacher reviews/edits/approves
  in the Журнал (approval feeds RAG as usual). Idempotent: re-grading returns the
  existing grade. `getSubmissionForTeacher` now LEFT JOINs the linked assignment so
  the review page shows the AI grade (letter + score + feedback + strengths/
  improvements) inline next to the provenance report; «Проверить» appears only
  while ungraded. **Holistic for v1** — published assignments don't yet carry
  criteria; criteria-scoped grading is a follow-up. Verified attach + grade-join
  against dev DB (synthetic, no AI call, zero residue); both typechecks clean,
  143/143 tests green.
- **Published assignments — provenance report (Feature Q4a).** The attestation
  payoff: a teacher opens a submitted work at `/published/:id/submissions/:inviteId`
  and sees the **process-of-creation facts** alongside the text. New pure
  `services/provenance.ts` (`computeProvenance`, 6 unit tests) turns the stored
  aggregate telemetry into transparent numbers — active editing time, wall-clock
  span, revision count, total chars, pasted chars + paste ratio, largest single
  insertion — with **no score and no verdict** (§5.1.3); the teacher judges.
  Owner-scoped query `getSubmissionForTeacher` + route
  `GET /api/published-assignments/:id/submissions/:inviteId` (renders the draft to
  text via `tiptapToText`, returns facts). Frontend `SubmissionReview` page shows
  the facts grid, a paste-ratio bar, neutral observations (e.g. «текст набран
  вручную, без вставок» vs «вставкой введено N% текста»), and the submission text;
  submitted students on the detail page now link through («Открыть работу →»).
  `ProvenanceFacts` type in `shared`. Verified owner-scoping + computation against
  dev DB (synthetic, zero residue); both typechecks clean, 143/143 tests green.
  Submitted works are now viewable + attested; **AI grading of them is Q4b**.
- **Published assignments — student writing surface (Feature Q3b).** Public,
  account-less page at `/write/:token` (outside the app shell) where a student
  writes their submission. **TipTap v3 MIT core** added to the frontend
  (`@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`) — first
  new dependency in this effort. State machine handles invalid link / not-yet-open
  / closed / already-submitted / consent-needed / writing. **Consent gate** (§5.1.2)
  explains the process is recorded before the editor activates. The composer
  captures **aggregate-only telemetry** (active time with a 30s idle threshold,
  revision count, total chars, and paste size via `editorProps.handlePaste`),
  debounced autosaves to `PUT /api/write/:token/draft` (with a ≤90s-cadence
  trajectory snapshot), and submits via `POST /submit`. Connectivity required —
  offline banner + disabled submit (§5.1.4). Dedicated `api/publicWrite.ts` axios
  client with **no JWT and no 401→login redirect** (a student has no account).
  `SubmissionTelemetry` re-exported through the frontend types barrel; minimal
  `.student-prose` editor styling + empty-state placeholder. Both typechecks
  clean, 137/137 tests green. Feature Q is now usable end-to-end (publish →
  student writes → submit); the teacher-facing provenance report is Q4.
- **Published assignments — public student writing backend (Feature Q3a).**
  Token-authenticated public route group at `/api/write/:token` (no teacher JWT —
  the per-student token is the credential; `generalLimiter` applied). `GET`
  returns the assignment definition + any saved draft + consent state (never
  leaks teacher/institution internals or the token); `POST /consent` records the
  consent gate (versioned); `PUT /draft` autosaves the TipTap doc + **aggregate-
  only** telemetry (raw stream never sent) with an optional trajectory snapshot;
  `POST /submit` finalises the invite after validating consent + non-empty draft.
  Writing is gated to `status='open'` assignments and blocked once submitted
  (strict publish mode — this is the only submission route). Submit deliberately
  does **not** create the gradeable `assignments` row — that materialisation is
  Q4, keeping ungraded rows out of history. New `lib/tiptapText.ts`
  (ProseMirror-JSON → plain text, 5 unit tests) and `SubmissionTelemetry` type in
  `shared/types`. Verified end-to-end against dev DB (synthetic, zero residue);
  typecheck clean, 137/137 tests green. Student UI (TipTap surface) is Q3b.
- **Published assignments — teacher publish UI (Feature Q2).** New teacher pages
  at `/published` (list + create) and `/published/:id` (detail): create an
  assignment definition (title, condition, due date), build a student roster
  (name + optional email → per-student tokenised link with copy-to-clipboard),
  track «N сдано из M», and drive status (draft → опубликовать → закрыть/
  возобновить). Plan-gated client-side via the new `publishedAssignments`
  feature flag (now surfaced on `/auth/me` + login plan payload and in
  `shared/types` PlanState.features) — Free tier sees a locked upgrade card;
  backend `checkFeatureAccess` is the real enforcement. Nav: «Задания» under
  Проверка. The shared student-link URL points at `/write/:token` (the public
  writing surface, built next in Q3 — links won't resolve until then). Both
  typechecks clean, 132/132 tests green.
- **Published assignments — publish backend (Feature Q1, Research.md §5.1).**
  First slice of process-of-creation attestation — the platform's answer to
  "won't we end up using AI to grade AI?". Migration `046_published_assignments`
  adds `published_assignments` (the teacher's assignment definition),
  `assignment_invites` (per-student writing workspace with a unique tokenised
  link, draft, aggregate-only telemetry, consent fields), and
  `submission_snapshots` (for §5.3 trajectory); `assignments` gains
  `published_assignment_id` / `submission_telemetry` / `submitted_at` (additive —
  existing rows behave unchanged, and a submitted published assignment becomes an
  ordinary gradeable row so the grading pipeline is untouched). Query layer
  `db/queries/publishedAssignments.ts` (definition CRUD scoped to owner, invite
  roster with per-definition submission counts, secure token generation) and
  teacher routes at `/api/published-assignments`, **gated to Pro/Institution**
  via a new `publishedAssignments` plan flag (Free stays on copy/paste grading).
  No UI yet (Q2); the public `/write/:token` student surface is Q3. Migration
  applied on dev (verified end-to-end with synthetic data, zero residue);
  typecheck clean, 132/132 tests green. Deviates from the literal §5.1.1 "no new
  tables" — see Research.md §5.1.5 for the three-table model and rationale.
- **Org structure — teacher assignment + per-unit roles (Feature P increment 1b).**
  Builds on the tree builder: a «Преподаватели и роли» section on
  `/institution/structure` lists every institution teacher with a kafedra
  selector (sets `primary_org_unit_id`; restricted to `department` units per
  §7.1) and their unit-role chips. Grant/revoke admin/head/viewer on any unit
  via an inline picker; roles cascade down the tree through the §7 authoriser.
  Backend adds to `routes/orgUnits.ts`: `GET /members`,
  `PUT /members/:id/primary`, `POST /roles`, `DELETE /roles` — all
  institution-scoped (teacher membership + unit ownership re-checked per op),
  with a **lockout guard** refusing removal of the last `admin` on the
  institution root. Queries: `listInstitutionMembersWithRoles` (json_agg of
  role rows per teacher), `isTeacherInInstitution`, `countRoleOnUnit`.
  Tree-builder icons swapped from Unicode glyphs to stroke-style SVGs matching
  the app vocabulary. Both typechecks clean, 132/132 unit tests green, member/
  role query stack smoke-tested against dev DB (aggregation, grant/revoke,
  count, scoping). Still on the legacy `requireInstitutionAdmin` guard pending
  the all-routes switch to `requireUnitRole`.
- **Org structure tree builder — IT-admin UI (Feature P increment 1).**
  First user-facing surface for the §7 org model. New institution-admin page at
  `/institution/structure` (nav: «Структура») to build the unit tree at flexible
  depth — add units of any creatable type (governance/admin_office/cluster/
  division/department) under any node, rename inline, delete. Each unit shows its
  subtree headcount. Deletes are refused while a unit still has child units or
  teachers (clear Russian error, no mass-orphaning). Backend: `routes/orgUnits.ts`
  mounted at `/api/institution/structure` (before `/api/institution` so it isn't
  shadowed), guarded by `requireInstitutionAdmin` and scoped to the admin's own
  institution (target unit ownership re-checked on every op; 404 not 403 so other
  institutions' unit ids never leak); `orgUnitValidation.ts`; query helpers
  `listOrgUnitsWithCounts` (subtree headcount per unit) + `getOrgUnitDependents`
  (delete guard). Frontend: `api/orgStructure.ts`, `pages/institution/
  InstitutionStructure.tsx`, route + nav wired. **Still on the legacy
  `requireInstitutionAdmin` guard** — the switch to the unit-scoped
  `requireUnitRole` authoriser happens for all admin routes together in a later
  increment, to avoid a half-migrated middleware layer. Query stack verified
  end-to-end against dev DB (path computation, counts, dependents, cleanup) via a
  throwaway integration test; both typechecks clean, 132/132 unit tests green.
- **Org structure model — backend foundation (Feature P, Research.md §7).**
  First, non-breaking increment of the canonical-typed org tree that replaces
  flat `institutions` + 3-value `teachers.role` scoping. Migration
  `045_org_structure.sql` adds `org_units` (self-referencing tree, canonical
  `type_code` ∈ institution/governance/admin_office/cluster/division/department,
  materialised `path` for ancestor/subtree queries) and `org_unit_roles`
  (per-unit admin/head/viewer, a teacher may hold many), plus
  `teachers.primary_org_unit_id` and an orthogonal `teachers.is_platform_admin`
  flag. Backfill is guarded + idempotent: one root `institution` unit per
  existing institution, a placeholder `department` under each with all the
  institution's teachers assigned, existing `institution_admin` → `admin` on
  the root unit, existing `platform_admin` → `is_platform_admin`. Query layer
  `db/queries/orgUnits.ts` (tree CRUD with atomic path computation, role
  assignment, single-query `teacherCanActOnUnit`); pure path semantics +
  in-memory evaluator in `services/orgScope.ts` (unit-tested, 12 cases);
  target authoriser `middleware/requireUnitRole.ts` (`requirePlatformAdmin`,
  `requireUnitRole(resolveUnit, roles)`). **Additive only** — legacy
  `teachers.role` + `requireRole` middleware are untouched and still guard
  every existing admin route; routes migrate onto the unit-scoped authoriser
  in later increments. `req.teacher` now carries `primary_org_unit_id` +
  `is_platform_admin`. Migration applied + verified on local dev (paths
  well-formed, zero mis-nested units, no unassigned institutional teachers,
  legacy `institution_admin` mapped 1:1, live authorizer SQL confirms
  ancestor-role inheritance); not yet run on staging/production.
- **Lecture presentations — typed slide layouts, KaTeX, Yandex Images.** The
  generator used to emit one shape (title + 3–6 bullets + notes) for every
  slide, which read as dry and uniform. New format: the model picks per slide
  from a typed set — `title` / `bullets` / `concept` (определение + раскрытие)
  / `formula` (KaTeX LaTeX block с подписью) / `comparison` (2–3 колонки) /
  `diagram` (изображение + подпись + пункты) / `discussion` (вопрос + подвопросы)
  / `summary`. Schema is a discriminated union in `shared/types.ts`; backend
  uses `chatJSON` with a JSON-mode prompt, validates+coerces each slide,
  demotes invalid `comparison` to `bullets`, accumulates inline `[N]` markers
  into a per-slide `citations[]` (also strips dead markers via the existing
  `filterCitations` utility). Migration `044_presentation_slides_json.sql`
  adds a `slides JSONB` column; legacy `generated_content` text stays for
  back-compat and is also written for new rows (copy-all fallback). **No
  backfill** — pre-migration presentations keep rendering via the original
  text parser.
- **Yandex Images picker on diagram slides.** Backend `services/yandexImages.ts`
  drives the Yandex Cloud Search API v2 image endpoint at
  `POST https://searchapi.api.cloud.yandex.net/v2/image/search`. Note: image
  search is **sync-only** — the corresponding `/v2/image/searchAsync` path
  doesn't exist and 404s (initial implementation guessed wrong by analogy
  with the async web endpoint). The sync call returns the result inline in
  one POST, base64-encoded under `rawData`, no operation polling. Same
  credentials as web grounding (`YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID`);
  picker disables itself if either is blank. Routes
  `POST /api/presentations/:id/slides/:idx/images` and
  `PATCH /api/presentations/:id/slides/:idx` expose search candidates and
  commit the chosen image (or clear it). Image selection never happens
  server-side — teacher curates from a 3-column thumbnail grid in
  `SlideImagePicker.tsx`, with attribution link + licensing disclaimer.
  Modal renders through `createPortal(modal, document.body)` so it can't be
  trapped off-screen by a transformed/contained ancestor; body scroll locks
  while open.
- **CLI verifier for the integration:** `npm run test:yandex-images -- "query"`
  (script at `backend/scripts/testYandexImages.ts`) checks env, calls the
  service, prints parsed candidates. Add `--raw` to dump the actual XML for
  parser debugging.
- **Rich-clipboard copy for slides — image actually pastes, not the URL.** The
  per-slide and "Скопировать всё" buttons now write `text/html` alongside
  `text/plain` via `ClipboardItem`. PowerPoint / Word / Google Slides /
  Google Docs read the HTML, download every `<img src>` and embed the bytes
  — so diagram slides paste as actual pictures, not as link text. As bonus
  side-effects, `comparison` slides paste as native `<table>`s and `bullets` /
  `summary` slides paste as native `<ul>`. New helpers
  `frontend/src/components/presentations/slideHtml.ts` (rendering) and
  `clipboard.ts` (writes both formats with a `writeText` fallback for
  browsers/permission contexts where `ClipboardItem` isn't available). Math
  delimiters (`$..$` / `$$..$$`) are preserved as text — the target apps'
  own equation editors can pick them up; we don't try to push KaTeX HTML
  across, which renders inconsistently outside the source DOM.
- **KaTeX rendering.** `katex` added as a frontend dep + `@types/katex` in
  devDeps; `katex.min.css` imported once in `main.tsx`. New `Math.tsx`
  exports `BlockMath` and `InlineText`; the latter tokenises mixed prose +
  `$inline$` / `$$block$$` math. `SlideContent.tsx` runs every text field
  through a `RichText` wrapper that handles both citation chips and math in
  one pass.
- A temporary `src/types/katex-shim.d.ts` ships so the typecheck passes
  before `npm install` runs; once installed, `@types/katex` supersedes it
  and the shim can be deleted.

### Fixed
- **Cyrillic upload filenames no longer arrive as mojibake.** Browsers send
  multipart Content-Disposition filenames as raw UTF-8 bytes; multer (and
  Express more generally) decode the header as Latin-1, so "Расчёт.docx"
  landed in `documents.file_name` as "Đ Đ°Ñ Ñ‘Ñ‚.docx" and then showed up
  garbled in the presentation sources list and elsewhere. New
  `repairUploadFilename` util in `middleware/fileValidation.ts` round-trips
  latin1→utf8 only when the input could plausibly be mojibake (every char
  ≤ 0xFF, round-trip yields no replacement chars) — pure ASCII and
  already-correct Cyrillic / real Latin-1 filenames pass through unchanged.
  Applied inside the multer `fileFilter` so every upload route gets the
  repair for free. One-shot backfill for existing rows via
  `npm run repair:filenames` (add `--dry-run` to preview).

### Changed
- **Registration form — phone is now optional + auto-masked.** Телефон is
  labelled «· необязательно» (name/university/email/password are required); the
  phone field auto-prefixes `+7`, strips a leading `8`/`7`, forces the first
  national digit to `9` (RU mobile), and formats live to `+7 (9XX) XXX-XX-XX`
  (`formatPhone` in `frontend/src/pages/Register.tsx`). The password field shows
  a live requirements checklist (8+ chars / uppercase A–Z / digit) that colours
  each rule grey→green(✓)/red(✕) as the user types.
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
