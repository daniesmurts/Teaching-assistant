---
id: llm-provider-down
symptoms:
  - error_code: AI_SERVICE_ERROR
  - log_pattern: "fallback"
  - user_report: "проверка не запускается" / "ИИ-сервис временно недоступен"
severity: medium
auto_fixable: false
fix_commands: []
verification: "a test grade request (any subject, short text) completes without AI_SERVICE_ERROR"
escalate_if: "DeepSeek itself is down — there is no further fallback, this is a vendor outage to wait out, not a bug"
---

## Diagnosis
`backend/src/services/llm/registry.ts` already has a built-in fallback: if
the institution's preferred non-DeepSeek provider fails, it silently retries
once on DeepSeek and logs a warning (`fallbackOrThrow`). `AIServiceError` /
`AI_SERVICE_ERROR` only surfaces to the user when **that fallback also
fails** — i.e. DeepSeek itself is down, since calc-mode grading always
targets DeepSeek Reasoner with no further fallback.

Check which provider actually failed:
```
grep "fallback" /var/log/gradeassist/out.log | tail -20
```
This tells you whether it's "provider X failed, DeepSeek covered it" (no
user impact, just a log line) vs. "DeepSeek failed too" (real outage).

## Fix
There is no in-app fix for a vendor outage. Confirm DeepSeek's status
independently; if confirmed down, this is genuinely a wait-it-out situation.
If instead the *non-DeepSeek* provider (e.g. an institution's chosen Yandex
override) is down but DeepSeek is fine, there's nothing to do — the silent
fallback is already handling it and no teacher should be seeing errors. If
teachers *are* seeing errors in that case, the fallback logic itself has a
bug — escalate.

## Prevention
n/a — this is a third-party dependency, not something to harden further
without adding a second real fallback provider.
