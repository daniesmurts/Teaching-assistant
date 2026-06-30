# GradeAssist — Claude Code System Prompt

## Project Overview

GradeAssist is a PWA (Progressive Web App) for university lecturers and teachers. It has two core features:

1. **AI Grading Engine** — teachers upload student assignment text, define a rubric, and the AI grades it with detailed per-criterion feedback. The teacher reviews, corrects if needed, and approves. Approved grades feed a RAG flywheel that makes future grading progressively more accurate.

2. **Lecture Presentation Generator** — teachers upload a course syllabus, define lecture parameters (topic, duration, learning goals, audience level), and the AI generates structured slide-by-slide content (title, bullets, speaker notes) they can copy into PowerPoint, Google Slides, or Canva. Output is formatted text, NOT an actual .pptx file — this is intentional for the MVP.

**Target market:** Russian university lecturers and teachers. The entire stack must be accessible inside Russian university networks without a VPN. No Google services, no Vercel, no Supabase — these are blocked at the network level in Russian institutions.

**Business model:** Freemium SaaS. Free tier (limited grades/month), Pro tier (unlimited + presentation generator), Institution tier (admin dashboard + bulk seats).

> **Maintenance rule — keep `FEATURES.md` and `CHANGELOG.md` current.**
> - `FEATURES.md` (repo root) is the single source of truth for shipped features by
>   user type. On any user-facing feature add/change/remove, update it in the **same
>   change** (move items between ✅/🚧/📋, add under the right role, bump "Last updated").
> - `CHANGELOG.md` (repo root) is the internal dated engineering log. Add new work
>   under **[Unreleased]** (Added/Changed/Fixed); when it deploys, move it to a dated
>   section. The *public* changelog (`frontend/src/pages/Changelog.tsx`) is curated
>   separately — promote only user-visible highlights there, in benefit language.
> - Treat both as part of "done," like tests or types.

---

## Tech Stack — Final Decisions (Do Not Change)

### Frontend
- **React 18** with **Vite** — fast builds, excellent PWA support
- **TypeScript** — strict mode enabled
- **React Router v6** — client-side routing
- **TanStack Query (React Query)** — server state, caching, loading states
- **Zustand** — lightweight client state (auth, UI state)
- **Tailwind CSS** — utility-first styling
- **Workbox** (via vite-plugin-pwa) — service worker, offline support, installable PWA

### Backend
- **Node.js** with **Express** — REST API
- **TypeScript** — same language both sides
- **pg** (node-postgres) — direct PostgreSQL driver, no ORM
- **bcryptjs** — password hashing
- **jsonwebtoken** — JWT auth, no third-party auth service
- **multer** — file upload handling
- **pm2** — process management on the VM

### Database
- **PostgreSQL 15** — self-hosted on Yandex Cloud VM
- **pgvector extension** — vector similarity search for RAG flywheel
- Raw SQL queries — no ORM (Prisma, Drizzle etc. are explicitly excluded)
- All queries in `/backend/src/db/queries/` — one file per entity

### AI
- **DeepSeek API** — primary model for grading and presentation generation
  - Model: `deepseek-chat` (DeepSeek V3) for generation tasks
  - Model: `deepseek-chat` with embeddings endpoint for vector generation
  - Base URL: `https://api.deepseek.com`
  - API key via environment variable `DEEPSEEK_API_KEY`
- All AI calls go through `/backend/src/services/deepseek.ts` — never call the API directly from routes

### Infrastructure (Yandex Cloud)
- **Yandex Cloud VM** — single VM hosts the Node.js API + PostgreSQL
- **Yandex Object Storage** — serves the built React PWA as a static site
- **Yandex CDN** — delivery + SSL termination for frontend
- **Yandex Certificate Manager** — free SSL certificates
- **Nginx** — reverse proxy on the VM, routes `/api/*` to Node, serves static fallback
- **Yandex DNS** — domain management

---

## Monorepo Structure

```
gradeassist/
├── CLAUDE.md                  ← this file
├── package.json               ← root workspace (npm workspaces)
├── .env                       ← never commit, gitignored
├── .env.example               ← commit this with placeholder values
├── .gitignore
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Register.tsx
│       │   ├── Dashboard.tsx
│       │   ├── Courses.tsx
│       │   ├── Grading.tsx
│       │   └── Presentations.tsx
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AppShell.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   └── TopBar.tsx
│       │   ├── grading/
│       │   │   ├── GradingForm.tsx
│       │   │   ├── GradingResult.tsx
│       │   │   └── FeedbackEmail.tsx
│       │   ├── presentations/
│       │   │   ├── PresentationForm.tsx
│       │   │   └── SlideContent.tsx
│       │   └── ui/
│       │       ├── Button.tsx
│       │       ├── Input.tsx
│       │       ├── Card.tsx
│       │       ├── Badge.tsx
│       │       └── LoadingSpinner.tsx
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useGrading.ts
│       │   └── usePresentations.ts
│       ├── api/
│       │   ├── client.ts      ← axios instance with JWT interceptor
│       │   ├── auth.ts
│       │   ├── grading.ts
│       │   ├── courses.ts
│       │   └── presentations.ts
│       ├── store/
│       │   ├── authStore.ts   ← Zustand: current teacher, token
│       │   └── uiStore.ts     ← Zustand: sidebar, toasts
│       └── types/
│           └── index.ts       ← shared TypeScript interfaces
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           ← Express app entry, starts server
│       ├── routes/
│       │   ├── auth.ts        ← POST /api/auth/register, /login, /me
│       │   ├── courses.ts     ← CRUD /api/courses
│       │   ├── rubrics.ts     ← CRUD /api/rubrics
│       │   ├── grading.ts     ← POST /api/grade, /api/grade/:id/approve
│       │   └── presentations.ts ← POST /api/presentations/generate
│       ├── middleware/
│       │   ├── authenticate.ts ← JWT verification middleware
│       │   ├── errorHandler.ts ← global error handler
│       │   └── validate.ts    ← request body validation
│       ├── services/
│       │   ├── deepseek.ts    ← ALL DeepSeek API calls live here
│       │   ├── grading.ts     ← grading business logic
│       │   ├── embeddings.ts  ← generate + store + retrieve embeddings
│       │   ├── presentations.ts ← presentation generation logic
│       │   └── email.ts       ← email draft formatting
│       └── db/
│           ├── connection.ts  ← pg Pool setup
│           ├── schema.sql     ← full database schema
│           └── queries/
│               ├── teachers.ts
│               ├── courses.ts
│               ├── rubrics.ts
│               ├── assignments.ts
│               └── presentations.ts
│
└── shared/
    └── types.ts               ← types used by both frontend and backend
```

---

## Database Schema

This is the authoritative schema. Always refer to this, never invent new tables.

> **§7 org tree — SHIPPED (migration 045).** `org_units` + `org_unit_roles`
> tables and `teachers.primary_org_unit_id` / `teachers.is_platform_admin`
> exist and are **authoritative for admin authorisation**. Full DDL below in
> *Admin System → Schema Additions*. The legacy `teachers.role` enum is
> **retained as a synced mirror** (kept in step by `syncRoleToTree`, still
> read by the role-based frontend route gate) — do not treat it as the
> source of truth server-side. The flat `institutions` table is unchanged;
> the tree is additive on top. Applied on dev; runs on prod at next deploy.

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Teachers
CREATE TABLE teachers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name        TEXT,
  university  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Courses
