# КНИТУ — Feature Roadmap (Curriculum Intelligence)

> Source: meeting with the pro-rector and her team at КНИТУ (Kazan National Research
> Technological University), 2026-06-16. Follow-up review meeting: 2026-06-17.
> This file captures every idea they shared, the English reading of each, how it maps
> onto our existing architecture, and the order we'd build them in. Keep it updated as
> scope firms up — it is the working brief for this expansion, not a commitment.

## What this means strategically

GradeAssist today is a **teacher productivity tool** (grade → feedback → presentations →
topics → quizzes). The CLAUDE.md MVP explicitly excludes a student portal and a curriculum
admin layer. КНИТУ's wishlist turns the product into a **curriculum intelligence platform**
built on three entities we don't model yet:

1. **Competencies** (компетенции — УК / ОПК / ПК per ФГОС ВО, with индикаторы достижения)
2. **The учебный план + РПД** as first-class structured entities (today only `courses.syllabus_text`)
3. **Students** as longitudinal entities (today a student is just `student_name` on an assignment)

The keystone insight: **most admin-level asks are analyses over one structure — the
competency matrix (матрица компетенций)**. Model that well and Admin #1–#5 become queries
and DeepSeek analyses over it, not five separate systems. We already own the hard infra
(documents + document_chunks + pgvector + embeddings + chatJSON) — РПД are exactly the
"knowledge documents" our chunking pipeline was built for.

### The keystone data model (proposed, not yet built)

```
curriculum (учебный план)
  └── curriculum_disciplines (links existing courses, + semester/order/prerequisites)  → Admin #4
        ├── РПД document  (existing documents + document_chunks)                        → Admin #1, #2
        └── competency_links (discipline ↔ competency ↔ which block/indicator)          → Admin #5, #3

competencies (УК/ОПК/ПК + indicators)  → the matrix → Admin #5, all Student-tier

students
  └── assignments (exists) + student_competency_progress                               → Student #1, #2, #3
```

---

## Design principle: platform-generic, institution-configurable

КНИТУ is the first university exposed to these features, but **nothing here is built
for КНИТУ specifically** — and nothing should be. The rule for this whole expansion:

- **Build platform-generic.** The logic targets Russian higher education at large
  (ФГОС competencies УК/ОПК/ПК, РПД, учебный план — national concepts every RU
  university shares), never one institution. No university name, ID, or faculty quirk
  is hardcoded.
- **Make it institution-configurable.** Each institution brings *its own* data
  (its учебные планы, РПД, competency maps, students). The samples КНИТУ gives us are
  **test inputs**, not baked-in behaviour.
- **Never hardcode one university.** If КНИТУ's РПД format differs from another vuz's,
  that's handled by robust parsing/configuration, not by special-casing КНИТУ.

This is already true of A3 as shipped: it's scoped per teacher (`req.teacher.id`),
behind plain `authenticate`, with RU-academia-generic prompts — so every teacher at
every university gets it automatically.

**Tenancy vs. entitlement are separate axes.** "Works for all universities" (tenancy)
is settled — yes, always. *Which plan tier* unlocks a feature (entitlement) is a
separate decision. **Current decision: A3 is left open to all tiers** (including Free)
to maximise early-adoption value and frictionless demos. Admin/curriculum features are
framed as Institution-tier in `CLAUDE.md`; revisit gating to Institution-tier once
учебный план becomes a first-class institution entity and the admin role model lands.

### Promotion plan — when the curriculum suite moves to the university admin

The «university admin» role already exists — it's **`institution_admin`** (`requireInstitutionAdmin`
middleware, `institution_id` scoping, `/institution/*` routes). So this is a **relocation + gate**,
not a new role. Today A3/A2/L are teacher-scoped and open to all tiers — deliberately, to drive the
pilot. They move to the institution admin when **all three** conditions hold:

1. **A signed/committed institutional deal** — gating is a packaging act; do it when there's a buyer
   to gate *for*. Flipping earlier just locks out the people evaluating it.
2. **The учебный план is a first-class institution entity** (roadmap step 4 — competency model +
   curriculum/РПД entities). This is the real gate: until it exists, "the admin runs it across the
   whole curriculum" has nothing institution-wide to run on — only one teacher's courses.
