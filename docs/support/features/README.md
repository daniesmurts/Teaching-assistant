# Feature support docs

One file per shipped feature — not a re-description of what it does
(`FEATURES.md` owns that), but a support-facing view: what commonly goes
wrong, what error codes/messages a teacher will see, and plan-tier gotchas
that generate "why can't I do X" tickets.

**Template:**

```markdown
# Feature name

**Route(s):** frontend page + backend route
**Plan gate:** which tiers can use it, what `canUseFeature('...')` key gates it

## Common issues
- Symptom → cause → what to tell the teacher / runbook link

## Error codes this feature can surface
- CODE_NAME — when, what it means

## Plan-tier gotchas
- Anything that looks like a bug but is actually a limit (free tier caps, etc.)
```

Fill these in **as tickets come up**, not all at once — a doc written before
any real issue has surfaced tends to guess wrong about what actually breaks.
Two seeded below (grading, long-review) as examples of depth/format since
they're the highest-traffic features; the rest of the ~45 pages in
`frontend/src/pages/` don't have docs yet.