CREATE TABLE courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT,
  level         TEXT,              -- 'undergraduate_1', 'undergraduate_2', 'postgraduate', 'professional'
  syllabus_text TEXT,              -- extracted plain text of uploaded syllabus
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Rubric templates (reusable across assignments)
CREATE TABLE rubrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id   UUID REFERENCES courses(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  criteria    JSONB NOT NULL,      -- [{name, weight, description, max_score}]
  is_default  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Graded assignments (core data + RAG training signal)
CREATE TABLE assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  rubric_id         UUID REFERENCES rubrics(id) ON DELETE SET NULL,
  student_name      TEXT,
  student_email     TEXT,
  submission_text   TEXT NOT NULL,
  
  -- AI output (before teacher review)
  ai_score          INTEGER,
  ai_grade          TEXT,          -- 'A', 'B', 'C', 'D', 'F'
  ai_grade_label    TEXT,          -- 'Excellent', 'Good', etc.
  ai_feedback       TEXT,
  ai_criteria_scores JSONB,        -- [{name, score, feedback}]
  ai_strengths      TEXT[],
  ai_improvements   TEXT[],
  
  -- Approved output (after teacher review — this is the training signal)
  approved_score    INTEGER,
  approved_grade    TEXT,
  approved_feedback TEXT,
  approved_at       TIMESTAMPTZ,
  
  -- RAG vector — generated from submission_text after approval
  embedding         vector(1536),
  
  status            TEXT DEFAULT 'pending',  -- 'pending', 'approved', 'sent'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Index for vector similarity search
CREATE INDEX ON assignments USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Lecture presentations
CREATE TABLE presentations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id       UUID REFERENCES courses(id) ON DELETE SET NULL,
  lecture_number  INTEGER,
  topic           TEXT NOT NULL,
  duration_minutes INTEGER,
  audience_level  TEXT,
  learning_goals  TEXT[],
  style           TEXT,            -- 'theory_heavy', 'case_study', 'discussion_based'
  slide_count_target INTEGER,
  generated_content TEXT,          -- the full formatted slide-by-slide output
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Auth System

No third-party auth. Custom JWT implementation.

**Flow:**
1. Teacher registers with email + password
2. Password hashed with bcrypt (rounds: 12)
3. On login, verify password → issue JWT signed with `JWT_SECRET`
4. JWT payload: `{ id: string, email: string, iat: number, exp: number }`
5. JWT expiry: 7 days
6. Frontend stores token in `localStorage` under key `ga_token`
7. Every API request sends `Authorization: Bearer <token>` header
8. `authenticate` middleware verifies token on all protected routes

**Never use refresh tokens for MVP.** Keep it simple — 7-day expiry, re-login when expired.

---

## AI Service Architecture

All AI calls are centralised in `/backend/src/services/deepseek.ts`. No other file should import the DeepSeek SDK or make HTTP calls to the AI API directly.

### Grading prompt structure
The grading service builds prompts in this order:
1. System message — defines the grader persona
2. Few-shot examples — 3-5 similar approved assignments retrieved via pgvector
3. Current rubric — criteria with weights
4. Student submission
5. JSON output instruction

Response must always be parsed as JSON. If JSON parsing fails, retry once with an explicit "respond only with valid JSON" instruction appended.

### RAG flywheel — critical logic
After a teacher approves a grade:
1. Call DeepSeek embeddings endpoint on `submission_text`
2. Store the 1536-dimension vector in `assignments.embedding`
3. On next grading request for same course: query pgvector for top 5 most similar approved assignments using cosine similarity
4. Inject those 5 as few-shot examples in the grading prompt

The SQL for retrieval:
```sql
SELECT submission_text, approved_score, approved_grade, approved_feedback
FROM assignments
WHERE course_id = $1
  AND status = 'approved'
  AND embedding IS NOT NULL
ORDER BY embedding <=> $2
LIMIT 5;
```
Where `$2` is the embedding vector of the current submission.

### Presentation prompt structure
1. System message — expert curriculum designer
2. Course context — level, syllabus summary (first 500 words), previous lecture topics if available
3. Lecture parameters — topic, duration, goals, style, slide count
4. Output format instruction — strict slide-by-slide format with SLIDE N headers, bullet points, and speaker notes blocks

---

## API Endpoints

### Auth
```
POST /api/auth/register    { email, password, name, university }
POST /api/auth/login       { email, password } → { token, teacher }
GET  /api/auth/me          → { teacher }        [protected]
```

### Courses
```
GET    /api/courses              → Course[]      [protected]
POST   /api/courses              { name, code, level, syllabus_text }
GET    /api/courses/:id          → Course
PUT    /api/courses/:id          { name, code, level, syllabus_text }
DELETE /api/courses/:id
```

### Rubrics
```
GET    /api/rubrics              → Rubric[]      [protected]
POST   /api/rubrics              { name, course_id, criteria }
GET    /api/rubrics/:id          → Rubric
PUT    /api/rubrics/:id
DELETE /api/rubrics/:id
```

### Grading
```
POST /api/grading/grade
  Body: { submission_text, rubric_id, course_id, student_name?, student_email? }
  → { assignment_id, ai_score, ai_grade, ai_feedback, ai_criteria_scores, ai_strengths, ai_improvements }

POST /api/grading/:id/approve
  Body: { approved_score, approved_grade, approved_feedback }
  → { assignment }
  Side effect: generates embedding + stores in pgvector

POST /api/grading/:id/email
  Body: { tone? }  -- 'encouraging' | 'neutral' | 'direct'
  → { subject, body }

GET /api/grading/history
  Query: { course_id?, page?, limit? }
  → { assignments: Assignment[], total: number }
```

### Presentations
```
POST /api/presentations/generate
  Body: { course_id, lecture_number?, topic, duration_minutes, learning_goals, audience_level, style, slide_count_target? }
  → { presentation_id, generated_content }

GET /api/presentations
  Query: { course_id? }
  → Presentation[]

GET /api/presentations/:id
  → Presentation

DELETE /api/presentations/:id
```

---

## Coding Standards

### TypeScript
- Strict mode on both frontend and backend
- No `any` — use `unknown` and narrow properly
- All API response shapes defined as interfaces in `shared/types.ts`
- All database row shapes defined as interfaces in `backend/src/db/queries/*.ts`

### Backend patterns
- Routes only handle HTTP concerns — parse body, call service, return response
- Services contain all business logic — they call db queries and AI services
- DB query files contain only SQL — no business logic, no AI calls
- All async route handlers wrapped in try/catch — errors thrown to errorHandler middleware
- HTTP status codes: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 500 Internal Server Error

```typescript
// CORRECT route pattern
router.post('/grade', authenticate, async (req, res, next) => {
  try {
    const result = await gradingService.grade({
      ...req.body,
      teacherId: req.teacher.id
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// WRONG — never do business logic in a route
router.post('/grade', authenticate, async (req, res) => {
  const rubric = await db.query('SELECT...')  // ← wrong, use query files
  const result = await fetch('https://api.deepseek.com/...')  // ← wrong, use service
  res.json(result)
})
```

### Frontend patterns
- All API calls go through `frontend/src/api/` — never use fetch/axios directly in components
- All server state managed by TanStack Query — no useEffect for data fetching
- Loading and error states always handled — never leave UI blank on loading
- Forms use controlled inputs with local state — no form library for MVP
- No prop drilling beyond 2 levels — use Zustand or TanStack Query cache

### Error handling
- Backend: always return `{ error: string, details?: any }` shape for errors
- Frontend: TanStack Query `onError` shows toast notification via uiStore
- Never expose raw database errors or stack traces to the client in production

### Environment variables
Backend reads from `.env`:
```
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/gradeassist
JWT_SECRET=<random 64 char string>
DEEPSEEK_API_KEY=<your key>
NODE_ENV=development
```

Frontend reads from `.env` (Vite prefix):
```
VITE_API_BASE_URL=http://localhost:3000
```

---

## Build Order — What to Build First

Work in this order. Do not skip ahead.

**Phase 1 — Foundation (get something running end to end)**
1. Scaffold monorepo with npm workspaces
2. Set up Express backend with TypeScript, basic health check route `GET /api/health`
3. Set up Vite React frontend with TypeScript + Tailwind
4. Set up PostgreSQL connection in backend, run schema.sql
5. Implement auth: register, login, JWT middleware
6. Frontend login/register pages, token storage, auth-protected routing

**Phase 2 — Core grading feature**
7. Course CRUD (backend routes + frontend pages)
8. Rubric CRUD (backend routes + frontend components)
9. Grading endpoint — calls DeepSeek, returns result, saves to DB
10. Grading UI — the form, results display, approval flow
11. Feedback email generation endpoint + UI

**Phase 3 — RAG flywheel**
12. pgvector setup, embedding generation after approval
13. Retrieval — fetch similar examples before grading
14. Verify grading quality improves with examples present

**Phase 4 — Presentation generator**
15. Presentation generation endpoint
16. Presentation UI — form + slide content display + copy-per-slide
17. Presentation history

**Phase 5 — Polish + PWA**
18. PWA manifest + service worker via vite-plugin-pwa
19. Responsive mobile layout
20. Dashboard with usage stats
**Phase 6 - Document processing**
**Phase 7 - Admin System**
**Phase 8 - Pricing Tiers and Plan Enforcement**
**Phase 9 - Error Handling**
**Phase 10 Security**
**Phase 11 Email and password reset**
**Phase 12 Enviroment and reset**
---

## Key Business Logic Rules

1. **A grade is never sent directly to a student** — teacher must always approve first. The approve step is what triggers embedding generation.

2. **Presentation output is always text, never a file** — the generated content is formatted text only. No pptx export in MVP. The UI must make copy-per-slide easy.

3. **RAG examples are scoped to the course** — when retrieving similar past grades, always filter by `course_id`. Never mix examples across courses.

4. **Rubric is optional for grading** — if no rubric is provided, use the default holistic grading prompt. Never block grading because of missing rubric.

5. **All DeepSeek responses must be validated** — if the model returns malformed JSON, retry once with a stricter prompt before throwing an error to the user.

6. **Embeddings are generated asynchronously** — do not make the teacher wait for embedding generation after approval. Fire and forget the embedding job, return the approved assignment immediately.

---

## What This Is Not

Things GradeAssist deliberately does not build, on principle. Items that are
unbuilt but planned live in [TODO.md](TODO.md), not here. This is a forward-
looking principles list — not a snapshot of what hasn't shipped yet.

- **A GradeAssist-owned student account system** — no logins, no passwords, no
  cross-course student identity stored by us. Student *presence* is supported
  via two rails only: (a) ephemeral tokenised links for standalone deployments,
  (b) LTI 1.3 launch from the institution's LMS for institutional deployments.
  Student credentials are never stored by GradeAssist. See
  [Research.md](Research.md) §6 for the full policy and rationale.

- **Our own output-based plagiarism or AI-text classifier.** Antiplagiat.ru is
  the Russian institutional standard; integrate with it if a deployment needs
  it. Building a competing classifier is an unwinnable arms race and politically
  fragile. Note this does *not* preclude process-of-creation attestation
  ([Research.md](Research.md) §5.1) — that is a different surface (authorship
  process, not output classification) and is explicitly in scope.

- **Real-time collaboration on grading.** Teachers grade async; they do not
  co-grade live. Revisit only if institutional pilots specifically demand it.

- **A mobile native app.** The PWA is the supported mobile experience. Revisit
  only when churn data points at the PWA as the cause.

- **Direct delivery of feedback emails to students from the platform.** For
  grading feedback the platform generates the draft; the teacher sends it from
  their own email client. This preserves the teacher's role as the
  communicating authority and avoids the platform sitting in a regulated
  teacher↔student communication channel. *Transactional* email — registration,
  password reset, payment receipts, teacher invites, admin notifications — IS
  sent by the platform; that is a separate concern handled by the email
  service.

---

## Running Locally

```bash
# Install all workspace dependencies
npm install

# Start PostgreSQL (assumes local install)
# Run schema: psql -d gradeassist -f backend/src/db/schema.sql

# Start backend (from root)
npm run dev:backend    # runs on port 3000

# Start frontend (from root)
npm run dev:frontend   # runs on port 5173

# Or run both concurrently
npm run dev
```

Root `package.json` scripts:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "npm run dev --workspace=backend",
    "dev:frontend": "npm run dev --workspace=frontend",
    "build": "npm run build --workspace=frontend && npm run build --workspace=backend"
  }
}
```

---

## Design System

### Philosophy — Warm Editorial Minimalism

GradeAssist is used by academics who spend hours inside the app grading and preparing lectures. The design must be comfortable over time, not impressive for 5 minutes. The aesthetic direction is warm editorial minimalism — the visual language of high-quality academic publishing translated into a digital product. Content is the star. Interface chrome recedes. Every element that isn't content steps quietly out of the way.

**Three rules that govern every design decision:**
1. Warm over cold — parchment surfaces, amber accents, charcoal (not black). Never clinical white or corporate blue.
2. Content first — text is always the focus. UI never competes with what the teacher is reading or writing.
3. Comfort over time — generous whitespace, restrained contrast, no visual noise. The app must feel calm after 2 hours of grading.

---

### Fonts

Install both via Google Fonts. Add to `index.html`:

```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
```

Define in `tailwind.config.ts`:

```ts
fontFamily: {
  display: ['"Playfair Display"', 'Georgia', 'serif'],
  sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
  mono: ['"JetBrains Mono"', 'monospace'],
}
```

**Usage rules:**
- `font-display` — logo, page h1 headings, grade letters (A/B/C), lecture titles. Never for body text or UI labels.
- `font-sans` — everything else: navigation, labels, body text, buttons, form inputs, feedback text.
- `font-mono` — student submission text only. Makes it visually distinct from the UI chrome.

The serif/sans pairing is the single biggest differentiator from generic SaaS tools. A grade displayed in Playfair Display at large size looks authoritative and considered. Do not substitute other fonts.

---

### Color Tokens

Define all colors as CSS custom properties in `frontend/src/index.css`. Never hardcode hex values in components — always reference these tokens.

```css
:root {
  /* Surfaces */
  --color-bg:           #F7F5F0;  /* warm parchment — main page background */
  --color-surface:      #FFFFFF;  /* card and panel surfaces */
  --color-surface-warm: #FAF8F4;  /* slightly warm surface — submission pane, notes pane */

  /* Sidebar */
  --color-sidebar:      #1C1C1E;  /* deep charcoal */
  --color-sidebar-hover:#2C2C2E;
  --color-sidebar-active:#3A3A3C;

  /* Text */
  --color-ink:          #1A1A1A;  /* primary text — headings, body */
  --color-ink-secondary:#6B6560;  /* secondary text — labels, metadata */
  --color-ink-tertiary: #A09890;  /* tertiary text — hints, placeholders */
  --color-ink-inverse:  #F7F5F0;  /* text on dark sidebar */
  --color-ink-inv-muted:#9A9490;  /* muted text on dark sidebar */

  /* Accent — amber/gold. Used ONLY for: CTAs, active states, highlights, links */
  --color-amber:        #C8860A;
  --color-amber-light:  #FDF3DC;  /* amber background tint */
  --color-amber-mid:    #F4C55A;  /* amber on dark backgrounds */

  /* Semantic */
  --color-success:      #2D7D46;
  --color-success-bg:   #EBF7EF;
  --color-warning:      #9A6800;
  --color-warning-bg:   #FEF6E0;
  --color-danger:       #C0392B;
  --color-danger-bg:    #FDF0EE;
  --color-info:         #4F46E5;
  --color-info-bg:      #EEF2FF;

  /* Borders */
  --color-border:       rgba(0,0,0,0.08);   /* default — card borders */
  --color-border-mid:   rgba(0,0,0,0.12);   /* medium — button borders */
  --color-border-strong:rgba(0,0,0,0.18);   /* strong — focused inputs */

  /* Border radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
}
```

Define equivalent Tailwind tokens in `tailwind.config.ts`:

```ts
colors: {
  bg:           'var(--color-bg)',
  surface:      'var(--color-surface)',
  'surface-warm':'var(--color-surface-warm)',
  sidebar:      'var(--color-sidebar)',
  ink:          'var(--color-ink)',
  'ink-secondary':'var(--color-ink-secondary)',
  'ink-tertiary':'var(--color-ink-tertiary)',
  amber:        'var(--color-amber)',
  'amber-light':'var(--color-amber-light)',
  'amber-mid':  'var(--color-amber-mid)',
  success:      'var(--color-success)',
  'success-bg': 'var(--color-success-bg)',
  warning:      'var(--color-warning)',
  'warning-bg': 'var(--color-warning-bg)',
  danger:       'var(--color-danger)',
  'danger-bg':  'var(--color-danger-bg)',
  border:       'var(--color-border)',
  'border-mid': 'var(--color-border-mid)',
},
borderRadius: {
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)',
}
```

---

### Layout

**App shell — always this structure:**
```
┌─────────────────────────────────────────────┐
│  Sidebar (210px, dark)  │  Top bar (48px)   │
│                         ├───────────────────┤
│  Navigation             │                   │
│  items                  │  Page content     │
│                         │  area             │
│  ─────────────────────  │                   │
│  Teacher profile        │                   │
└─────────────────────────────────────────────┘
```

- Sidebar: fixed width 210px, full height, `var(--color-sidebar)` background
- Top bar: 48px height, `var(--color-surface)` background, `1px solid var(--color-border)` bottom border
- Content area: fills remaining space, `var(--color-bg)` background, scrollable
- Never allow content to stretch full viewport width — use `max-width: 960px` with `margin: 0 auto` for single-column pages (courses, settings). Grading and presentations use full width with internal split panes.

**Grading page — split pane layout:**
```
┌────────────────────┬──────────────────────────┐
│  Student           │  Top: Score + actions     │
│  submission        ├──────────────────────────┤
│  (38% width)       │  Tabs: Feedback /         │
│                    │  Criteria / Email         │
│  font-mono         ├──────────────────────────┤
│  surface-warm bg   │  Tab content (scrollable) │
│                    │                           │
└────────────────────┴──────────────────────────┘
```

**Presentation page — slide cards stacked vertically:**
Each slide card is a two-column grid inside:
- Left column: slide content (bullets)
- Right column: speaker notes, `surface-warm` background

---

### Component Patterns

**Page heading:**
```tsx
<h1 className="font-display text-2xl font-bold text-ink tracking-tight">
  Good morning, Dr. Ivanov
</h1>
<p className="font-sans text-sm text-ink-secondary mt-1">
  3 assignments pending review
</p>
```

**Stat card (dashboard metrics):**
```tsx
<div className="bg-surface border border-border rounded-lg p-4">
  <div className="text-xs font-sans font-medium text-ink-secondary mb-2">
    Graded this month
  </div>
  <div className="font-display text-3xl font-bold text-ink leading-none">
    47
  </div>
  <div className="text-xs font-sans text-ink-tertiary mt-1">
    +12 vs last month
  </div>
</div>
```

**Grade letter display (large, in results panel):**
```tsx
<div className="font-display text-5xl font-bold leading-none" style={{ color: gradeColor }}>
  B+
</div>
```
Grade colors: A → `var(--color-success)`, B → `var(--color-amber)`, C → `var(--color-warning)`, D/F → `var(--color-danger)`

**Primary button (approve, generate, submit):**
```tsx
<button className="px-4 py-2 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity">
  Approve grade
</button>
```

**Secondary button (cancel, back):**
```tsx
<button className="px-4 py-2 rounded-md border border-border-mid bg-transparent text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors">
  Back
</button>
```

**Score progress bar (criteria breakdown):**
```tsx
<div className="h-1 bg-border rounded-full overflow-hidden mt-1.5">
  <div
    className="h-full rounded-full transition-all duration-700 ease-out"
    style={{ width: `${score}%`, backgroundColor: scoreColor }}
  />
</div>
```

**Status badge:**
```tsx
// approved
<span className="text-xs font-sans font-medium bg-success-bg text-success px-2 py-0.5 rounded-sm capitalize">
  approved
</span>
// pending
<span className="text-xs font-sans font-medium bg-warning-bg text-warning px-2 py-0.5 rounded-sm capitalize">
  pending
</span>
// sent
<span className="text-xs font-sans font-medium bg-info-bg text-info px-2 py-0.5 rounded-sm capitalize">
  sent
</span>
```

**Section label (above content blocks):**
```tsx
<div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
  Detailed feedback
</div>
```

**Teacher avatar (initials circle):**
```tsx
<div className="w-8 h-8 rounded-full bg-amber flex items-center justify-center text-xs font-semibold text-white font-sans">
  АИ
</div>
```

**Sidebar nav item:**
```tsx
<div
  className={`flex items-center gap-2.5 px-3 py-2 rounded-md mb-0.5 cursor-pointer transition-colors ${
    active ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover'
  }`}
>
  <span className={`text-sm w-4 text-center ${active ? 'text-amber-mid' : 'text-ink-inv-muted'}`}>
    {icon}
  </span>
  <span className={`text-sm font-sans ${active ? 'font-medium text-ink-inverse' : 'font-normal text-ink-inv-muted'}`}>
    {label}
  </span>
</div>
```

**Content card (reusable wrapper):**
```tsx
<div className="bg-surface border border-border rounded-lg overflow-hidden">
  <div className="px-4 py-3 border-b border-border">
    {/* card header */}
  </div>
  <div className="p-4">
    {/* card content */}
  </div>
</div>
```

**Strengths / improvements grid:**
```tsx
<div className="grid grid-cols-2 gap-2.5">
  <div className="bg-success-bg border border-success/15 rounded-lg p-3">
    <div className="text-xs font-semibold text-success uppercase tracking-wide mb-2">Strengths</div>
    {strengths.map(s => (
      <div key={s} className="flex gap-1.5 text-xs text-success mb-1 leading-relaxed">
        <span className="flex-shrink-0">·</span><span>{s}</span>
      </div>
    ))}
  </div>
  <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
    <div className="text-xs font-semibold text-warning uppercase tracking-wide mb-2">To improve</div>
    {improvements.map(i => (
      <div key={i} className="flex gap-1.5 text-xs text-warning mb-1 leading-relaxed">
        <span className="flex-shrink-0">·</span><span>{i}</span>
      </div>
    ))}
  </div>
</div>
```

---

### Typography Scale

| Use | Font | Size | Weight | Color |
|---|---|---|---|---|
| Logo | font-display | 19px | 700 | ink-inverse (on sidebar) |
| Page h1 | font-display | 22-26px | 700 | ink |
| Grade letter (large) | font-display | 48-56px | 700 | semantic (success/amber/danger) |
| Card title | font-sans | 14-15px | 500 | ink |
| Body / feedback text | font-sans | 13.5-14px | 400 | ink, line-height 1.75 |
| Secondary labels | font-sans | 12-13px | 400 | ink-secondary |
| Section labels | font-sans | 10-11px | 600 | ink-tertiary, uppercase |
| Submission text | font-mono | 13px | 400 | ink, line-height 1.8 |
| Badges / status | font-sans | 11px | 500 | semantic |

---

### Motion

Transitions should be smooth and purposeful, never decorative:

```css
/* Standard transition — buttons, hover states */
transition: all 150ms ease;

/* Score bars — animate on mount */
transition: width 700ms cubic-bezier(0.4, 0, 0.2, 1);

/* Page content fade in */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: fadeIn 250ms ease forwards; }

/* AI result appearance */
@keyframes resultAppear {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.result-appear { animation: resultAppear 350ms ease forwards; }
```

No bounce, no spring physics, no decorative flourishes. Smooth and confident.

---

---

## Document Processing

### Two Document Types — Two Different Pipelines

Never treat assignment documents and knowledge documents the same way.

**Assignment documents** — student essays, reports, papers. Usually 500–3000 words. Needs full text, high fidelity. Extracted text goes directly to DeepSeek for grading.

**Knowledge documents** — syllabuses, course outlines, reading lists, lecture materials. Can be 5–80 pages. Never send the whole thing to DeepSeek. Chunk it, embed each chunk, store in pgvector, retrieve only what is relevant at query time.

---

### Libraries

Install on the backend:

```bash
npm install multer mammoth pdf-parse sharp
npm install --save-dev @types/multer @types/mammoth
```

- `multer` — handles multipart file uploads, stores to disk or memory buffer
- `mammoth` — extracts clean text from .docx files, handles Cyrillic well
- `pdf-parse` — extracts text layer from digital PDFs
- `sharp` — converts PDF pages to images for scanned document handling

Yandex Vision API handles OCR (scanned PDFs and images). No additional npm package needed — call the REST API directly.

---

### Supported File Types

```typescript
const SUPPORTED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',          // legacy .doc — convert to docx first
  'image/jpeg': 'image',
  'image/png': 'image',
} as const