3. **The client is provisioned as an institution** — institution record created, УМУ coordinator /
   pro-rector assigned `institution_admin`, teachers seated.

When triggered, the move is:

- **Re-scope (the real work):** queries shift from per-teacher (`req.teacher.id` over their courses)
  to per-institution (`req.teacher.institution_id` over the institution's учебный план/РПД). Only
  meaningful *after* the curriculum entity exists.
- **Relocate:** routes under `/api/institution/*` (or add `requireInstitutionAdmin` to the
  curriculum routes); surface in the institution-admin nav, off the teacher sidebar.
- **Gate (trivial — one line):** `requireInstitutionAdmin` and/or a `checkFeatureAccess('curriculumSuite')`
  flag in `planLimits.ts` (institution tier only).
- **Role split — they don't all land in the same place:** A3 (duplication) and A2 (conformance) are
  УМУ/admin work → `institution_admin`. **L (РПД-студия) is the teacher's job** (разработчик РПД) →
  stays teacher-accessible, just gated to the institution tier.

Sequence: **pilot open (now) → sign deal → build the curriculum entity (step 4) → re-scope + relocate
+ gate.** The gate is the *last* step, not the first; the data model is the bottleneck, not the gate.

---

## Административный уровень (Administrative)

| # | Their wording (RU) | English reading | Maps to / reuses | Net-new |
|---|---|---|---|---|
| A1 | Анализ соотношения целей и задач содержанию и форматам в РПД | Consistency: do the РПД's goals/objectives match its content & teaching formats? | documents + chunks, chatJSON | РПД section parsing, analysis prompt |
| A2 | Анализ соответствия РПД заявленным компетенциям (ОПК/ПК/УК) и целям/результатам | Score how well a syllabus covers the ОПК/ПК/УК + goals/outcomes it should fulfil | **= the grading engine** — competencies/goals = criteria, syllabus = "submission" → per-competency coverage + gaps + citations; reuses `CriterionScore` / strengths-improvements shape | MVP: competencies entered/selected (often already declared in the РПД); v2: + competency library |
| A3 | Выявление задвоения содержания (одинаковых тем) в разных дисциплинах одного учебного плана | Detect duplicated topics across disciplines a single student takes | **embeddings + cosine `<=>` (already used for RAG)** | topic-level extraction |
| A4 | Последовательность расположения дисциплин (какая дисциплина — основа для следующей) | Prerequisite ordering: which discipline founds the next | chatJSON for semantic prereq detection | curriculum ordering + dependency graph |
| A5 | Анализ сквозного освоения компетенций (компетенция формируется несколькими дисциплинами); за какой блок отвечает каждая дисциплина | Cross-cutting competency mastery — read/visualise the matrix; each discipline's block of a shared competency | — | the competency matrix itself |

**A3 is the cheapest + most visible** → built first as the demo (see `docs/KNITU-feature-map.md`
and the `/curriculum` page). It's our existing RAG similarity pointed at discipline topics
instead of student submissions.
**A5 (the matrix) is the strategic anchor** — once competencies are modelled, A1/A2/A4/A5
and the whole student tier light up.

**A2 is the next build, and it's the lever.** Structurally it *is* the student-work grading
engine pointed at a РПД: the ОПК/ПК/УК + goals become the criteria, the syllabus is the
"submission", and the output is per-competency coverage + gaps + citations (same
`CriterionScore` shape, even the thorough-mode confidence). It needs only a way to supply
the target competencies — so it ships *before* the full competency model, and building it is
exactly what **justifies** that model (→ A5, student tier). Together with A3 it forms a
**«РПД analysis suite»**: A3 looks *across* disciplines, A1/A2 *within* one. Requested at the
admin level by КНИТУ on 2026-06.

## Уровень преподавателя (Teacher)

| # | Their wording (RU) | English reading | Maps to / reuses | Net-new |
|---|---|---|---|---|
| T1 | Инструменты для разработки учебных материалов (тесты, проекты, задания, кейсы, презентации) | Build learning materials: tests, projects, assignments, cases, presentations | **Already have presentations, quizzes, topics** — extend with projects/cases/assignments | new generators (cases, projects, assignments) |
| T5 | (новое, запрос 2026-06) «РПД-студия» — ИИ помогает писать/обновлять содержание РПД под заданные ОПК/ПК/УК и цели | AI drafts/updates syllabus content aimed at target competencies + goals | generation engine (как презентации/тесты/темы) **+ the A2 check** | competency input; write→check→fix loop; AI drafts, teacher (разработчик РПД) is author of record |
| T2 | Анализ модели обратной связи и запросов преподавателя для траектории проф. развития | Analyse the teacher's feedback patterns + requests → professional-development trajectory | We already store every approved grade + ai_feedback (RAG flywheel) | analytics layer over existing data |
| T3 | Рекомендации: на что обратить внимание, что усилить | Recommendations: what to focus on / strengthen | builds on T2 | recommendation prompt |
| T4 | Цифровой аватар/портрет (портфолио) преподавателя | Digital portrait / portfolio of the teacher | aggregation/view over T2/T3 | mostly a view |

Closest tier to what we already do. **T1 (extend the generator family)** is a fast win.
T2–T4 need enough grading volume to be meaningful. **T5 («РПД-студия»)** pairs with the A2
check into a write→check→fix loop — the same generation pattern as our existing generators,
spec'd by the competency framework instead of a lecture topic. AI assists; the teacher stays
the author of record (same "AI never final" principle as grading).

## Уровень студента (Student)

| # | Their wording (RU) | English reading | Maps to / reuses | Net-new |
|---|---|---|---|---|
| S1 | Учебная аналитика — личная динамика формирования компетенций + учебные прогнозы | Learning analytics: personal competency-formation dynamics + forecasts | needs competency model + student record | student longitudinal record |
| S2 | Рекомендации что/когда исправить, усилить (баллы, расчёты) чтобы сдать сессию / сформировать компетенцию | What & when to fix to pass the session / form a competency | builds on S1 | forecasting logic |
| S3 | По письменным работам составить портрет студента + рекомендации по трекам (научный/производственный/лидерский/предпринимательский) | From written work, build a student portrait + recommend activity tracks | student written work already flows through grading | profiling + **152-ФЗ exposure** |
| S4 | Цифровой ассистент по подбору мероприятий под профиль из S3 | Assistant matching events/мероприятия to the S3 profile | — | events data source (КНИТУ integration) |

Highest value, highest cost, biggest pivot. Depends entirely on the admin-tier foundation
(competencies + students). **S3 raises real 152-ФЗ profiling questions — design deliberately.**
Open decision: **student-facing logins vs. teacher/admin dashboards _about_ students** — this
single choice drives auth, privacy scope, and effort.

---

## Suggested build order (dependency order, not their list order)

1. **A3** — duplication analysis (shipped); the cheapest, most visible demo
2. **A2 / A1 (РПД ↔ competencies/goals)** — the grading engine + a competency input. Ships
   before the full model and **justifies building it**. The pivotal next step.
3. **T5 «РПД-студия» + Teacher T1** — AI-assisted syllabus authoring (pairs with A2 into a
   write→check→fix loop) and the extended generator family
4. **Competency model + curriculum/РПД entities** — promoted from "input" to first-class data
   once A2/T5 prove demand (unlocks A4/A5 + the student tier)
5. **Admin A4/A5** — sequencing + competency-matrix visualisation
6. **Student tier** — last; depends on the competency model and raises privacy scope

## Open questions to bring to the meeting

- Can they share a **real учебный план + 2–3 РПД** as samples? РПД structure varies by faculty —
  we need real ones to build reliable parsing.
- Are competencies already in **structured form**, or only inside PDF РПД we'd have to extract?
- Student tier: **student-facing logins, or admin/teacher dashboards about students?** (privacy + scope driver)
- Any existing system to integrate/import from (ЛМС/Moodle, 1С:Университет, their own ИС)?
- Who **owns/buys** this — учебно-методическое управление? Shapes the admin role model.

## Cross-cutting concerns

- **Schema growth:** `competencies`, `curricula`, `curriculum_disciplines`,
  `competency_discipline_map`, `students`, `student_competency_progress`.
- **152-ФЗ:** the student tier (esp. S3 track-profiling) is real personal-data profiling —
  design privacy in from the start, keep data on Yandex infra in RF.
- **Roles:** admin-tier features likely belong to `institution_admin` / a new curriculum role;
  today courses are per-teacher, so the A3 demo runs teacher-scoped for now.
