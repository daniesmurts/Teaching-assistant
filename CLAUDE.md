# ИСПУМ — Project Context for Claude Code

## Identity

**ИСПУМ (ispum.ru)** — AI-powered educational platform for Russian university teachers. AI grading, lecture presentations, quizzes, academic programme analysis, and process-of-creation attestation for student work. B2B SaaS, freemium model. Russia-resident (Yandex Cloud, 152-ФЗ compliant).

---

## Single Source of Truth Files

These files contain the canonical feature/status/plan inventory. **Read them for context, update them in the same commit as any change.**

| File | What it holds | When to touch |
|---|---|---|
| [`FEATURES.md`](FEATURES.md) | Shipped/planned features by user role. Legend: ✅ / 🚧 / 📋 | Every user-facing feature add/change/remove |
| [`CHANGELOG.md`](CHANGELOG.md) | Engineering log — dated sections, [Unreleased] for current work | Every meaningful commit. Move [Unreleased] → dated on deploy |
| [`TODO.md`](TODO.md) | Ordered backlog of improvements + features with effort/impact/touches | Start items here; move to CHANGELOG when shipped |
| [`Research.md`](Research.md) | Design docs, legal constraints, patent claims, org-model spec | Reference for §5 (attestation), §6 (LTI), §7 (org tree) design decisions |

---

## Navigation Guide

```
ispum/
├── CLAUDE.md                      ← this file
├── FEATURES.md / CHANGELOG.md / TODO.md / Research.md
│
├── shared/types.ts                ← types shared by frontend + backend
│
├── frontend/src/
│   ├── App.tsx                    ← router setup
│   ├── main.tsx                   ← entry point
│   ├── pages/                     ← ~45 files, one per route
│   │   ├── Grading.tsx            ← main grading UI
│   │   ├── Presentations.tsx      ← slide generator
│   │   ├── Quizzes.tsx            ← quiz generator
│   │   ├── Materials.tsx / MaterialGenerator.tsx  ← hub + задании/кейсы/проекты
│   │   ├── Topics.tsx             ← research topic generator
│   │   ├── Curriculum.tsx / CurriculumConformance.tsx / CurriculumStudio.tsx
│   │   ├── History.tsx            ← grading journal
│   │   ├── Leadership.tsx / LeadershipTeacher.tsx
│   │   ├── PublishedAssignments.tsx / PublishedAssignmentDetail.tsx
│   │   ├── StudentWrite.tsx / SubmissionReview.tsx
│   │   ├── admin/                 ← platform admin pages
│   │   └── institution/           ← institution admin pages
│   ├── components/
│   │   ├── layout/                ← AppShell, Sidebar, TopBar, PublicHeader/Footer
│   │   ├── grading/               ← GradingForm, GradingResult, FeedbackEmail
│   │   └── ui/                    ← Icon, SuccessMark, Button, Card, etc.
│   ├── hooks/                     ← useAuth, useGrading, usePersistedState, usePlan
│   ├── api/                       ← ~25 API modules, client.ts with JWT interceptor
│   └── store/                     ← authStore, uiStore (Zustand)
│
├── backend/src/
│   ├── index.ts                   ← Express app, route mounts, audit + rate limit middleware
│   ├── routes/                    ← ~23 files
│   ├── middleware/
│   │   ├── authenticate.ts        ← JWT + SAML, resolves teacher + plan
│   │   ├── auditLog.ts            ← global mutation logger
│   │   ├── requireRole.ts         ← role gates
│   │   ├── requireUnitRole.ts     ← org-tree-based gates
│   │   ├── requireProgramAccess.ts
│   │   ├── checkPlan.ts           ← plan limit enforcement
│   │   ├── rateLimits.ts / errorHandler.ts / validate.ts / fileValidation.ts
│   ├── services/                  ← ~37 files
│   │   ├── grading.ts             ← core grading (gradeOnce is pure — no DB)
│   │   ├── longReview.ts          ← ВКР map-reduce (6 tiers)
│   │   ├── presentations.ts / quizzes.ts / topics.ts / tasks.ts
│   │   ├── syllabusAuthor.ts / syllabusReview.ts / curriculumAnalysis.ts
│   │   ├── programImport.ts / programAnalysis.ts / programReportPdf.ts
│   │   ├── provenance.ts / handout.ts
│   │   ├── confidence.ts / embeddings.ts / chunker.ts / documentExtractor.ts
│   │   ├── deepseek.ts / llm/     ← multi-provider registry
│   │   ├── yandexVision.ts / yandexImages.ts / yandexSearch.ts
│   │   ├── orgScope.ts / saml.ts / tbank.ts / renewals.ts / email.ts
│   │   └── evalHarness.ts         ← offline grading replay
│   └── db/
│       ├── schema.sql             ← full DDL (~25+ tables)
│       ├── connection.ts          ← pg Pool (max=25)
│       └── queries/               ← ~28 files
```