const MAX_FILE_SIZE_MB = 20
```

---

### Extraction Pipeline

All document extraction lives in `/backend/src/services/documentExtractor.ts`. No other file handles raw document bytes.

```typescript
// backend/src/services/documentExtractor.ts

import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'

export async function extractText(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ text: string; method: 'text_layer' | 'ocr' | 'docx'; pageCount?: number }> {

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: fileBuffer })
    return { text: cleanText(result.value), method: 'docx' }
  }

  if (mimeType === 'application/pdf') {
    try {
      const result = await pdfParse(fileBuffer)
      const text = result.text.trim()

      // If pdf-parse returns very little text, it is likely a scanned PDF
      const wordsExtracted = text.split(/\s+/).filter(Boolean).length
      if (wordsExtracted < 50) {
        // Fall through to OCR
        return await extractViaOCR(fileBuffer, result.numpages)
      }

      return { text: cleanText(text), method: 'text_layer', pageCount: result.numpages }
    } catch {
      return await extractViaOCR(fileBuffer)
    }
  }

  if (mimeType.startsWith('image/')) {
    const text = await yandexVisionOCR(fileBuffer, mimeType)
    return { text: cleanText(text), method: 'ocr' }
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')              // normalize line endings
    .replace(/\r/g, '\n')
    .replace(/\f/g, '\n')                // remove form feeds (page breaks)
    .replace(/\t/g, ' ')                 // tabs to spaces
    .replace(/[ ]{2,}/g, ' ')            // collapse multiple spaces
    .replace(/\n{3,}/g, '\n\n')          // max 2 consecutive newlines
    .replace(/^\s+|\s+$/g, '')           // trim start and end
    .replace(/[^\S\n]+$/gm, '')          // trim trailing spaces per line
}
```

---

### OCR via Yandex Vision

Use for scanned PDFs and image uploads. Yandex Vision handles Cyrillic significantly better than Tesseract and is accessible within Russia without VPN.

```typescript
// backend/src/services/yandexVision.ts

