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

---

## Административный уровень (Administrative)

| # | Their wording (RU) | English reading | Maps to / reuses | Net-new |
|---|---|---|---|---|
| A1 | Анализ соотношения целей и задач содержанию и форматам в РПД | Consistency: do the РПД's goals/objectives match its content & teaching formats? | documents + chunks, chatJSON | РПД section parsing, analysis prompt |
| A2 | Анализ соотношения заявленных компетенций и содержанию/форматам в РПД | Consistency: do the declared competencies match the content & formats? | documents + chunks | competency model |
| A3 | Выявление задвоения содержания (одинаковых тем) в разных дисциплинах одного учебного плана | Detect duplicated topics across disciplines a single student takes | **embeddings + cosine `<=>` (already used for RAG)** | topic-level extraction |
| A4 | Последовательность расположения дисциплин (какая дисциплина — основа для следующей) | Prerequisite ordering: which discipline founds the next | chatJSON for semantic prereq detection | curriculum ordering + dependency graph |
| A5 | Анализ сквозного освоения компетенций (компетенция формируется несколькими дисциплинами); за какой блок отвечает каждая дисциплина | Cross-cutting competency mastery — read/visualise the matrix; each discipline's block of a shared competency | — | the competency matrix itself |

**A3 is the cheapest + most visible** → built first as the demo (see `docs/KNITU-feature-map.md`
and the `/curriculum` page). It's our existing RAG similarity pointed at discipline topics
instead of student submissions.
**A5 (the matrix) is the strategic anchor** — once competencies are modelled, A1/A2/A4/A5
and the whole student tier light up.

## Уровень преподавателя (Teacher)

| # | Their wording (RU) | English reading | Maps to / reuses | Net-new |
|---|---|---|---|---|
| T1 | Инструменты для разработки учебных материалов (тесты, проекты, задания, кейсы, презентации) | Build learning materials: tests, projects, assignments, cases, presentations | **Already have presentations, quizzes, topics** — extend with projects/cases/assignments | new generators (cases, projects, assignments) |
| T2 | Анализ модели обратной связи и запросов преподавателя для траектории проф. развития | Analyse the teacher's feedback patterns + requests → professional-development trajectory | We already store every approved grade + ai_feedback (RAG flywheel) | analytics layer over existing data |
| T3 | Рекомендации: на что обратить внимание, что усилить | Recommendations: what to focus on / strengthen | builds on T2 | recommendation prompt |
| T4 | Цифровой аватар/портрет (портфолио) преподавателя | Digital portrait / portfolio of the teacher | aggregation/view over T2/T3 | mostly a view |

Closest tier to what we already do. **T1 (extend the generator family)** is a fast win.
T2–T4 need enough grading volume to be meaningful.

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

1. **Foundation** — competency model + curriculum/РПД entities (unlocks most admin + all student features)
2. **Quick admin wins** — A3 (duplication, shipping now), then A1/A2 (РПД consistency)
3. **Teacher T1** — extend generator family (cases, projects, assignments) — fast, reuses existing engine
4. **Admin A4/A5** — sequencing + competency-matrix visualisation
5. **Student tier** — last; depends on 1 and raises privacy scope

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