---

## Non-Negotiable Rules

### 1. Prompt injection sanitisation
Every user-supplied text entering an LLM prompt must pass through `sanitiseForPrompt()`.

### 2. Citation validation
Every AI-returned quote must be validated verbatim against the source before persistence via `validateCitation()`:
- Must exist in submission (case/whitespace-insensitive), ≥8 chars, ≤200 chars
- Never include `[стр. N]` markers
- Hallucinated quotes → null

### 3. AI never final
Every grade must be teacher-reviewed before becoming a training signal (`approved_at`, `status = 'approved'`).

### 4. Plan gating
Every paid feature route must call `canUseFeature(planTier, 'featureName')`. Never hardcode limits.

### 5. Approval history is append-only
`approved_revisions` gets a new row on every approve. The `assignments` row updates, but the audit trail survives.

### 6. Parameterised SQL only
Raw string interpolation in SQL is forbidden. Use `pool.query(text, params[])`.

### 7. RAG respects scope gates
Institution pool requires BOTH `institution.shared_rag_enabled` AND `courses.share_rag_with_institution`. Cross-teacher hits sanitise PII.

### 8. gradeOnce is pure
Shared by production and eval harness — no DB writes. Ensures replay validity.

### 9. Embeddings always via Yandex
Regardless of provider preference, embedding calls route through Yandex (vector-space compatibility constraint).

### 10. Global audit middleware
Every POST/PUT/PATCH/DELETE from an authenticated user with 2xx response is logged. Routes with richer audit data set `res.locals.selfAudited`.

---

## Architecture Invariants

### Multi-Provider LLM Registry
All AI calls go through `services/llm/registry.ts`:
1. Per-institution override → `DEFAULT_LLM_PROVIDER` env → DeepSeek
2. Silent fallback: non-DeepSeek failures retry once on DeepSeek
3. Calc grading always uses DeepSeek Reasoner
4. Abstracts via `LLMProvider` interface (chat / chatJSON / embed)

### Org Tree Authorisation (§7)
Resolves through `org_units` + `org_unit_roles`, not `teachers.role`:
- `org_unit_roles` (admin/edit/view) cascade down the tree
- `isInstitutionAdmin()` = admin on root unit **with `domain = 'all'`** — a
  domain-scoped admin grant (e.g. `domain='curriculum'`) is never institution
  admin, even though `role = 'admin'` alone would look the same
- `isPlatformAdmin` = flat flag on teacher
- Legacy `role` enum is a synced mirror; server-side reads the tree
- **Domain axis (§7.10):** a grant is (level: admin/edit/view) × (domain:
  platform/curriculum/teaching/…) × (unit subtree). `domain` defaults to
  `'all'`, which `services/accessScope.ts` expands across every concrete
  domain — every institution-root admin from the original backfill is
  unaffected. `middleware/requireDomain.ts` gates routes on a specific domain
  (e.g. РПД monitor + institution criteria/rubrics on `curriculum`) instead of
  full institution-root admin. Phase 1 (`curriculum`) is shipped; `teaching`
  and per-subtree query scoping for domain grants are deferred — see TODO
  Feature P(c).

### RAG Flywheel
1. Teacher approves grade → async embedding (Yandex, 1536-dim pgvector)
2. Next grading: cosine similarity → top 5 approved examples from same course + optional institution pool
3. Retrieved examples tracked in `rag_retrievals`

### ВКР / Long-Review Pipeline (>120k chars)
Map-reduce: split → analyse each chapter → synthesise → cross-section consistency → premise pass → recomputation → defence questions. Progress is pollable. Tolerates PM2 restart via persisted state (TODO #1 recommends pg-boss).

### Published Assignments + Attestation (§5.1)
Teacher publishes assignment → per-student tokenised link → student writes in TipTap (no account, consent gate) → aggregate-only telemetry (active time, revisions, paste ratio) → teacher sees neutral process report + grades. Designed in Research.md §5.

---

## Workflow

1. **Read context** — check FEATURES.md → CHANGELOG.md → TODO.md
2. **Update FEATURES.md** in the same commit as any feature change
3. **Update CHANGELOG.md** under [Unreleased] for every meaningful change
4. **Write tests** alongside code (prompt paths, validation, DB queries)
5. **Run relevant tests** before committing