async function yandexVisionOCR(fileBuffer: Buffer, mimeType: string = 'image/jpeg'): Promise<string> {
  const base64Content = fileBuffer.toString('base64')

  const response = await fetch(
    'https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze',
    {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${process.env.YANDEX_VISION_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderId: process.env.YANDEX_FOLDER_ID,
        analyze_specs: [{
          content: base64Content,
          features: [{
            type: 'TEXT_DETECTION',
            text_detection_config: {
              language_codes: ['ru', 'en'],
            },
          }],
        }],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Yandex Vision API error: ${response.status}`)
  }

  const data = await response.json()
  const pages = data.results?.[0]?.results?.[0]?.textDetection?.pages || []

  // Reconstruct text in reading order from blocks → lines → words
  return pages
    .flatMap((page: any) => page.blocks || [])
    .flatMap((block: any) => block.lines || [])
    .map((line: any) =>
      (line.words || []).map((word: any) => word.text).join(' ')
    )
    .join('\n')
}

// For scanned PDFs: convert each page to image then OCR
// Uses sharp + pdf-poppler or similar depending on server setup
async function extractViaOCR(
  pdfBuffer: Buffer,
  pageCount?: number
): Promise<{ text: string; method: 'ocr'; pageCount?: number }> {
  // For MVP: send whole PDF buffer directly to Yandex Vision
  // Vision API accepts PDFs natively up to a limit
  const text = await yandexVisionOCR(pdfBuffer, 'application/pdf')
  return { text, method: 'ocr', pageCount }
}
```

Add to `.env`:
```
YANDEX_VISION_API_KEY=your_api_key
YANDEX_FOLDER_ID=your_folder_id
```

---

### Token Budget — Assignment Documents

Most student assignments are within safe limits. Apply this before sending to DeepSeek:

```typescript
// backend/src/services/documentExtractor.ts

const ASSIGNMENT_TOKEN_LIMIT = 8000

export function prepareAssignmentText(text: string): {
  text: string
  wasTruncated: boolean
  originalWordCount: number
} {
  const words = text.split(/\s+/).filter(Boolean)
  const tokenEstimate = Math.ceil(text.length / 3.5) // Russian text is ~3.5 chars/token
  const originalWordCount = words.length

  if (tokenEstimate <= ASSIGNMENT_TOKEN_LIMIT) {
    return { text, wasTruncated: false, originalWordCount }
  }

  // Smart truncation: preserve intro + body + conclusion
  // Do not simply cut at the end — that loses the conclusion
  const targetWords = Math.floor(ASSIGNMENT_TOKEN_LIMIT * 3.5 / 5) // conservative
  const introWords   = Math.floor(targetWords * 0.15)
  const bodyWords    = Math.floor(targetWords * 0.65)
  const closingWords = Math.floor(targetWords * 0.20)

  const intro   = words.slice(0, introWords).join(' ')
  const body    = words.slice(
    Math.floor(words.length * 0.15),
    Math.floor(words.length * 0.15) + bodyWords
  ).join(' ')
  const closing = words.slice(-closingWords).join(' ')

  const truncated =
    `${intro}\n\n[...]\n\n${body}\n\n[...]\n\n${closing}` +
    `\n\n[Document truncated for processing. Original length: ${originalWordCount} words.]`

  return { text: truncated, wasTruncated: true, originalWordCount }
}
```

---

### Chunking — Knowledge Documents (Syllabuses, Materials)

Chunks are stored in pgvector and retrieved at query time. They are never sent wholesale to DeepSeek.

```typescript
// backend/src/services/chunker.ts

export interface DocumentChunk {
  documentId: string
  courseId: string
  chunkIndex: number
  chunkType: 'overview' | 'schedule' | 'assessment' | 'reading_list' | 'general'
  text: string
  tokenEstimate: number
}

const TARGET_CHUNK_TOKENS  = 500
const OVERLAP_TOKENS       = 50
const CHARS_PER_TOKEN      = 3.5

export function chunkDocument(
  text: string,
  documentId: string,
  courseId: string
): DocumentChunk[] {
  const targetChars  = TARGET_CHUNK_TOKENS  * CHARS_PER_TOKEN
  const overlapChars = OVERLAP_TOKENS       * CHARS_PER_TOKEN

  // Split on paragraph boundaries, not mid-sentence
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 30)

  const chunks: DocumentChunk[] = []
  let current = ''
  let chunkIndex = 0

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph

    if (candidate.length > targetChars && current.length > 0) {
      // Flush current chunk
      chunks.push(makeChunk(current, documentId, courseId, chunkIndex))
      chunkIndex++

      // Start next chunk with overlap from end of current
      const overlapText = current.slice(-overlapChars)
      current = `${overlapText}\n\n${paragraph}`
    } else {
      current = candidate
    }
  }

  if (current.trim()) {
    chunks.push(makeChunk(current, documentId, courseId, chunkIndex))
  }

  return chunks
}

function makeChunk(
  text: string,
  documentId: string,
  courseId: string,
  chunkIndex: number
): DocumentChunk {
  return {
    documentId,
    courseId,
    chunkIndex,
    chunkType: detectChunkType(text),
    text: text.trim(),
    tokenEstimate: Math.ceil(text.length / CHARS_PER_TOKEN),
  }
}

function detectChunkType(text: string): DocumentChunk['chunkType'] {
  const lower = text.toLowerCase()
  if (lower.includes('расписание') || lower.includes('schedule') || lower.includes('неделя') || lower.includes('week'))
    return 'schedule'
  if (lower.includes('оценивание') || lower.includes('assessment') || lower.includes('экзамен') || lower.includes('exam'))
    return 'assessment'
  if (lower.includes('литература') || lower.includes('reading') || lower.includes('библиография'))
    return 'reading_list'
  if (lower.includes('цели') || lower.includes('objectives') || lower.includes('описание курса'))
    return 'overview'
  return 'general'
}
```

---

### Database Schema Additions

Add these tables to `schema.sql`:

```sql
-- Uploaded documents (all types)
CREATE TABLE documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  file_name         TEXT NOT NULL,
  file_type         TEXT NOT NULL,        -- 'pdf' | 'docx' | 'image'
  mime_type         TEXT NOT NULL,
  file_size_bytes   INTEGER,
  storage_path      TEXT NOT NULL,        -- path in Yandex Object Storage
  document_type     TEXT NOT NULL,        -- 'assignment' | 'syllabus' | 'material'
  extracted_text    TEXT,                 -- full clean text after extraction
  extraction_method TEXT,                 -- 'text_layer' | 'ocr' | 'docx'
  token_estimate    INTEGER,
  page_count        INTEGER,
  processing_status TEXT DEFAULT 'pending', -- 'pending' | 'extracting' | 'chunking' | 'ready' | 'failed'
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Chunks from knowledge documents (syllabuses, materials)
CREATE TABLE document_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  chunk_type      TEXT,                   -- 'overview' | 'schedule' | 'assessment' | 'reading_list' | 'general'
  text            TEXT NOT NULL,
  token_estimate  INTEGER,
  embedding       vector(1536),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX ON document_chunks (course_id, chunk_type);
```

---

### File Upload Route

```typescript
// backend/src/routes/documents.ts

import multer from 'multer'
import { documentService } from '../services/documents'

const upload = multer({
  storage: multer.memoryStorage(),        // keep in buffer, we stream to Object Storage
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
    ]
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Unsupported file type'))
    }
  },
})

// POST /api/documents/upload
router.post('/upload', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    const { courseId, documentType } = req.body   // documentType: 'assignment' | 'syllabus' | 'material'
    const file = req.file

    if (!file) return res.status(400).json({ error: 'No file provided' })

    // Returns immediately with document ID
    // Processing happens asynchronously
    const document = await documentService.uploadAndProcess({
      fileBuffer:   file.buffer,
      fileName:     file.originalname,
      mimeType:     file.mimetype,
      fileSize:     file.size,
      teacherId:    req.teacher.id,
      courseId,
      documentType,
    })

    res.status(201).json(document)
  } catch (err) {
    next(err)
  }
})

// GET /api/documents/:id/status — poll for processing completion
router.get('/:id/status', authenticate, async (req, res, next) => {
  try {
    const document = await documentQueries.getById(req.params.id)
    if (!document || document.teacher_id !== req.teacher.id) {
      return res.status(404).json({ error: 'Document not found' })
    }
    res.json({
      id: document.id,
      status: document.processing_status,
      error: document.error_message,
      tokenEstimate: document.token_estimate,
    })
  } catch (err) {
    next(err)
  }
})
```

---

### Document Service — Full Processing Flow

```typescript
// backend/src/services/documents.ts

export async function uploadAndProcess(params: {
  fileBuffer:   Buffer
  fileName:     string
  mimeType:     string
  fileSize:     number
  teacherId:    string
  courseId:     string
  documentType: 'assignment' | 'syllabus' | 'material'
}): Promise<Document> {

  // 1. Store original file in Yandex Object Storage immediately
  const storagePath = `uploads/${params.teacherId}/${Date.now()}_${params.fileName}`
  await objectStorageService.upload(params.fileBuffer, storagePath, params.mimeType)

  // 2. Create DB record with 'pending' status
  const document = await documentQueries.create({
    teacherId:    params.teacherId,
    courseId:     params.courseId,
    fileName:     params.fileName,
    fileType:     getFileType(params.mimeType),
    mimeType:     params.mimeType,
    fileSizeBytes: params.fileSize,
    storagePath,
    documentType: params.documentType,
    status:       'pending',
  })

  // 3. Process asynchronously — do not await, return document immediately
  processDocument(document.id, params.fileBuffer, params.mimeType, params.documentType)
    .catch(err => documentQueries.setFailed(document.id, err.message))

  return document
}

async function processDocument(
  documentId: string,
  fileBuffer:  Buffer,
  mimeType:    string,
  documentType: 'assignment' | 'syllabus' | 'material'
): Promise<void> {

  // Extract text
  await documentQueries.setStatus(documentId, 'extracting')
  const { text, method, pageCount } = await extractText(fileBuffer, mimeType, '')
  const tokenEstimate = Math.ceil(text.length / 3.5)

  await documentQueries.update(documentId, {
    extractedText:    text,
    extractionMethod: method,
    tokenEstimate,
    pageCount,
  })

  // If knowledge document: chunk and embed
  if (documentType === 'syllabus' || documentType === 'material') {
    await documentQueries.setStatus(documentId, 'chunking')
    const document = await documentQueries.getById(documentId)
    const chunks = chunkDocument(text, documentId, document.course_id)

    for (const chunk of chunks) {
      const embedding = await deepseekService.embed(chunk.text)
      await chunkQueries.create({ ...chunk, embedding })
    }
  }

  await documentQueries.setStatus(documentId, 'ready')
}
```

---

### Frontend — Upload UX

Two states the UI must handle cleanly:

**Upload → processing state** — show a progress indicator immediately after upload. Poll `GET /api/documents/:id/status` every 2 seconds. Show different messages for `extracting` vs `chunking`:
- extracting: "Reading document..."
- chunking: "Indexing content..."
- ready: document is ready to use

**Assignment upload** — after `ready`, auto-populate the submission text field with `extractedText` so teacher can review before grading. Always make the text editable — teachers may want to correct OCR errors before grading.

**Knowledge document upload** — after `ready`, show a confirmation with chunk count and token estimate. The document is now queryable in the RAG pipeline. No text preview needed.

---

### Cost Reference

| Operation | Cost | Notes |
|---|---|---|
| mammoth DOCX extraction | Free | npm library |
| pdf-parse text extraction | Free | npm library |
| Yandex Vision OCR | ~$0.001/page | Russian market — best Cyrillic OCR |
| DeepSeek embedding per chunk | ~$0.0001 | Negligible at MVP scale |
| Yandex Object Storage | ~$0.02/GB/month | Original files preserved |

OCR is the only per-document cost with real money. At 100 assignments/month averaging 3 pages each, OCR costs approximately $0.30/month. Negligible.
___
---

## Admin System

### Role and scope model — see Research.md §7

Authorisation resolves through a **hierarchical org tree**, not through a
flat role enum. Each `institution` is the root of a tree of `org_units`
typed by `governance` / `admin_office` / `cluster` / `direction` /
`division` / `program` / `department` — full design in
[Research.md](Research.md) §7. `cluster` surfaces as «Полигруппа» in the
UI; `direction` is «Направление» (sits under a polygroup); `program` is
«Образовательная программа» (РОП is `head` on this unit). Teachers
belong to one `department` via `primary_org_unit_id`. Roles are scoped per
unit via `org_unit_roles(teacher_id, org_unit_id, role)` where
`role ∈ {admin, head, viewer}`.

A teacher may hold multiple roles across the tree — common in Russian
universities (a kafedra head is also a teacher; a deputy УМЦ head may
also head one cluster). The model accommodates this naturally; the
legacy enum cannot.

**Two operationally distinct admin concepts** both manifest as
`role='admin'` on different units in the tree, but they land in
different UIs and have different responsibilities:

- **Org / IT admin** — `admin` on the root `institution` unit. IT
  department contact; manages billing, LTI/SSO setup, AD sync, tree
  configuration. Not a daily user. Lands in a thin Settings →
  Organisation surface.
- **Academic admin** — `admin` on an `admin_office`, `division`, or
  `department` subtree. УМЦ head, institute head, kafedra head. Daily
  user. Lands in dashboards, rubric library, reports.

`viewer` covers governance-level read-only access (vice-rector
dashboards).

The **`platform_admin`** role — the product owner, full visibility
across all institutions — remains orthogonal to the tree. The tree is
per-institution and does not contain the platform owner; treat
`platform_admin` as a flat flag on the teacher record that short-circuits
unit-scope checks.

All admin and institution-admin UIs are part of the same React PWA — no
separate admin app. Routes are protected by middleware that walks the
tree (see *Role Middleware* below).

> **Status — SHIPPED (migration 045 + increment 3).** Admin authorisation is
> now resolved from the tree: `requireAdmin` reads `teachers.is_platform_admin`;
> `requireInstitutionAdmin` reads `admin` on the institution root unit (query
> `isInstitutionAdmin`). The 3-value `teachers.role` enum is **retained as a
> synced mirror** — the platform-admin teacher-management PATCH calls
> `syncRoleToTree` to keep `is_platform_admin` + admin-on-root in step with the
> enum, and the role-based **frontend** route gate still reads it. New
> server-side code should read the tree (`org_unit_roles` / `is_platform_admin`),
> not the enum. **Still institution-wide**, not yet per-subtree: a sub-unit
> admin is not an institution admin — true subtree-scoped admin routes (a
> division head limited to their division) are future work.

---

### Schema Additions

Add to `schema.sql`:

```sql
-- Institutions (universities, schools, companies)
CREATE TABLE institutions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  plan_tier   TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro' | 'institution'
  max_teachers INTEGER,                       -- NULL = unlimited
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add role and institution to teachers
ALTER TABLE teachers
  ADD COLUMN role           TEXT NOT NULL DEFAULT 'teacher',
  ADD COLUMN institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  ADD COLUMN plan_tier      TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN is_active      BOOLEAN NOT NULL DEFAULT TRUE;

-- role values: 'teacher' | 'institution_admin' | 'platform_admin'
-- plan_tier values: 'free' | 'pro' | 'institution'

-- Add global template flag to rubrics
ALTER TABLE rubrics
  ADD COLUMN is_global_template BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN template_subject   TEXT;
-- template_subject values: 'business' | 'economics' | 'law' | 'medicine' | 'engineering' | 'humanities' | 'general'

-- API usage log — source of truth for all cost and usage reporting
CREATE TABLE api_usage_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id     UUID REFERENCES teachers(id) ON DELETE SET NULL,
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  feature        TEXT NOT NULL,      -- 'grading' | 'presentation' | 'feedback_email' | 'embedding'
  model          TEXT NOT NULL,      -- 'deepseek-chat'
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  total_tokens   INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  cost_usd       NUMERIC(10, 6),     -- calculated at log time
  duration_ms    INTEGER,
  success        BOOLEAN NOT NULL DEFAULT TRUE,
  error_code     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON api_usage_log (teacher_id, created_at DESC);
CREATE INDEX ON api_usage_log (institution_id, created_at DESC);
CREATE INDEX ON api_usage_log (feature, created_at DESC);
CREATE INDEX ON api_usage_log (created_at DESC);

-- Teacher invites (institution admin flow)
CREATE TABLE teacher_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invited_by     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  token          TEXT NOT NULL UNIQUE,  -- secure random token in invite link
  accepted       BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
```

#### §7 additions — target state, ships with the org-structure migration

> Not yet implemented in code. See [Research.md](Research.md) §7 for the
> full design including the canonical `type_code` taxonomy, materialised-
> path scheme, and backfill plan. The DDL below is the authoritative
> target.

```sql
-- Canonical org-unit tree (one tree per institution)
CREATE TABLE org_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES org_units(id) ON DELETE CASCADE,
  type_code       TEXT NOT NULL,        -- 'institution' | 'governance' | 'admin_office' | 'cluster' | 'direction' | 'division' | 'program' | 'department'
  name            TEXT NOT NULL,        -- full Russian name
  short_name      TEXT,                 -- УМЦ, ОАиД, etc.
  external_code   TEXT,                 -- LMS / LTI / AD mapping key
  path            TEXT NOT NULL,        -- materialised path, e.g. '/inst-uuid/admin-uuid/dept-uuid/'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (institution_id, parent_id, name)
);

CREATE INDEX ON org_units (institution_id);
CREATE INDEX ON org_units (parent_id);
CREATE INDEX ON org_units (path text_pattern_ops);
CREATE INDEX ON org_units (institution_id, type_code);

-- Unit-scoped roles. A teacher may hold multiple rows.
CREATE TABLE org_unit_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  org_unit_id   UUID NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,          -- 'admin' | 'head' | 'viewer'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (teacher_id, org_unit_id, role)
);

CREATE INDEX ON org_unit_roles (teacher_id);
CREATE INDEX ON org_unit_roles (org_unit_id);

-- Teachers point at their primary department (kafedra)
ALTER TABLE teachers
  ADD COLUMN primary_org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;

-- Backfill plan (executed by the migration, not on every deploy):
--   1. For each existing institutions row, INSERT a root org_units row
--      with type_code='institution', parent_id=NULL.
--   2. INSERT a placeholder type_code='department' row under each root
--      and assign all teachers in that institution to it via
--      primary_org_unit_id.
--   3. For each teacher with role='institution_admin', INSERT
--      org_unit_roles(role='admin', org_unit_id=<institution root>).
--   4. teachers.role is retained but deprecated; new code reads from
--      org_unit_roles and the is_platform_admin flag (added separately
--      to preserve the orthogonal platform-owner concept).
```

---

### Role Middleware

Two layers, both shipped:

**1. Institution-wide convenience guards** (`backend/src/middleware/requireRole.ts`)
— the checks every existing admin/institution route already used, same export
names, now resolved from the tree instead of the enum:

```typescript
// requireAdmin — platform owner only (orthogonal flag, not a unit role)
export function requireAdmin(req, _res, next) {
  if (req.teacher?.is_platform_admin) return next()
  next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
}

// requireInstitutionAdmin — admin on the institution ROOT unit, or platform owner
export async function requireInstitutionAdmin(req, _res, next) {
  if (req.teacher?.is_platform_admin) return next()
  const instId = req.teacher?.institution_id
  if (instId && (await isInstitutionAdmin(req.teacher.id, instId))) return next()
  next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
}
```

`isInstitutionAdmin` is one indexed query: does the teacher hold `admin` on the
`type_code='institution'` root of that institution. Admin on a *sub-unit* is not
institution admin — institution-wide routes need root admin. (Per-subtree routes
that scope to a sub-unit are future work.)

**2. Per-unit authoriser** (`backend/src/middleware/requireUnitRole.ts`) — for
routes that act on a specific unit. Shifts from "does this teacher hold this
role" to "can this teacher act on THIS unit in this role," walking the
materialised path: a role on any ancestor unit grants it on descendants.

```typescript
import { canActOnUnit } from '../services/orgScope'

export const requirePlatformAdmin = (req, _res, next) =>
  req.teacher?.is_platform_admin ? next()
    : next(new ForbiddenError('Недостаточно прав...'))

export function requireUnitRole(
  resolveUnit: (req) => Promise<string | null>,   // returns org_unit_id
  roles: ('admin' | 'head' | 'viewer')[],
) {
  return async (req, _res, next) => {
    if (req.teacher?.is_platform_admin) return next()
    const unitId = await resolveUnit(req)
    if (!unitId) return next(new ForbiddenError('Недостаточно прав...'))
    const ok = await canActOnUnit(req.teacher.id, unitId, roles)
    if (!ok) return next(new ForbiddenError('Недостаточно прав...'))
    next()
  }
}
```

**Keeping the enum mirror in sync:** the platform-admin teacher-management PATCH
calls `syncRoleToTree(teacherId, role, institutionId)` whenever `role` changes —
`platform_admin` → `is_platform_admin=true`; `institution_admin` → grant
admin-on-root; anything else → clear the flag + revoke admin-on-root. This keeps
`teachers.role` (still read by the frontend route gate) agreeing with the tree.

`canActOnUnit` walks the path: given `(teacher_id, target_unit_id, roles)`
it joins `org_unit_roles` to `org_units` and returns true if any of the
teacher's role rows sits on a unit whose `path` is a prefix of the target
unit's `path` and whose `role` is in `roles`. Single SQL query, hot path
should land under 1ms with the indexes on `org_units(path text_pattern_ops)`
and `org_unit_roles(teacher_id)`.

---

### API Usage Logging

Log every DeepSeek call without exception. This is the source of truth for your own cost awareness and for all admin dashboard charts. Never skip logging even if the call fails — log failures too.

```typescript
// backend/src/services/deepseek.ts
// Wrap every API call with this pattern

interface CallContext {
  teacherId:     string
  institutionId?: string
  feature:       'grading' | 'presentation' | 'feedback_email' | 'embedding'
}

async function callDeepSeek(
  messages: Message[],
  system:   string,
  context:  CallContext
): Promise<string> {
  const startTime = Date.now()
  let success = true
  let errorCode: string | undefined

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model:    'deepseek-chat',
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      errorCode = `HTTP_${response.status}`
      throw new Error(`DeepSeek API error: ${response.status}`)
    }

    const data = await response.json()

    // Log successful call
    await usageLogQueries.create({
      teacherId:     context.teacherId,
      institutionId: context.institutionId,
      feature:       context.feature,
      model:         'deepseek-chat',
      inputTokens:   data.usage.prompt_tokens,
      outputTokens:  data.usage.completion_tokens,
      costUsd:       calculateCost(data.usage.prompt_tokens, data.usage.completion_tokens),
      durationMs:    Date.now() - startTime,
      success:       true,
    })

    return data.choices[0].message.content

  } catch (err) {
    // Log failed call
    await usageLogQueries.create({
      teacherId:     context.teacherId,
      institutionId: context.institutionId,
      feature:       context.feature,
      model:         'deepseek-chat',
      inputTokens:   0,
      outputTokens:  0,
      costUsd:       0,
      durationMs:    Date.now() - startTime,
      success:       false,
      errorCode:     errorCode || 'UNKNOWN',
    }).catch(() => {})  // never let logging failure crash the request
    throw err
  }
}

// DeepSeek V3 pricing at time of writing — update if rates change
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCostPer1M  = 0.14   // USD per 1M input tokens
  const outputCostPer1M = 0.28   // USD per 1M output tokens
  return (
    (inputTokens  / 1_000_000) * inputCostPer1M +
    (outputTokens / 1_000_000) * outputCostPer1M
  )
}
```

---

### Platform Admin Routes

All under `/api/admin/*`. All require `requireAdmin` middleware.

```
GET  /api/admin/overview
     → { totalTeachers, activeToday, activeThisWeek, activeThisMonth,
         newThisMonth, totalGradesAllTime, totalPresentationsAllTime }

GET  /api/admin/usage/daily?days=30
     → [{ date, totalTokens, inputTokens, outputTokens, costUsd,
           gradeCount, presentationCount, embeddingCount }]

GET  /api/admin/usage/by-feature?from=&to=
     → [{ feature, totalTokens, costUsd, callCount, avgTokensPerCall }]

GET  /api/admin/usage/by-teacher?limit=20&orderBy=cost
     → [{ teacherId, teacherName, email, institution, totalTokens,
           costUsd, gradeCount, lastActive }]

GET  /api/admin/teachers?page=&limit=&search=&status=
     → { teachers: [...], total }

GET  /api/admin/teachers/:id
     → { teacher, usageSummary, recentActivity }

PATCH /api/admin/teachers/:id
     Body: { role?, planTier?, isActive? }
     → { teacher }

GET  /api/admin/errors?days=7
     → [{ date, feature, errorCode, count }]

GET  /api/admin/rubrics/templates
     → Rubric[]

POST /api/admin/rubrics/templates
     Body: { name, criteria, templateSubject }
     → Rubric

PUT  /api/admin/rubrics/templates/:id
     → Rubric

DELETE /api/admin/rubrics/templates/:id

GET  /api/admin/institutions
     → Institution[]

POST /api/admin/institutions
     Body: { name, planTier, maxTeachers }
     → Institution

PATCH /api/admin/institutions/:id
     Body: { name?, planTier?, maxTeachers? }
     → Institution
```

---

### Institution Admin Routes

All under `/api/institution/*`. Require `requireInstitutionAdmin`. All queries scoped to `req.teacher.institution_id` — never return data from other institutions.

```
GET  /api/institution/overview
     → { totalTeachers, activeThisMonth, totalGrades, totalPresentations }

GET  /api/institution/usage/daily?days=30
     → [{ date, totalTokens, gradeCount, presentationCount }]
     Note: return tokens/counts, NEVER costUsd — do not expose platform costs

GET  /api/institution/teachers
     → Teacher[]  (scoped to institution)

PATCH /api/institution/teachers/:id
     Body: { isActive? }     — institution admin cannot change roles or plan tier
     → Teacher

POST /api/institution/teachers/invite
     Body: { email }
     → { invite_id, expires_at }

DELETE /api/institution/teachers/invite/:id

GET  /api/institution/rubrics
     → Rubric[]  (institution-shared + global templates)

POST /api/institution/rubrics
     Body: { name, criteria, templateSubject }
     → Rubric  (is_global_template: false, scoped to institution via teacher_id)
```

---

### Frontend Routes

Add to React Router config:

```tsx
// Platform admin — only render if role === 'platform_admin'
<Route path="/admin" element={<RequireRole role="platform_admin"><AdminLayout /></RequireRole>}>
  <Route index element={<AdminOverview />} />
  <Route path="usage" element={<AdminUsage />} />
  <Route path="teachers" element={<AdminTeachers />} />
  <Route path="teachers/:id" element={<AdminTeacherDetail />} />
  <Route path="rubrics" element={<AdminRubrics />} />
  <Route path="institutions" element={<AdminInstitutions />} />
  <Route path="errors" element={<AdminErrors />} />
</Route>

// Institution admin — render if role === 'institution_admin' or 'platform_admin'
<Route path="/institution" element={<RequireRole role="institution_admin"><InstitutionLayout /></RequireRole>}>
  <Route index element={<InstitutionOverview />} />
  <Route path="usage" element={<InstitutionUsage />} />
  <Route path="teachers" element={<InstitutionTeachers />} />
  <Route path="rubrics" element={<InstitutionRubrics />} />
</Route>
```

`RequireRole` component:

```tsx
// frontend/src/components/auth/RequireRole.tsx
function RequireRole({ role, children }: { role: string | string[], children: ReactNode }) {
  const { teacher } = useAuthStore()
  const allowed = Array.isArray(role) ? role : [role]

  // Platform admin can access everything
  if (teacher?.role === 'platform_admin') return <>{children}</>
  if (allowed.includes(teacher?.role || '')) return <>{children}</>

  return <Navigate to="/app/dashboard" replace />
}
```

---

### Platform Admin Pages — What Each One Shows

**AdminOverview** — four stat cards at the top (total teachers, active this week, grades today, today's cost in USD), then two charts side by side: daily grade volume (line chart, 30 days) and daily token spend (bar chart, 30 days). Below that a table of the 10 most recently registered teachers.

**AdminUsage** — date range picker, three tabs: by day, by feature, by teacher. By-teacher tab sortable by cost DESC to immediately see who is burning tokens. Show running month-to-date cost total prominently at the top so you always know where you stand.

**AdminTeachers** — searchable paginated table with columns: name, email, institution, plan, role, grades, last active, status. Click any row to open `AdminTeacherDetail`. Inline toggle to activate/deactivate. Inline dropdown to change plan tier.

**AdminTeacherDetail** — full profile: usage chart over time, all grades listed, all presentations listed, error history, ability to edit role and plan.

**AdminRubrics** — two tabs: Global Templates and All Rubrics. Global templates tab lets you create, edit, delete templates that all teachers see as starting points. Each template tagged with subject area. All rubrics tab is read-only visibility into every rubric on the platform.

**AdminErrors** — grouped by feature and error code, last 7 days. Shows if a particular DeepSeek error is spiking. Table of individual recent errors with teacher context so you can follow up if needed.

**AdminInstitutions** — list of institutions with plan tier, teacher count, usage summary. Create institution, change plan tier, set max teacher count.

---

### Institution Admin Pages — What Each One Shows

**InstitutionOverview** — stat cards: teachers in institution, active this month, total grades, total presentations. Simple usage chart showing grade volume over time. No cost figures exposed.

**InstitutionUsage** — token and grade counts over time by teacher within the institution. Helps department head see who is using the platform and how much.

**InstitutionTeachers** — list of teachers in institution with last active date and grade count. Activate/deactivate toggle. Invite new teacher button — sends invite email with registration link pre-scoped to the institution.

**InstitutionRubrics** — rubrics shared across the institution. Institution admin can create new shared rubrics. All teachers in the institution see these alongside their personal rubrics and global templates. Clearly labelled by source: Personal / Institution / Platform Template.

---

### Global Template Rubrics — Teacher UX

When a teacher creates a new rubric, show a template picker before the blank form:

```
┌─────────────────────────────────────────────┐
│  Start from a template — or create blank    │
│                                             │
│  [Business Strategy]  [Economics]  [Law]    │
│  [Medicine]  [Engineering]  [Humanities]    │
│                                             │
│  ──────────── or ────────────               │
│             [Start blank]                   │
└─────────────────────────────────────────────┘
```

Selecting a template pre-fills the rubric form with the global template criteria. The teacher edits and saves — the saved version belongs to them, the template is unchanged. This improves rubric quality across the platform and means the RAG flywheel gets more comparable grading examples to learn from.

---

### Build Order for Admin

**Phase 1 — build before first teacher signs up:**
- `api_usage_log` table and logging in `deepseek.ts`
- Role column on teachers table
- `requireAdmin` and `requireInstitutionAdmin` middleware
- Single admin page: today's cost + teacher count + grade count
- Seed your own account as `platform_admin` directly in the database

**Phase 2 — build when you have 10+ teachers:**
- Full `AdminUsage` page with charts
- `AdminTeachers` list with activate/deactivate
- `AdminRubrics` with global template creation
- `AdminErrors` log

**Phase 3 — build when landing first institutional client:**
- `institutions` table and institution routes
- `InstitutionAdmin` role and all institution pages
- Teacher invite flow with email
- Institution-scoped rubric sharing

---

---

## Pricing Tiers and Plan Enforcement

### Three Tiers

```
free          → individual teacher, limited usage, no cost
pro           → individual teacher, unlimited, flat monthly/annual fee
institution   → multi-seat, annual invoice, institutional admin features
```

`plan_tier` is stored on the `teachers` table. It is the single source of truth for what a teacher can do. Never derive permissions from anything else.

---

### Feature Matrix

| Feature | free | pro | institution |
|---|---|---|---|
| Grades per month | 20 | Unlimited | Unlimited |
| Presentations per month | 3 | Unlimited | Unlimited |
| Active courses | 3 | Unlimited | Unlimited |
| Rubrics | 5 | Unlimited | Unlimited |
| Document upload (PDF/DOCX/image) | ✗ | ✓ | ✓ |
| RAG flywheel (few-shot examples) | ✗ | ✓ | ✓ |
| Feedback email generation | ✗ | ✓ | ✓ |
| Grading history | 30 days | Full | Full |
| Presentation history | ✗ | ✓ | ✓ |
| Shared institution rubrics | ✗ | ✗ | ✓ |
| Institution admin panel | ✗ | ✗ | ✓ |
| Teacher invite flow | ✗ | ✗ | ✓ |
| Watermark on output | ✓ | ✗ | ✗ |
| Billing cadence | Free | Monthly or annual | Annual invoice |

---

### Plan Limits Config

Single source of truth for all limits. Never hardcode limit values anywhere else in the codebase — always import from this file.

```typescript
// backend/src/config/planLimits.ts

export const PLAN_LIMITS = {
  free: {
    gradesPerMonth:        20,
    presentationsPerMonth: 3,
    maxCourses:            3,
    maxRubrics:            5,
    documentUpload:        false,
    ragFlywheel:           false,
    emailGeneration:       false,
    historyDays:           30,
    presentationHistory:   false,
    watermark:             true,
  },
  pro: {
    gradesPerMonth:        Infinity,
    presentationsPerMonth: Infinity,
    maxCourses:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    emailGeneration:       true,
    historyDays:           Infinity,
    presentationHistory:   true,
    watermark:             false,
  },
  institution: {
    gradesPerMonth:        Infinity,
    presentationsPerMonth: Infinity,
    maxCourses:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    emailGeneration:       true,
    historyDays:           Infinity,
    presentationHistory:   true,
    watermark:             false,
  },
} as const

export type PlanTier   = keyof typeof PLAN_LIMITS
export type PlanLimits = typeof PLAN_LIMITS[PlanTier]

export function getLimits(tier: PlanTier): PlanLimits {
  return PLAN_LIMITS[tier]
}

export function canUseFeature(
  tier: PlanTier,
  feature: keyof PlanLimits
): boolean {
  return Boolean(PLAN_LIMITS[tier][feature])
}
```

---

### Schema Additions

Add to `schema.sql`:

```sql
-- Add subscription fields to teachers table
ALTER TABLE teachers
  ADD COLUMN plan_started_at  TIMESTAMPTZ,
  ADD COLUMN plan_expires_at  TIMESTAMPTZ,
  ADD COLUMN subscription_id  TEXT;   -- external payment provider reference

-- Pre-aggregated monthly usage counters
-- Used for fast limit checks — single row lookup, no COUNT query on every request
-- Reset at start of each calendar month via cron job
CREATE TABLE usage_counters (
  teacher_id               UUID PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  grades_this_month        INTEGER NOT NULL DEFAULT 0,
  presentations_this_month INTEGER NOT NULL DEFAULT 0,
  month_year               TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- Upsert helper used by grading and presentation services
-- Call after every successful AI generation
CREATE OR REPLACE FUNCTION increment_usage(
  p_teacher_id UUID,
  p_feature    TEXT   -- 'grade' | 'presentation'
) RETURNS VOID AS $$
DECLARE
  current_month TEXT := TO_CHAR(NOW(), 'YYYY-MM');
BEGIN
  INSERT INTO usage_counters (teacher_id, month_year,
    grades_this_month, presentations_this_month)
  VALUES (p_teacher_id, current_month,
    CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END,
    CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END)
  ON CONFLICT (teacher_id) DO UPDATE SET
    -- Reset counter if month has changed
    grades_this_month = CASE
      WHEN usage_counters.month_year != current_month THEN
        CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END
      ELSE
        usage_counters.grades_this_month +
        CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END
    END,
    presentations_this_month = CASE
      WHEN usage_counters.month_year != current_month THEN
        CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END
      ELSE
        usage_counters.presentations_this_month +
        CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END
    END,
    month_year = current_month,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
```

---

### Enforcement Middleware

All plan enforcement lives in `/backend/src/middleware/checkPlan.ts`. Never enforce limits inline inside route handlers or services.

```typescript
// backend/src/middleware/checkPlan.ts

import { getLimits, canUseFeature, PlanTier } from '../config/planLimits'

// Check monthly usage limits (grades, presentations)
export function checkMonthlyLimit(
  feature: 'gradesPerMonth' | 'presentationsPerMonth'
) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const tier   = req.teacher.plan_tier as PlanTier
    const limits = getLimits(tier)
    const limit  = limits[feature]

    if (limit === Infinity) return next()

    // Fast lookup from pre-aggregated counter
    const counter = await usageCounterQueries.getOrCreate(req.teacher.id)

    // Reset if month has changed
    const currentMonth = new Date().toISOString().slice(0, 7)  // 'YYYY-MM'
    const used = counter.month_year !== currentMonth ? 0
      : feature === 'gradesPerMonth'
        ? counter.grades_this_month
        : counter.presentations_this_month

    if (used >= limit) {
      return res.status(403).json({
        error:     'Monthly limit reached',
        code:      'PLAN_LIMIT_REACHED',
        feature,
        limit,
        used,
        upgrade:   true,   // frontend uses this flag to show upgrade prompt
      })
    }

    // Attach remaining to request for optional use downstream
    req.planUsage = { used, limit, remaining: limit - used }
    next()
  }
}

// Check boolean feature access
export function checkFeatureAccess(
  feature: 'documentUpload' | 'ragFlywheel' | 'emailGeneration' | 'presentationHistory'
) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!canUseFeature(req.teacher.plan_tier as PlanTier, feature)) {
      return res.status(403).json({
        error:   'Feature not available on your plan',
        code:    'FEATURE_NOT_IN_PLAN',
        feature,
        upgrade: true,
      })
    }
    next()
  }
}

// Check resource count limits (courses, rubrics)
export function checkResourceLimit(
  resource: 'courses' | 'rubrics',
  limitKey: 'maxCourses' | 'maxRubrics'
) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const tier   = req.teacher.plan_tier as PlanTier
    const limits = getLimits(tier)
    const limit  = limits[limitKey]

    if (limit === Infinity) return next()

    const count = resource === 'courses'
      ? await courseQueries.countByTeacher(req.teacher.id)
      : await rubricQueries.countByTeacher(req.teacher.id)

    if (count >= limit) {
      return res.status(403).json({
        error:   `${resource} limit reached for your plan`,
        code:    'RESOURCE_LIMIT_REACHED',
        resource,
        limit,
        current: count,
        upgrade: true,
      })
    }

    next()
  }
}
```

---

### Applying Middleware to Routes

```typescript
// routes/grading.ts
router.post('/grade',
  authenticate,
  checkMonthlyLimit('gradesPerMonth'),           // ← blocks if limit reached
  async (req, res, next) => { ... }
)

router.post('/:id/email',
  authenticate,
  checkFeatureAccess('emailGeneration'),          // ← blocks free tier
  async (req, res, next) => { ... }
)

// routes/presentations.ts
router.post('/generate',
  authenticate,
  checkMonthlyLimit('presentationsPerMonth'),
  async (req, res, next) => { ... }
)

// routes/documents.ts
router.post('/upload',
  authenticate,
  checkFeatureAccess('documentUpload'),           // ← blocks free tier
  upload.single('file'),
  async (req, res, next) => { ... }
)

// routes/courses.ts
router.post('/',
  authenticate,
  checkResourceLimit('courses', 'maxCourses'),    // ← blocks at 3 for free
  async (req, res, next) => { ... }
)

// routes/rubrics.ts
router.post('/',
  authenticate,
  checkResourceLimit('rubrics', 'maxRubrics'),    // ← blocks at 5 for free
  async (req, res, next) => { ... }
)
```

RAG flywheel is checked inside the grading service, not as middleware — it degrades gracefully rather than blocking:

```typescript
// services/grading.ts
async function grade(params) {
  let examples = []

  // Only retrieve RAG examples for Pro and Institution
  if (canUseFeature(teacher.plan_tier as PlanTier, 'ragFlywheel')) {
    examples = await embeddingService.getSimilarExamples(
      params.submissionText,
      params.courseId
    )
  }

  // Free tier grades without examples — still works, just less accurate
  const result = await deepseekService.gradeAssignment({
    submissionText: params.submissionText,
    rubric:         rubric,
    examples,       // empty array for free tier
  })

  // Increment usage counter after successful grade
  await db.query('SELECT increment_usage($1, $2)', [params.teacherId, 'grade'])

  return result
}
```

Similarly, watermark is applied in the grading service after the result is returned:

```typescript
// services/grading.ts
if (canUseFeature(teacher.plan_tier as PlanTier, 'watermark')) {
  // Append to generated feedback text
  result.detailed_feedback += '\n\n---\nGenerated with GradeAssist free tier · gradeassist.ru'
}
```

---

### GET /api/auth/me — Include Plan Data

The `/me` endpoint must return enough plan information for the frontend to render limits and locks without extra API calls:

```typescript
// Response shape for GET /api/auth/me
{
  id:         string
  email:      string
  name:       string
  university: string
  role:       'teacher' | 'institution_admin' | 'platform_admin'
  plan: {
    tier:             'free' | 'pro' | 'institution'
    expiresAt:        string | null
    gradesUsed:       number
    gradesLimit:      number           // 20 for free, null for unlimited
    presentationsUsed: number
    presentationsLimit: number | null
    features: {
      documentUpload:     boolean
      ragFlywheel:        boolean
      emailGeneration:    boolean
      presentationHistory: boolean
    }
  }
}
```

Frontend stores this in Zustand `authStore` on login and after any plan change. Components read from this store to decide what to render — never make a separate API call to check plan status.

---

### Frontend — Limit and Lock UI Patterns

Four patterns used consistently across the app. Never show a raw API error for plan limits.

**1 — Soft usage warning (shown at 80% of monthly limit):**
```tsx
// Shown in top bar when grades_used >= 16 (80% of 20)
{isPlanWarning && (
  <div className="flex items-center gap-2 text-xs font-sans
                  bg-warning-bg text-warning px-3 py-1.5 rounded-md">
    <span>{gradesUsed} of {gradesLimit} free grades used this month</span>
    <button className="font-medium text-amber underline">
      Upgrade to Pro →
    </button>
  </div>
)}
```

**2 — Hard limit wall (action button disabled when at limit):**

Check remaining quota from `authStore` on page load. Disable the submit button before the teacher tries — do not let them fill in the form and fail at submission.

```tsx
const { plan } = useAuthStore()
const atGradeLimit = plan.gradesLimit !== null && plan.gradesUsed >= plan.gradesLimit

<button
  onClick={handleGrade}
  disabled={atGradeLimit || grading}
  title={atGradeLimit ? 'Monthly limit reached — upgrade to continue' : undefined}
>
  {atGradeLimit ? 'Grade limit reached' : 'Grade assignment'}
</button>

{atGradeLimit && (
  <p className="text-xs text-warning font-sans mt-2">
    You have used all 20 free grades this month. 
    <button className="text-amber font-medium ml-1">Upgrade to Pro</button>
    {' '}for unlimited grading.
  </p>
)}
```

**3 — Feature lock (feature exists but is shown as locked):**

Never hide locked features — show them as locked so the teacher knows what they are missing.

```tsx
// Email generation button — locked on free tier
{plan.features.emailGeneration ? (
  <button onClick={handleGenerateEmail}>
    Generate feedback email
  </button>
) : (
  <div className="relative">
    <button disabled className="opacity-50 cursor-not-allowed">
      Generate feedback email
    </button>
    <span className="absolute -top-1 -right-1 text-xs bg-amber-light
                     text-amber px-1.5 py-0.5 rounded-sm font-sans font-medium">
      Pro
    </span>
  </div>
)}
```

**4 — Upgrade modal (triggered by `upgrade: true` in API response or lock click):**

Simple modal, not a full page. Two options: monthly and annual. Annual prominently shows the saving.

```
┌───────────────────────────────────────────┐
│  Upgrade to GradeAssist Pro               │
│                                           │
│  ✓ Unlimited grading                      │
│  ✓ Unlimited presentations                │
│  ✓ Document upload (PDF, Word, images)    │
│  ✓ AI improves with every grade           │
│  ✓ Feedback email generation              │
│  ✓ Full grading history                   │
│                                           │
│  [₽990 / month]   [₽7,900 / year  −33%]  │
│                                           │
│        [Continue to payment]              │
└───────────────────────────────────────────┘
```

---

### Zustand Auth Store — Plan Shape

```typescript
// frontend/src/store/authStore.ts

interface PlanState {
  tier:              'free' | 'pro' | 'institution'
  expiresAt:         string | null
  gradesUsed:        number
  gradesLimit:       number | null   // null = unlimited
  presentationsUsed: number
  presentationsLimit: number | null
  features: {
    documentUpload:      boolean
    ragFlywheel:         boolean
    emailGeneration:     boolean
    presentationHistory: boolean
  }
}

interface AuthState {
  teacher:  Teacher | null
  token:    string | null
  plan:     PlanState | null
  setAuth:  (teacher: Teacher, token: string) => void
  clearAuth: () => void
  updatePlan: (plan: PlanState) => void
}
```

Helper hooks for clean component code:

```typescript
// frontend/src/hooks/usePlan.ts

export function usePlan() {
  const plan = useAuthStore(s => s.plan)

  return {
    tier:           plan?.tier ?? 'free',
    isFree:         plan?.tier === 'free',
    isPro:          plan?.tier === 'pro',
    isInstitution:  plan?.tier === 'institution',
    can:            (feature: keyof PlanState['features']) =>
                      plan?.features[feature] ?? false,
    gradesRemaining: plan?.gradesLimit === null
                      ? Infinity
                      : (plan?.gradesLimit ?? 20) - (plan?.gradesUsed ?? 0),
    presentationsRemaining: plan?.presentationsLimit === null
                      ? Infinity
                      : (plan?.presentationsLimit ?? 3) - (plan?.presentationsUsed ?? 0),
    atGradeLimit:   plan?.gradesLimit !== null &&
                    (plan?.gradesUsed ?? 0) >= (plan?.gradesLimit ?? 20),
    nearGradeLimit: plan?.gradesLimit !== null &&
                    (plan?.gradesUsed ?? 0) >= Math.floor((plan?.gradesLimit ?? 20) * 0.8),
  }
}
```

Usage in components:

```tsx
const { can, atGradeLimit, nearGradeLimit, isFree } = usePlan()

// Check feature access
{can('emailGeneration') && <EmailButton />}

// Check limit
<GradeButton disabled={atGradeLimit} />

// Show warning
{nearGradeLimit && <UsageWarningBanner />}
```

---

### Payment — Russia-Specific

Do not integrate Stripe or PayPal. Neither works reliably in Russia.

**Individual Pro subscriptions — Tinkoff acquiring:**
- Tinkoff has the most developer-friendly payment API for Russian card processing
- Supports recurring payments (подписка) via card binding
- API docs: https://www.tbank.ru/kassa/dev/payments/
- On successful payment webhook: call `PATCH /api/admin/teachers/:id` to update `plan_tier` to `'pro'` and set `plan_expires_at`

**Alternative for individuals — SBP (Система быстрых платежей):**
- QR code based, supported by all major Russian banks
- Better conversion than card for many Russian users
- No recurring — teacher pays monthly manually or you send a payment link

**Institutional clients — manual invoice:**
- Russian universities and companies require a formal счёт-фактура (invoice)
- They pay by bank transfer (банковский перевод)
- You manually set `plan_tier = 'institution'` in the admin panel after payment clears
- Only automate this when you have more institutional clients than you can manage manually

**Pricing — always display in RUB:**
- Pro monthly:  ₽990/month
- Pro annual:   ₽7,900/year (saves ₽3,980 — show this saving explicitly)
- Institution:  ₽600/seat/month billed annually, minimum 5 seats (₽3,000/month minimum)

---

### Important Rules

- Never enforce limits in the frontend only. Frontend checks are for UX (disabling buttons). Backend middleware is the actual enforcement. Both must exist.
- Never hardcode limit values in components, route handlers, or services. Always import from `planLimits.ts`.
- The `upgrade: true` flag in 403 responses is the contract between backend and frontend for showing upgrade prompts. Always include it on plan-related 403s.
- When a teacher's `plan_expires_at` is in the past, treat them as `free` tier. Check this in the `authenticate` middleware and downgrade in-memory if expired — do not rely on a cron job to flip the database field.
- Never expose cost figures (USD or RUB) to teachers or institution admins. Usage is shown in grades/presentations count only. Cost visibility is platform admin only.
- The `usage_counters` table is the fast path for limit checks. The `api_usage_log` table is the source of truth for admin reporting. Both must stay in sync — increment `usage_counters` in the same transaction as logging to `api_usage_log` where possible.

### Important Rules

- Never expose `cost_usd` to institution admins or teachers — only to platform admin. Showing your DeepSeek costs to users reveals your margin and pricing strategy.
- Institution admin can deactivate teachers but cannot delete them, change plan tier, or change roles. Only platform admin can do those.
- Global template rubrics can only be created and deleted by platform admin. Institution admins can create institution-scoped rubrics only.
- All institution admin queries must include a `WHERE institution_id = $1` filter using `req.teacher.institution_id`. Never trust an institution_id from the request body for scoping — always derive it from the authenticated teacher's record.
- Platform admin routes must never be discoverable from the teacher-facing UI. No links, no navigation items. Access only via direct URL `/admin`.
___
---

## Error Handling and Logging

### Philosophy

Errors fall into two categories. Operational errors are expected — a teacher hits a plan limit, a file is the wrong type, DeepSeek returns malformed JSON. These are handled gracefully and surfaced to the user with clear messaging. Programmer errors are unexpected — a null reference, a missing database column, an unhandled promise rejection. These are logged with full context and never exposed to the user.

Never let an unhandled error reach the client as a raw stack trace or database message. Never silently swallow an error without logging it.

---

### Error Classes

Define custom error classes that carry HTTP status, a user-facing message, and a machine-readable code. All services throw these — never throw plain `Error` objects from business logic.

```typescript
// backend/src/errors/AppError.ts

export class AppError extends Error {
  constructor(
    public message:    string,    // user-facing — can be shown in the UI
    public statusCode: number,    // HTTP status
    public code:       string,    // machine-readable — frontend switches on this
    public details?:   unknown,   // optional extra context, never shown to user
    public upgrade?:   boolean,   // true if this error should trigger upgrade prompt
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace(this, this.constructor)
  }
}

// Convenience subclasses — use these throughout the codebase
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND')
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN')
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details)
  }
}

export class PlanLimitError extends AppError {
  constructor(message: string, code: string) {
    super(message, 403, code, undefined, true)
  }
}

export class AIServiceError extends AppError {
  constructor(message = 'AI service unavailable — please try again') {
    super(message, 503, 'AI_SERVICE_ERROR')
  }
}

export class DocumentProcessingError extends AppError {
  constructor(message: string) {
    super(message, 422, 'DOCUMENT_PROCESSING_ERROR')
  }
}
```

---

### Global Error Handler

Single Express error handler registered last in `index.ts`. All errors from all routes flow through here.

```typescript
// backend/src/middleware/errorHandler.ts

import { AppError } from '../errors/AppError'
import { logger } from '../lib/logger'

export function errorHandler(
  err:  Error,
  req:  Request,
  res:  Response,
  next: NextFunction
): void {

  // Known operational error — handle gracefully
  if (err instanceof AppError) {
    // Log at warn level — expected, not a system problem
    logger.warn({
      code:       err.code,
      message:    err.message,
      statusCode: err.statusCode,
      path:       req.path,
      method:     req.method,
      teacherId:  (req as AuthRequest).teacher?.id,
    })

    res.status(err.statusCode).json({
      error:    err.message,
      code:     err.code,
      upgrade:  err.upgrade ?? false,
      ...(process.env.NODE_ENV === 'development' && { details: err.details }),
    })
    return
  }

  // Unknown programmer error — log with full context
  logger.error({
    message:   err.message,
    stack:     err.stack,
    path:      req.path,
    method:    req.method,
    body:      sanitiseBody(req.body),     // strip sensitive fields before logging
    teacherId: (req as AuthRequest).teacher?.id,
  })

  // Never expose internal error details to client in production
  res.status(500).json({
    error: 'An unexpected error occurred. Please try again.',
    code:  'INTERNAL_ERROR',
  })
}

// Remove sensitive fields before logging request bodies
function sanitiseBody(body: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ['password', 'token', 'apiKey', 'submission_text']
  return Object.fromEntries(
    Object.entries(body ?? {}).map(([k, v]) => [
      k,
      sensitive.includes(k) ? '[REDACTED]' : v,
    ])
  )
}
```

Register in `index.ts` — must be after all routes:

```typescript
// backend/src/index.ts
app.use('/api/auth',          authRouter)
app.use('/api/courses',       coursesRouter)
app.use('/api/grading',       gradingRouter)
app.use('/api/presentations', presentationsRouter)
app.use('/api/documents',     documentsRouter)
app.use('/api/admin',         adminRouter)
app.use('/api/institution',   institutionRouter)

// Error handler last
app.use(errorHandler)
```

---

### Logger

Use `pino` — fast, structured JSON logging, works well with PM2 on the Yandex VM.

```bash
npm install pino pino-pretty
```

```typescript
// backend/src/lib/logger.ts

import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,   // production: raw JSON — easier to parse with log tools
  base: {
    env: process.env.NODE_ENV,
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'password_hash', 'token', '*.password', '*.token'],
    censor: '[REDACTED]',
  },
})
```

Log levels:
- `logger.error` — programmer errors, unhandled exceptions, database failures
- `logger.warn`  — operational errors, plan limits hit, AI parsing failures
- `logger.info`  — significant events: teacher registered, grade approved, plan upgraded
- `logger.debug` — detailed flow for development only, never in production

---

### Async Route Handler Wrapper

All async route handlers must be wrapped to catch rejected promises. Without this, unhandled promise rejections crash the process in older Node versions or silently fail in newer ones.

```typescript
// backend/src/lib/asyncHandler.ts

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
```

Use on every async route:

```typescript
// CORRECT
router.post('/grade', authenticate, checkMonthlyLimit('gradesPerMonth'),
  asyncHandler(async (req, res) => {
    const result = await gradingService.grade({ ...req.body, teacherId: req.teacher.id })
    res.json(result)
  })
)

// WRONG — unhandled rejection if gradingService.grade() throws
router.post('/grade', authenticate, async (req, res) => {
  const result = await gradingService.grade({ ...req.body })
  res.json(result)
})
```

---

### DeepSeek Error Handling and Retry

DeepSeek API calls fail for two reasons: network/service errors (transient, retry) and malformed JSON responses (retry with stricter prompt). Handle both.

```typescript
// backend/src/services/deepseek.ts

const MAX_RETRIES     = 2
const RETRY_DELAY_MS  = 1000

export async function callDeepSeekWithRetry(
  messages:  Message[],
  system:    string,
  context:   CallContext,
  parseJSON: boolean = false
): Promise<string> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const text = await callDeepSeek(messages, system, context)

      if (parseJSON) {
        // Validate JSON before returning — retry if invalid
        const clean = text.replace(/```json|```/g, '').trim()
        JSON.parse(clean)   // throws if invalid — caught below
        return clean
      }

      return text

    } catch (err) {
      lastError = err as Error

      const isJsonError   = err instanceof SyntaxError
      const isServiceError = (err as AppError).code === 'AI_SERVICE_ERROR'

      if (attempt < MAX_RETRIES) {
        if (isJsonError) {
          // Retry with explicit JSON instruction appended
          messages = [
            ...messages,
            { role: 'assistant', content: (err as any).partialText ?? '' },
            { role: 'user',      content: 'Your response was not valid JSON. Respond only with the JSON object, no other text.' },
          ]
        } else if (isServiceError) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt))
        } else {
          break   // non-retryable error
        }
      }
    }
  }

  logger.error({ message: 'DeepSeek call failed after retries', error: lastError?.message, context })
  throw new AIServiceError()
}
```

---

### Frontend Error Handling

All API errors are handled in one place — the axios interceptor. Components never catch API errors themselves.

```typescript
// frontend/src/api/client.ts

import axios from 'axios'
import { useUIStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30000,   // 30s — AI calls can be slow
})

// Attach JWT to every request
apiClient.interceptors.request.use(config => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle all error responses centrally
apiClient.interceptors.response.use(
  response => response,
  error => {
    const status  = error.response?.status
    const code    = error.response?.data?.code
    const message = error.response?.data?.error
    const upgrade = error.response?.data?.upgrade

    // Session expired — redirect to login
    if (status === 401) {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    }

    // Plan limit — show upgrade prompt
    if (upgrade) {
      useUIStore.getState().showUpgradeModal(code)
      return Promise.reject(error)
    }

    // All other errors — show toast
    const userMessage = message || ERROR_MESSAGES[code] || 'Something went wrong. Please try again.'
    useUIStore.getState().showToast({ type: 'error', message: userMessage })

    return Promise.reject(error)
  }
)

// Human-readable messages for known error codes
const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR:            'Please check your inputs and try again.',
  NOT_FOUND:                   'The requested item could not be found.',
  FORBIDDEN:                   'You do not have permission to do that.',
  AI_SERVICE_ERROR:            'The AI service is temporarily unavailable. Please try again in a moment.',
  DOCUMENT_PROCESSING_ERROR:   'We could not process this document. Please check the file and try again.',
  INTERNAL_ERROR:              'An unexpected error occurred. If this continues, please contact support.',
}
```

---

### Toast Notification System

Errors from the interceptor call `useUIStore.getState().showToast()`. Define the toast store and a `ToastContainer` component that renders toasts from it.

```typescript
// frontend/src/store/uiStore.ts

interface Toast {
  id:      string
  type:    'success' | 'error' | 'warning' | 'info'
  message: string
}

interface UIState {
  toasts:           Toast[]
  upgradeModalCode: string | null
  showToast:        (toast: Omit<Toast, 'id'>) => void
  dismissToast:     (id: string) => void
  showUpgradeModal: (code?: string) => void
  hideUpgradeModal: () => void
}
```

Toasts auto-dismiss after 4 seconds for success/info, persist until dismissed for errors.

---

### Unhandled Rejection Safety Net

Add to `index.ts` — catches anything that slips through:

```typescript
// backend/src/index.ts

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ message: 'Unhandled promise rejection', reason, promise })
  // Do not exit — PM2 will restart if needed
})

process.on('uncaughtException', (err) => {
  logger.error({ message: 'Uncaught exception', error: err.message, stack: err.stack })
  process.exit(1)   // Let PM2 restart cleanly
})
```

---

### Important Rules

- Never `console.log` in backend code. Always use `logger`.
- Never expose `err.stack`, database error messages, or internal field names to the client.
- Never swallow errors with empty catch blocks. If you catch an error and cannot handle it, rethrow it.
- All async route handlers must use `asyncHandler()` wrapper. No exceptions.
- Services throw `AppError` subclasses. Routes never catch errors — they call `next(err)` via `asyncHandler` and let the global handler deal with it.
- Frontend components never call `.catch()` on API calls directly. TanStack Query's `onError` callback + the axios interceptor handle all error display.
___ 

---

## Security

### Overview

GradeAssist handles student personal data (names, emails, assignment text) and teacher credentials. Two legal frameworks apply: Russian Federal Law 152-FZ on Personal Data, and general institutional data security expectations. Security must be built in from day one — not retrofitted.

This section defines every security measure to implement. None are optional.

---

### Dependencies

```bash
npm install helmet cors express-rate-limit express-validator bcryptjs jsonwebtoken
npm install --save-dev @types/bcryptjs @types/jsonwebtoken @types/cors
```

---

### HTTP Security Headers — Helmet

Apply to every response. Register before all routes.

```typescript
// backend/src/index.ts
import helmet from 'helmet'

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],   // needed for Tailwind
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,   // needed for PDF rendering
}))
```

---

### CORS

Explicitly whitelist only your own domains. Never use `origin: '*'` in production.

```typescript
// backend/src/index.ts
import cors from 'cors'

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,            // production: https://gradeassist.ru
  'http://localhost:5173',             // development
].filter(Boolean) as string[]

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman in dev)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`))
    }
  },
  credentials:      true,
  allowedHeaders:   ['Content-Type', 'Authorization'],
  methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  maxAge:           86400,   // preflight cache: 24 hours
}))
```

---

### Rate Limiting

Three layers of rate limiting. All use `express-rate-limit` with an in-memory store (sufficient for a single VM — upgrade to Redis store if you scale to multiple instances).

```typescript
// backend/src/middleware/rateLimits.ts
import rateLimit from 'express-rate-limit'

