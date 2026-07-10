# ИСПУМ (ispum.ru)

AI-powered educational platform for Russian university teachers — AI grading, lecture presentations, quizzes, academic programme analysis, and process-of-creation attestation for student work. B2B SaaS, freemium, Russia-resident (Yandex Cloud, 152-ФЗ compliant).

## New here?

Start with [`docs/ONBOARDING.md`](docs/ONBOARDING.md) to get a local instance running, then:

- [`CLAUDE.md`](CLAUDE.md) — directory map, non-negotiable engineering rules, architecture invariants (read this before your first PR)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how a request flows through the system, the major subsystems
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — the rules explained, plus recipes for adding a route/feature/migration
- [`FEATURES.md`](FEATURES.md) — what's shipped vs. planned, by user role
- [`CHANGELOG.md`](CHANGELOG.md) — dated engineering log
- [`TODO.md`](TODO.md) — the live backlog
- [`Research.md`](Research.md) — design docs, legal constraints, org-model spec

## Quick start

```bash
npm install
cp .env.example .env    # fill in DATABASE_URL and JWT_SECRET at minimum
npm run migrate --workspace=backend
npm run dev              # backend :3000, frontend :5173
```

See [`docs/ONBOARDING.md`](docs/ONBOARDING.md) for the full walkthrough, including what each optional integration does when left unconfigured.
