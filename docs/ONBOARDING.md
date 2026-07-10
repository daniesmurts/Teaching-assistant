# Onboarding

Get a working local ИСПУМ instance running end to end. This doc assumes zero prior context — if a step is wrong or missing, fix this file in the same PR that finds the gap.

## 1. Prerequisites

- Node.js 20+ (repo uses `--env-file`, a Node 20 flag)
- PostgreSQL with the `pgvector` extension installed and enabled (`CREATE EXTENSION vector` — [schema.sql](../backend/src/db/schema.sql) does this for you on first migrate)
- npm (this is an npm workspaces monorepo: `frontend` + `backend`)

You do **not** need DeepSeek/Yandex/T-Bank credentials to get the app running — every external integration degrades gracefully in dev (see §3).

## 2. Install & configure

```bash
git clone <repo>
cd Teaching-assistant
npm install                 # installs both workspaces from the root
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```
DATABASE_URL=postgres://localhost/ispum_dev
JWT_SECRET=<any random string>
```

Everything else in `.env.example` is optional in development — read the comments above each block; they explain exactly what breaks (or doesn't) if you leave it blank. The short version:

| Blank var | What happens in dev |
|---|---|
| `DEEPSEEK_API_KEY` | Grading/generation calls will fail — you need a real key to exercise AI features. No mock provider exists yet. |
| `YANDEX_*` (Vision/Storage/Search) | OCR is skipped, files save to `./uploads`, image search is disabled, topic generation falls back to model knowledge only |
| `UNISENDER_API_KEY` / `SMTP_*` | Emails are logged to the console instead of sent |
| `TBANK_*` | Payments/billing flows won't work |
| `SAML_SP_*` | SSO login won't work (regular email/password auth still does) |

## 3. Database

```bash
createdb ispum_dev          # or your preferred way to create the DB
npm run migrate --workspace=backend
```

Migrations are plain numbered SQL files in [`backend/migrations/`](../backend/migrations/) (currently 71+), applied in order and tracked in a `migrations` table. To add one: drop a new `NNN_description.sql` file in that directory — the runner ([`backend/scripts/migrate.js`](../backend/scripts/migrate.js)) picks it up next run. There's no down-migration convention; write forward-only, additive SQL.

## 4. Run it

```bash
npm run dev                 # runs backend (tsx watch, port 3000) + frontend (Vite, port 5173) concurrently
```

Or run one side at a time with `npm run dev:backend` / `npm run dev:frontend`.

Open `http://localhost:5173`. Register a teacher account through the normal signup flow — there's no seed script, so you start with an empty DB.

## 5. Tests

```bash
npm run test --workspace=backend            # unit tests (vitest)
npm run test:integration:setup --workspace=backend   # provisions a throwaway test DB, once
npm run test:integration --workspace=backend # integration tests (real Postgres, real migrations)
npm run test --workspace=frontend            # component tests (vitest + testing-library)
```

Unit tests sit next to the code they test (`*.test.ts` alongside `*.ts` in `services/`). Integration tests are named `*.integration.test.ts` and hit a real, migrated database — see [`backend/scripts/setup-test-db.ts`](../backend/scripts/setup-test-db.ts).

## 6. Where to go next

- [`../CLAUDE.md`](../CLAUDE.md) — directory map, non-negotiable rules, architecture invariants (the canonical reference — read this fully before your first PR)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how a request flows through the system, the big subsystems
- [`CONVENTIONS.md`](CONVENTIONS.md) — the rules from CLAUDE.md explained, plus how to add a route/feature/migration
- [`../FEATURES.md`](../FEATURES.md) — what's shipped vs. planned, by user role
- [`../TODO.md`](../TODO.md) — the live backlog, ordered by priority