// Layer 1 — global limit: all routes
export const globalRateLimit = rateLimit({
  windowMs:         15 * 60 * 1000,   // 15 minutes
  max:              300,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' },
})

// Layer 2 — auth routes: stricter to prevent brute force
export const authRateLimit = rateLimit({
  windowMs:         15 * 60 * 1000,   // 15 minutes
  max:              10,               // 10 login attempts per 15 min per IP
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many login attempts. Please wait 15 minutes.', code: 'AUTH_RATE_LIMITED' },
})

// Layer 3 — AI endpoints: per teacher to cap runaway token spend
export const aiRateLimit = rateLimit({
  windowMs:         60 * 1000,        // 1 minute
  max:              10,               // 10 AI calls per minute per IP
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => (req as AuthRequest).teacher?.id ?? req.ip,
  message:          { error: 'Too many requests to AI service. Please wait a moment.', code: 'AI_RATE_LIMITED' },
})
```

Apply in `index.ts` and routes:

```typescript
app.use(globalRateLimit)                // all routes

// auth routes
router.post('/login',    authRateLimit, asyncHandler(handleLogin))
router.post('/register', authRateLimit, asyncHandler(handleRegister))

// AI routes
router.post('/grade',      authenticate, aiRateLimit, checkMonthlyLimit('gradesPerMonth'), ...)
router.post('/generate',   authenticate, aiRateLimit, checkMonthlyLimit('presentationsPerMonth'), ...)
```

---

### Input Validation

Every route that accepts a request body validates it before the handler runs. Use `express-validator`.

```typescript
// backend/src/middleware/validate.ts
import { validationResult, ValidationChain } from 'express-validator'
import { ValidationError } from '../errors/AppError'

