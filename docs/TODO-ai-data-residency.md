# TODO — AI data residency / cross-border transfer (152-ФЗ)

**Status:** Parked (2026-06). Revisit when there's real institutional feedback
or a deal that hinges on it.

## The issue
Student work text is sent to **DeepSeek** (api.deepseek.com), which is **outside
Russia (China)**. That's a трансграничная передача of data that may contain student
PII. For state universities this can require Roskomnadzor notification and/or
explicit subject consent — and is the single most likely objection to kill an
institutional deal. (Hosting is all in RU; the *AI provider* is the only cross-border hop.)

## Why we didn't just switch to a RU model
YandexGPT / GigaChat have **no reasoning model in the DeepSeek-R1 class**. We route
calculation grading to `deepseek-reasoner` specifically for step-by-step math/physics
quality. A blanket swap to a RU model would degrade STEM grading. So "RU model" must
not mean "lose the reasoner."

## Options (ranked), for when we pick this up
1. **Self-host DeepSeek-R1 in RU (best).** Models are open-weight. Run
   **R1-Distill-Qwen-32B** (keeps most reasoning, far cheaper than full 671B) on a
   Yandex Cloud GPU / RU GPU host. Same quality, data stays in RU. Gate to
   institution-tier (or a per-org "RU-only AI" flag) to control GPU cost.
   - To spec: instance type, vLLM/Ollama serving, cost/month, routing in `deepseek.ts`.
2. **Anonymize before sending (cheap interim).** Pseudonymize identifiers in the
   submission text before any cross-border call (names already optional). Keeps
   DeepSeek cloud + full quality; weakens the PII-transfer argument. A
   `services/deepseek.ts` pre-pass.
3. **Consent + disclosure (no code).** Explicit cross-border consent at onboarding +
   the DPA disclosure (already drafted in `docs/legal/152-fz-dpa.md`). Some private
   institutions accept; many state ones won't.

## Pointers
- Centralized AI call site: `backend/src/services/deepseek.ts` (one place to route/gate).
- Reasoner usage: calculation grading in `backend/src/services/grading.ts` (`REASONER_MODEL`).
- Compliance docs already drafted: `docs/legal/security-overview.md`, `docs/legal/152-fz-dpa.md`
  (both flag this honestly; the security overview's roadmap section mentions the RU-model option).

## Trigger to revisit
- A real prospect's ИБ/закупки flags it, OR
- We commit to going after state universities seriously.
