# GradeAssist — Claude Code System Prompt

## Project Overview

GradeAssist is a PWA (Progressive Web App) for university lecturers and teachers. It has two core features:

1. **AI Grading Engine** — teachers upload student assignment text, define a rubric, and the AI grades it with detailed per-criterion feedback. The teacher reviews, corrects if needed, and approves. Approved grades feed a RAG flywheel that makes future grading progressively more accurate.

2. **Lecture Presentation Generator** — teachers upload a course syllabus, define lecture parameters (topic, duration, learning goals, audience level), and the AI generates structured slide-by-slide content (title, bullets, speaker notes) they can copy into PowerPoint, Google Slides, or Canva. Output is formatted text, NOT an actual .pptx file — this is intentional for the MVP.

**Target market:** Russian university lecturers and teachers. The entire stack must be accessible inside Russian university networks without a VPN. No Google services, no Vercel, no Supabase — these are blocked at the network level in Russian institutions.

**Business model:** Freemium SaaS. Free tier (limited grades/month), Pro tier (unlimited + presentation generator), Institution tier (admin dashboard + bulk seats).

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

To avoid scope creep, the MVP explicitly does NOT include:

- PPTX / PDF file export
- Student-facing portal or accounts
- Plagiarism detection
- Real-time collaboration
- Email sending from the platform (generate draft only, teacher sends from their own email client)
- Mobile native app (PWA is sufficient)
- Payment processing (collect interest manually at first)
- Admin panel (manage teachers manually via database for MVP)

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