export function validate(chains: ValidationChain[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    await Promise.all(chains.map(chain => chain.run(req)))
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return next(new ValidationError(
        'Invalid input',
        errors.array().map(e => ({ field: e.type, message: e.msg }))
      ))
    }
    next()
  }
}
```

Validation rules for each route:

```typescript
// backend/src/validation/authValidation.ts
import { body } from 'express-validator'

export const registerRules = [
  body('email')
    .isEmail().withMessage('Valid email required')
    .normalizeEmail()
    .isLength({ max: 255 }),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .isLength({ max: 128 })
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters')
    .escape(),
  body('university')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .escape(),
]

export const loginRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 1, max: 128 }),
]

// backend/src/validation/gradingValidation.ts
export const gradeRules = [
  body('submission_text')
    .trim()
    .isLength({ min: 50,    message: 'Submission too short to grade' })
    .isLength({ max: 50000, message: 'Submission too long — maximum 50,000 characters' }),
  body('course_id')
    .optional()
    .isUUID().withMessage('Invalid course ID'),
  body('rubric_id')
    .optional()
    .isUUID().withMessage('Invalid rubric ID'),
  body('student_name')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .escape(),
  body('student_email')
    .optional()
    .isEmail().normalizeEmail(),
]
```

Apply to routes:

```typescript
router.post('/register', authRateLimit, validate(registerRules), asyncHandler(handleRegister))
router.post('/login',    authRateLimit, validate(loginRules),    asyncHandler(handleLogin))
router.post('/grade',    authenticate,  validate(gradeRules),    aiRateLimit, ...)
```

---

### SQL Injection Prevention

You are using raw SQL with `node-postgres`. The `pg` library parameterises queries automatically when you use `$1, $2` placeholders. This is safe. The rule is simple and absolute:

```typescript
// SAFE — parameterised query
const result = await db.query(
  'SELECT * FROM teachers WHERE email = $1',
  [email]
)

