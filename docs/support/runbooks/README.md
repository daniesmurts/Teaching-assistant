# Runbook format

One file per known issue. Frontmatter is the machine-readable match key (for
a human triaging, and eventually for an agent); the body is prose for whoever
is actually running the fix.

```markdown
---
id: short-kebab-case-id            # filename without .md
symptoms:
  - error_code: SOME_CODE          # matches production_incidents.code / AppError.code
  - log_pattern: "regex or substring seen in pino logs"
  - user_report: "what a teacher might say in Russian"
severity: low | medium | high | critical
auto_fixable: true | false         # only true if fix_commands are safe to run unattended
fix_commands:                      # exact commands — nothing improvised
  - "pm2 restart gradeassist-api"
verification: "how to confirm the fix worked"
escalate_if: "condition under which this should NOT be auto-applied / needs a human"
---

## Diagnosis
Why this happens, how to confirm it's actually this and not something else.

## Fix
Step by step, matches fix_commands above.

## Prevention
Only if there's a real follow-up (e.g. "add index", "bump pool size") —
otherwise omit this section.
```

Keep `fix_commands` exact and copy-pasteable — this list is also the
whitelist an automated agent would eventually be allowed to run for this
issue, so vague steps ("check the logs and see") don't belong there; put
those in `## Diagnosis` instead.