// UNSAFE — never do this under any circumstances
const result = await db.query(
  `SELECT * FROM teachers WHERE email = '${email}'`
)
```

Never use string interpolation or concatenation to build SQL queries. If you find yourself doing this, stop and use a parameter placeholder instead.

---

### File Upload Security

```typescript
// backend/src/middleware/fileValidation.ts

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
])

const MAX_FILE_SIZE = 20 * 1024 * 1024   // 20MB

export const uploadConfig = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {

    // Check MIME type declared by client
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new DocumentProcessingError(
        'Unsupported file type. Please upload a PDF, Word document, or image.'
      ))
    }

    cb(null, true)
  },
})

// After multer, verify actual file content matches declared MIME type
// Prevents disguised files (e.g. .exe renamed to .pdf)
export async function verifyFileContent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const file = req.file
  if (!file) return next()

  // Check magic bytes (file signature)
  const header = file.buffer.subarray(0, 4).toString('hex')

  const signatures: Record<string, string> = {
    '25504446': 'application/pdf',                // %PDF
    '504b0304': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // PK (zip)
    'ffd8ffe0': 'image/jpeg',
    'ffd8ffe1': 'image/jpeg',
    '89504e47': 'image/png',
  }

  const detectedMime = signatures[header]

  if (detectedMime && detectedMime !== file.mimetype) {
    return next(new DocumentProcessingError(
      'File content does not match the declared file type.'
    ))
  }

  next()
}
```

---

### Prompt Injection Prevention

Student submissions go directly into DeepSeek prompts. A malicious student could craft a submission designed to manipulate the grading output. Sanitise all user-supplied content before including it in prompts.

```typescript
// backend/src/lib/promptSanitiser.ts

// Characters and patterns that could break prompt structure
const PROMPT_INJECTION_PATTERNS = [
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
  /###\s*(system|instruction|human|assistant)/gi,
  /ignore\s+previous\s+instructions?/gi,
  /disregard\s+all\s+previous/gi,
  /you\s+are\s+now\s+(?:a\s+)?(?:dan|jailbreak)/gi,
]

export function sanitiseForPrompt(text: string): string {
  let sanitised = text

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitised = sanitised.replace(pattern, '[removed]')
  }

  return sanitised
}
```

Always wrap user content in clear delimiters in prompts so the model knows what is instruction and what is data:

```typescript
// In buildGradingPrompt():
const prompt = `
  Grade the following student submission according to the rubric.

  <student_submission>
  ${sanitiseForPrompt(submissionText)}
  </student_submission>

  Rubric:
  ${rubricText}

  Respond only with the JSON object.
`
```

---

### JWT Security

```typescript
// backend/src/lib/jwt.ts
import jwt from 'jsonwebtoken'
import { UnauthorizedError } from '../errors/AppError'

const JWT_SECRET  = process.env.JWT_SECRET!   // 64+ random characters
const JWT_EXPIRY  = '7d'

export function signToken(payload: { id: string; email: string; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn:  JWT_EXPIRY,
    algorithm:  'HS256',
    issuer:     'gradeassist',
  })
}

export function verifyToken(token: string): jwt.JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer:     'gradeassist',
    }) as jwt.JwtPayload
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Session expired. Please log in again.')
    }
    throw new UnauthorizedError('Invalid session. Please log in again.')
  }
}
```

Token invalidation on password change — store a `password_changed_at` timestamp on the teacher and reject tokens issued before it:

```typescript
// backend/src/middleware/authenticate.ts
export async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return next(new UnauthorizedError())

  const payload = verifyToken(token)
  const teacher = await teacherQueries.getById(payload.id)

  if (!teacher || !teacher.is_active) return next(new UnauthorizedError())

  // Reject token if password was changed after it was issued
  if (teacher.password_changed_at) {
    const tokenIssuedAt = payload.iat! * 1000
    if (tokenIssuedAt < teacher.password_changed_at.getTime()) {
      return next(new UnauthorizedError('Session expired. Please log in again.'))
    }
  }

  // Check plan expiry — downgrade in-memory if expired
  const tier = teacher.plan_expires_at && teacher.plan_expires_at < new Date()
    ? 'free'
    : teacher.plan_tier

  req.teacher = { ...teacher, plan_tier: tier }
  next()
}
```

Add `password_changed_at` to schema:

```sql
ALTER TABLE teachers ADD COLUMN password_changed_at TIMESTAMPTZ;
```

---

### Password Security

```typescript
// backend/src/lib/password.ts
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
```

Never log, store in plain text, return in API responses, or include in error messages.

---

### Data Privacy — 152-FZ Compliance

```typescript
// Fields that constitute personal data under 152-FZ
// Never log these. Never include in error responses.
// Encrypt at rest in future versions when scaling.
const PERSONAL_DATA_FIELDS = [
  'student_name',
  'student_email',
  'teacher.email',
  'teacher.name',
  'submission_text',   // may contain student personal information
]
```

Practical rules:
- Student names and emails are optional on assignment submission — never require them
- Grading history older than the teacher's `historyDays` plan limit is excluded from API responses, not deleted (retained for your RAG flywheel but not surfaced to users)
- Teachers can request deletion of their account and all associated data — implement a `DELETE /api/account` endpoint that cascades deletes through all tables
- All data must reside on Yandex Cloud infrastructure within Russia — never send personal data to services outside Russia in production

---

### Security Checklist — Verify Before First Deploy

- [ ] All routes behind `authenticate` middleware except `/api/auth/register` and `/api/auth/login`
- [ ] `helmet()` registered before all routes
- [ ] CORS configured with explicit origin whitelist
- [ ] Rate limiting on all routes, stricter on auth and AI endpoints
- [ ] All request bodies validated with `express-validator` before handler runs
- [ ] No string interpolation in any SQL query
- [ ] File MIME type checked by both client declaration and magic bytes
- [ ] Prompt injection sanitisation applied to all user text before DeepSeek calls
- [ ] `JWT_SECRET` is at least 64 random characters, stored only in `.env`, never committed
- [ ] `.env` in `.gitignore` — verified before first commit
- [ ] `password_hash` never returned in any API response
- [ ] `cost_usd` never returned to non-admin users
- [ ] No `console.log` statements in backend code
____

---

## Email System and Password Reset

### Email Provider — Yandex 360 Mail

Use Yandex 360 Mail for transactional email via SMTP. It is accessible within Russia, Cyrillic-native, and included with a Yandex 360 subscription which you will likely already have for your domain. Alternative: Unisender — a Russian email service provider with a REST API and a generous free tier (1,500 emails/day free).

For MVP use nodemailer with SMTP. Switch to a REST API provider (Unisender) when you need delivery analytics or volume above a few hundred emails per day.

```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

---

### Email Service

All email sending goes through `/backend/src/services/email.ts`. No other file calls nodemailer directly.

```typescript
// backend/src/services/email.ts

import nodemailer from 'nodemailer'
import { logger } from '../lib/logger'

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,       // smtp.yandex.ru or smtp.unisender.ru
  port:   Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,       // your sending address e.g. noreply@gradeassist.ru
    pass: process.env.SMTP_PASS,
  },
})

interface EmailPayload {
  to:       string
  subject:  string
  html:     string
  text:     string            // plain text fallback — always include
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  try {
    await transporter.sendMail({
      from:    `"GradeAssist" <${process.env.SMTP_USER}>`,
      to:      payload.to,
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    })
    logger.info({ message: 'Email sent', to: payload.to, subject: payload.subject })
  } catch (err) {
    // Log but never throw — email failure must not crash the main request flow
    // The teacher can still use the app even if a confirmation email fails
    logger.error({ message: 'Email send failed', to: payload.to, error: (err as Error).message })
  }
}
```

Email sending is always fire-and-forget from the perspective of the API response. Never make a teacher wait for email delivery to complete.

---

### Email Templates

Plain, clean, text-forward design. Matches the editorial aesthetic of the app. No heavy HTML email frameworks — a simple inline-styled HTML structure that renders correctly in Russian email clients (Yandex Mail, Mail.ru).

```typescript
// backend/src/lib/emailTemplates.ts

const BASE_STYLE = `
  font-family: 'Arial', sans-serif;
  max-width: 560px;
  margin: 0 auto;
  color: #1A1A1A;
`

const HEADER_STYLE = `
  padding: 24px 32px;
  border-bottom: 1px solid #E5E0D8;
`

const BODY_STYLE = `
  padding: 32px;
  line-height: 1.7;
  font-size: 15px;
`

const FOOTER_STYLE = `
  padding: 20px 32px;
  border-top: 1px solid #E5E0D8;
  font-size: 12px;
  color: #A09890;
`

function wrap(content: string): string {
  return `
    <div style="${BASE_STYLE}">
      <div style="${HEADER_STYLE}">
        <span style="font-size:18px;font-weight:700;color:#1A1A1A">
          Grade<span style="color:#C8860A">Assist</span>
        </span>
      </div>
      <div style="${BODY_STYLE}">
        ${content}
      </div>
      <div style="${FOOTER_STYLE}">
        GradeAssist · gradeassist.ru<br>
        Если вы не ожидали это письмо, просто проигнорируйте его.
      </div>
    </div>
  `
}

// ── Registration confirmation ──────────────────────────────────────

export function registrationEmail(name: string): EmailPayload {
  const firstName = name.split(' ')[0]
  return {
    subject: 'Добро пожаловать в GradeAssist',
    html: wrap(`
      <p>Здравствуйте, ${firstName}!</p>
      <p>Ваш аккаунт GradeAssist создан. Вы готовы приступить к работе.</p>
      <p>
        <a href="${process.env.FRONTEND_URL}/app/dashboard"
           style="display:inline-block;padding:10px 20px;background:#C8860A;
                  color:#fff;text-decoration:none;border-radius:8px;font-weight:500">
          Перейти в GradeAssist
        </a>
      </p>
      <p style="color:#6B6560;font-size:13px">
        Бесплатный план включает 20 проверок заданий и 3 презентации в месяц.
        Обновитесь до Pro для неограниченного доступа.
      </p>
    `),
    text: `Здравствуйте, ${firstName}!\n\nВаш аккаунт GradeAssist создан.\n\nПерейдите на ${process.env.FRONTEND_URL}/app/dashboard чтобы начать работу.\n\nGradeAssist`,
    to: '',   // set by caller
  }
}

// ── Password reset ─────────────────────────────────────────────────

export function passwordResetEmail(name: string, resetUrl: string): EmailPayload {
  const firstName = name.split(' ')[0]
  return {
    subject: 'Сброс пароля GradeAssist',
    html: wrap(`
      <p>Здравствуйте, ${firstName}!</p>
      <p>Мы получили запрос на сброс пароля для вашего аккаунта.</p>
      <p>
        <a href="${resetUrl}"
           style="display:inline-block;padding:10px 20px;background:#C8860A;
                  color:#fff;text-decoration:none;border-radius:8px;font-weight:500">
          Сбросить пароль
        </a>
      </p>
      <p style="color:#6B6560;font-size:13px">
        Ссылка действительна в течение 1 часа.<br>
        Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.
        Ваш пароль не изменится.
      </p>
    `),
    text: `Здравствуйте, ${firstName}!\n\nДля сброса пароля перейдите по ссылке:\n${resetUrl}\n\nСсылка действительна 1 час.\n\nGradeAssist`,
    to: '',
  }
}

// ── Password changed confirmation ──────────────────────────────────

export function passwordChangedEmail(name: string): EmailPayload {
  const firstName = name.split(' ')[0]
  return {
    subject: 'Пароль GradeAssist изменён',
    html: wrap(`
      <p>Здравствуйте, ${firstName}!</p>
      <p>Пароль вашего аккаунта GradeAssist был успешно изменён.</p>
      <p style="color:#6B6560;font-size:13px">
        Если вы не меняли пароль, немедленно свяжитесь с нами:
        <a href="mailto:support@gradeassist.ru">support@gradeassist.ru</a>
      </p>
    `),
    text: `Здравствуйте, ${firstName}!\n\nПароль вашего аккаунта изменён.\n\nЕсли это были не вы, напишите нам: support@gradeassist.ru\n\nGradeAssist`,
    to: '',
  }
}

// ── Institution teacher invite ─────────────────────────────────────

export function teacherInviteEmail(
  inviterName:     string,
  institutionName: string,
  inviteUrl:       string
): EmailPayload {
  return {
    subject: `Приглашение в GradeAssist — ${institutionName}`,
    html: wrap(`
      <p>Здравствуйте!</p>
      <p>
        <strong>${inviterName}</strong> приглашает вас присоединиться к GradeAssist
        в рамках аккаунта <strong>${institutionName}</strong>.
      </p>
      <p>GradeAssist — платформа для преподавателей, которая помогает проверять задания
         и готовить материалы к лекциям с помощью ИИ.</p>
      <p>
        <a href="${inviteUrl}"
           style="display:inline-block;padding:10px 20px;background:#C8860A;
                  color:#fff;text-decoration:none;border-radius:8px;font-weight:500">
          Принять приглашение
        </a>
      </p>
      <p style="color:#6B6560;font-size:13px">
        Приглашение действительно 7 дней.
      </p>
    `),
    text: `Здравствуйте!\n\n${inviterName} приглашает вас в GradeAssist (${institutionName}).\n\nПримите приглашение: ${inviteUrl}\n\nПриглашение действительно 7 дней.\n\nGradeAssist`,
    to: '',
  }
}
```

---

### Password Reset — Schema

```sql
-- Password reset tokens
CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,   -- hashed — never store raw token in DB
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Clean up expired tokens nightly (add to cron job)
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW();
```

---

### Password Reset — Routes

```typescript
// backend/src/routes/auth.ts

// POST /api/auth/forgot-password
// Accepts an email. Always returns 200 regardless of whether email exists.
// Prevents email enumeration attacks.
router.post('/forgot-password',
  authRateLimit,
  validate([body('email').isEmail().normalizeEmail()]),
  asyncHandler(async (req, res) => {
    const { email } = req.body
    const teacher = await teacherQueries.getByEmail(email)

    if (teacher && teacher.is_active) {
      // Generate cryptographically secure random token
      const rawToken  = crypto.randomBytes(32).toString('hex')
      const tokenHash = await hashPassword(rawToken)   // hash before storing
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)   // 1 hour

      // Invalidate any existing reset tokens for this teacher
      await passwordResetQueries.invalidateExisting(teacher.id)

      await passwordResetQueries.create({
        teacherId: teacher.id,
        tokenHash,
        expiresAt,
      })

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`
      const template = passwordResetEmail(teacher.name || teacher.email, resetUrl)
      // Fire and forget — do not await
      sendEmail({ ...template, to: teacher.email })
    }

    // Always return 200 — never reveal whether email exists
    res.json({ message: 'If that email is registered, a reset link has been sent.' })
  })
)

// POST /api/auth/reset-password
router.post('/reset-password',
  authRateLimit,
  validate([
    body('token').isLength({ min: 64, max: 64 }),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
      .matches(/[0-9]/).withMessage('Password must contain a number'),
  ]),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body

    // Find all valid (unused, unexpired) tokens and check each
    // We cannot look up by raw token since we store hashes
    // Mitigate timing attack by using bcrypt compare
    const validToken = await passwordResetQueries.findValidForToken(token)

    if (!validToken) {
      throw new ValidationError('Reset link is invalid or has expired.')
    }

    const newHash = await hashPassword(password)

    await db.transaction(async (trx) => {
      await teacherQueries.updatePassword(validToken.teacher_id, newHash, trx)
      await passwordResetQueries.markUsed(validToken.id, trx)
    })

    // Send confirmation email
    const teacher = await teacherQueries.getById(validToken.teacher_id)
    if (teacher) {
      sendEmail({ ...passwordChangedEmail(teacher.name || teacher.email), to: teacher.email })
    }

    res.json({ message: 'Password reset successfully. You can now log in.' })
  })
)
```

---

### Password Reset — Frontend Flow

Four states, single `/reset-password` page:

**State 1 — forgot password form** (reached from login page "Forgot password?" link):
- Single email input
- Submit → POST `/api/auth/forgot-password`
- On success: show "Check your email" message regardless of response
- Never say "email not found" — always the same neutral confirmation

**State 2 — reset password form** (reached from email link with `?token=...`):
- On page load: extract token from URL params
- Two inputs: new password + confirm password
- Client-side validation: passwords match, meets complexity rules
- Submit → POST `/api/auth/reset-password`

**State 3 — success** (after successful reset):
- "Password changed successfully"
- Auto-redirect to login after 3 seconds

**State 4 — expired/invalid token**:
- "This reset link has expired or is invalid"
- Link back to forgot password form

---

### Adding to .env.example

```bash
# Email (SMTP)
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=noreply@gradeassist.ru
SMTP_PASS=your_smtp_password
```

---

### Email Sending Triggers — Summary

| Trigger | Template | Awaited? |
|---|---|---|
| Teacher registers | `registrationEmail` | No — fire and forget |
| Teacher requests password reset | `passwordResetEmail` | No — fire and forget |
| Teacher successfully resets password | `passwordChangedEmail` | No — fire and forget |
| Institution admin invites teacher | `teacherInviteEmail` | No — fire and forget |

All email sending is fire-and-forget. Email failure must never cause an API error or degrade the user experience. Log failures at error level for your own monitoring.

---

### Important Rules

- Never store raw password reset tokens in the database — always store the bcrypt hash
- Always return 200 from `/forgot-password` regardless of whether the email exists — prevents email enumeration
- Password reset tokens expire after 1 hour and are single-use — mark as used immediately on redemption
- Invalidate all existing reset tokens for a teacher when they request a new one
- Send a confirmation email when the password is changed — gives the teacher a security alert if it was not them
- Email send failures are logged but never surface to the user — the main operation (registration, password reset) succeeds or fails on its own merits

___
---

## Environment Configuration and Deployment

### Environment Variables — Full Reference

Create `.env.example` in the repo root. Commit this file. Never commit `.env`.

```bash
# ── Application ────────────────────────────────────────────────────
NODE_ENV=development                     # 'development' | 'production'
PORT=3000
FRONTEND_URL=http://localhost:5173       # production: https://gradeassist.ru
LOG_LEVEL=info                           # 'debug' | 'info' | 'warn' | 'error'

# ── Database ───────────────────────────────────────────────────────
DATABASE_URL=postgresql://gradeassist_user:your_password@localhost:5432/gradeassist

# ── Auth ───────────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=replace_with_64_char_random_hex_string

# ── AI ─────────────────────────────────────────────────────────────
DEEPSEEK_API_KEY=your_deepseek_api_key

# ── Yandex Cloud ───────────────────────────────────────────────────
YANDEX_FOLDER_ID=your_folder_id
YANDEX_VISION_API_KEY=your_vision_api_key
YANDEX_STORAGE_BUCKET=gradeassist-uploads
YANDEX_STORAGE_ACCESS_KEY=your_access_key
YANDEX_STORAGE_SECRET_KEY=your_secret_key
YANDEX_STORAGE_ENDPOINT=https://storage.yandexcloud.net

# ── Email ──────────────────────────────────────────────────────────
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=noreply@gradeassist.ru
SMTP_PASS=your_smtp_password
```

`.env` for local development is a copy of this with real values filled in. Never commit it — verify `.gitignore` contains `.env` before the first commit.

---

### .gitignore

```
# Environment
.env
.env.local
.env.*.local

# Dependencies
node_modules/
*/node_modules/

# Build output
frontend/dist/
backend/dist/

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
```

---

### Yandex Cloud VM Setup

Run once on a fresh Ubuntu 24.04 VM. Minimum spec: 2 vCPU, 4GB RAM, 20GB SSD.

```bash
#!/bin/bash
# vm-setup.sh — run once as root on fresh Yandex Cloud VM

# System update
apt-get update && apt-get upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PostgreSQL 15
apt-get install -y postgresql postgresql-contrib

# pgvector extension
apt-get install -y postgresql-15-pgvector

# Nginx
apt-get install -y nginx

# PM2 (process manager)
npm install -g pm2

# Create application user (never run the app as root)
useradd -m -s /bin/bash gradeassist
mkdir -p /var/www/gradeassist
chown gradeassist:gradeassist /var/www/gradeassist

# Create PostgreSQL database and user
sudo -u postgres psql <<SQL
  CREATE DATABASE gradeassist;
  CREATE USER gradeassist_user WITH ENCRYPTED PASSWORD 'your_strong_password';
  GRANT ALL PRIVILEGES ON DATABASE gradeassist TO gradeassist_user;
  \c gradeassist
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
SQL

echo "VM setup complete"
```

---

### PostgreSQL Configuration

```bash
# /etc/postgresql/15/main/postgresql.conf — key settings to tune

max_connections = 100
shared_buffers = 256MB              # 25% of RAM for 4GB VM
effective_cache_size = 1GB          # 50-75% of RAM
work_mem = 16MB
maintenance_work_mem = 128MB
wal_buffers = 16MB

# pgvector performance
max_parallel_workers_per_gather = 2
```

```bash
# /etc/postgresql/15/main/pg_hba.conf
# Allow local connections for the app user
local   gradeassist   gradeassist_user   md5
host    gradeassist   gradeassist_user   127.0.0.1/32   md5
```

Restart after changes: `systemctl restart postgresql`

---

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/gradeassist

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name gradeassist.ru www.gradeassist.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name gradeassist.ru www.gradeassist.ru;

    # SSL — managed by Yandex Certificate Manager
    ssl_certificate     /etc/ssl/gradeassist/certificate.pem;
    ssl_certificate_key /etc/ssl/gradeassist/private.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers (supplement to helmet in Node)
    add_header X-Frame-Options         "DENY"            always;
    add_header X-Content-Type-Options  "nosniff"         always;
    add_header Referrer-Policy         "strict-origin"   always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1024;

    # API — proxy to Node.js backend
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade     $http_upgrade;
        proxy_set_header   Connection  'upgrade';
        proxy_set_header   Host        $host;
        proxy_set_header   X-Real-IP   $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        # Timeouts — AI calls can be slow
        proxy_read_timeout    120s;
        proxy_connect_timeout 10s;

        # Upload size limit — match multer config
        client_max_body_size 21M;
    }

    # Frontend — serve from Yandex Object Storage
    location / {
        # Option A: proxy to Object Storage (simpler)
        proxy_pass https://gradeassist-frontend.storage.yandexcloud.net;
        proxy_set_header Host gradeassist-frontend.storage.yandexcloud.net;

        # SPA fallback — route all non-file requests to index.html
        proxy_intercept_errors on;
        error_page 404 = @fallback;
    }

    location @fallback {
        proxy_pass https://gradeassist-frontend.storage.yandexcloud.net/index.html;
        proxy_set_header Host gradeassist-frontend.storage.yandexcloud.net;
    }
}
```

Enable and reload:
```bash
ln -s /etc/nginx/sites-available/gradeassist /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

### PM2 Configuration

```javascript
// ecosystem.config.js — in /var/www/gradeassist/backend

module.exports = {
  apps: [{
    name:         'gradeassist-api',
    script:       'dist/index.js',
    instances:    1,              // single instance for MVP — increase with load
    autorestart:  true,
    watch:        false,          // never watch in production
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
      PORT:     3000,
    },
    log_file:       '/var/log/gradeassist/combined.log',
    out_file:       '/var/log/gradeassist/out.log',
    error_file:     '/var/log/gradeassist/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:     true,
  }],
}
```

```bash
mkdir -p /var/log/gradeassist
chown gradeassist:gradeassist /var/log/gradeassist

# Start and save so it survives VM reboots
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # follow the printed command to register with systemd
```

---

### Deployment Script

Save as `deploy.sh` in the repo root. Run from your local machine to deploy.

```bash
#!/bin/bash
# deploy.sh — deploy latest code to Yandex Cloud VM
# Usage: ./deploy.sh
# Requires: SSH key configured for VM_HOST

set -e   # exit on any error

VM_HOST="gradeassist@your.vm.ip.address"
APP_DIR="/var/www/gradeassist"

echo "▶ Building frontend..."
cd frontend
npm run build
cd ..

echo "▶ Uploading frontend to Yandex Object Storage..."
# Install yc CLI first: https://cloud.yandex.ru/docs/cli/
yc storage cp \
  --recursive \
  frontend/dist/ \
  s3://gradeassist-frontend/ \
  --acl public-read

echo "▶ Uploading backend to VM..."
rsync -avz --exclude 'node_modules' --exclude '.env' --exclude 'dist' \
  backend/ "${VM_HOST}:${APP_DIR}/backend/"

echo "▶ Building and restarting backend on VM..."
ssh "$VM_HOST" << 'REMOTE'
  set -e
  cd /var/www/gradeassist/backend
  npm ci --production=false
  npm run build
  pm2 reload gradeassist-api --update-env
  pm2 save
  echo "✓ Backend restarted"
REMOTE

echo "▶ Running database migrations..."
ssh "$VM_HOST" << 'REMOTE'
  cd /var/www/gradeassist/backend
  npm run migrate   # add this script to package.json
REMOTE

echo "✓ Deployment complete"
```

Make executable: `chmod +x deploy.sh`

---

### Database Migration Strategy

For MVP: maintain a `migrations/` folder with numbered SQL files. Apply manually before deployment.

```
backend/
└── migrations/
    ├── 001_initial_schema.sql
    ├── 002_add_institutions.sql
    ├── 003_add_usage_counters.sql
    └── ...
```

Add a `migrations` table to track which have run:

```sql
CREATE TABLE migrations (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ DEFAULT NOW()
);
```

Add to `package.json`:

```json
"scripts": {
  "migrate": "node scripts/migrate.js",
  "migrate:new": "node scripts/newMigration.js"
}
```

Migration runner (`scripts/migrate.js`):

```javascript
// backend/scripts/migrate.js
const { Pool } = require('pg')
const fs       = require('fs')
const path     = require('path')

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const applied = new Set(
    (await pool.query('SELECT filename FROM migrations')).rows.map(r => r.filename)
  )

  const files = fs.readdirSync(path.join(__dirname, '../migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip ${file}`)
      continue
    }
    const sql = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
    console.log(`  ✓ applied ${file}`)
  }

  await pool.end()
  console.log('Migrations complete')
}

migrate().catch(err => { console.error(err); process.exit(1) })
```

---

### Environment-Specific Config

```typescript
// backend/src/lib/config.ts
// Single place to read and validate all env vars on startup

function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

export const config = {
  nodeEnv:      process.env.NODE_ENV || 'development',
  port:         Number(process.env.PORT) || 3000,
  isDev:        process.env.NODE_ENV !== 'production',
  frontendUrl:  required('FRONTEND_URL'),
  logLevel:     process.env.LOG_LEVEL || 'info',

  db: {
    url: required('DATABASE_URL'),
  },

  auth: {
    jwtSecret: required('JWT_SECRET'),
  },

  deepseek: {
    apiKey: required('DEEPSEEK_API_KEY'),
  },

  yandex: {
    folderId:         required('YANDEX_FOLDER_ID'),
    visionApiKey:     required('YANDEX_VISION_API_KEY'),
    storageBucket:    required('YANDEX_STORAGE_BUCKET'),
    storageAccessKey: required('YANDEX_STORAGE_ACCESS_KEY'),
    storageSecretKey: required('YANDEX_STORAGE_SECRET_KEY'),
    storageEndpoint:  required('YANDEX_STORAGE_ENDPOINT'),
  },

  email: {
    host: required('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT) || 465,
    user: required('SMTP_USER'),
    pass: required('SMTP_PASS'),
  },
} as const
```

Call `config` at startup — if any required variable is missing the app crashes immediately with a clear message rather than failing silently later.

---

### Pre-Deploy Checklist

Run through this before every production deployment:

```
Code
[ ] No console.log statements in backend code
[ ] No hardcoded secrets, API keys, or passwords in source code
[ ] .env not committed — verify with: git ls-files .env
[ ] All new routes have authenticate middleware
[ ] All new async route handlers use asyncHandler()
[ ] New environment variables added to .env.example

Database
[ ] Migration file created for any schema changes
[ ] Migration tested locally before deploying

Build
[ ] Frontend builds without errors: npm run build
[ ] Backend compiles without TypeScript errors: tsc --noEmit
[ ] No failing tests: npm test

Deployment
[ ] SSH access to VM confirmed
[ ] deploy.sh runs without errors
[ ] POST /api/health returns 200 after deployment
[ ] Login flow works on production
[ ] One grading call completes successfully
```

---

### Health Check Endpoint

Required for monitoring and deployment verification:

```typescript
// backend/src/routes/health.ts
router.get('/api/health', asyncHandler(async (req, res) => {
  // Verify database connection
  await db.query('SELECT 1')

  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version,
    env:       process.env.NODE_ENV,
  })
}))
```

Register before auth middleware so it is always accessible:

```typescript
// index.ts — before all other routes
app.get('/api/health', healthHandler)
```

### Things to Never Do

- Never use generic SaaS blue (`#2563EB`, `#3B82F6`) for anything — amber is the only accent color
- Never use pure black (`#000000`) for text — always `var(--color-ink)` which is `#1A1A1A`
- Never use pure white (`#FFFFFF`) as the page background — always `var(--color-bg)` which is `#F7F5F0`
- Never use font-display for body text, labels, buttons, or any text under 16px
- Never use font-weight 600 or 700 with font-sans — only 400 and 500
- Never add drop shadows — depth comes from border + background color contrast only
- Never use gradients on UI surfaces — flat fills only
- Never use more than one accent color — amber is the only color used for interactive elements
- Never place text directly on the parchment background without a card surface beneath it for content blocks