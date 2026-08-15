# On-premises / self-managed deployment — design & plan

**Status:** Planning (2026-08-14). No code written. Triggered by a real prospect
that will only sign if ИСПУМ runs inside their own perimeter, on their own
GPUs, against their own DeepSeek and Qwen weights.

**Companion docs:** [`TODO-ai-data-residency.md`](TODO-ai-data-residency.md)
(the cross-border problem this deal solves for us), [`Research.md`](../Research.md)
§3.7 (the original on-prem sketch), [`scaling.md`](scaling.md),
[`legal/152-fz-dpa.md`](legal/152-fz-dpa.md).

---

## 0. TL;DR

The prospect brings the expensive part (GPU capex) and pre-solves our single
biggest institutional objection (student text leaving Russia). Our provider
layer is already built for it — `services/llm/registry.ts` abstracts providers
and both `DEEPSEEK_BASE_URL` and `QWEN_BASE_URL` are already env-overridable
against an OpenAI-compatible endpoint.

The work is **not** in the LLM layer. It is in four places:

1. **Adapters** for the remaining hosted dependencies (storage, OCR, search,
   embeddings) — the LLM registry is the template.
2. **Control plane** — a separate service + database that every deployment,
   *including our own cloud*, reports to. The admin dashboard reads only this.
3. **Delivery** — an immutable versioned artifact pipeline replacing today's
   rsync-the-working-tree deploy.
4. **Process** — release channels, supported-version window, expand/contract
   migrations, support bundles.

Items 3 and 4 are worth doing regardless of whether this deal closes.

---

## 1. What "on-prem" actually means — pin this down first

Five models, a spectrum of who operates what. Procurement will use these words.

| Model | Runs where | Operated by | Data leaves? |
|---|---|---|---|
| **Multi-tenant SaaS** | Our cloud, shared | Us | Yes |
| **Single-tenant / dedicated** | Our cloud, isolated instance | Us | Yes |
| **BYOC** (bring your own cloud) | *Their* infrastructure/account | Us, via a management channel | No |
| **Self-managed / on-prem** | Their infrastructure | Them | No |
| **Air-gapped** | Their infrastructure, no egress | Them | No, and nothing in either |

**BYOC is the underrated middle path and should be put on the table.**
Confluent, Databricks, ClickHouse and Redpanda all lead with it precisely
because it answers "our data cannot leave" without handing operations to a
customer who doesn't want them. Given this university is already standing up
GPU infrastructure, "your hardware, our operations" may be an easier sell than
either extreme — their IT department does not want to run our platform.

**Recommendation:** sell **self-managed with an outbound allowlist** (or BYOC)
as v1. Treat **air-gap** as a separately scoped and separately priced project.
Most institutions that say «локально» accept an allowlist once their ИБ
realises air-gap means no model updates and no vendor support.

---

## 2. Dependency inventory — what breaks outside our cloud

Everything in `.env.example` pointing at a hosted service is a decision.

| Dependency | Today | On-prem answer | Effort |
|---|---|---|---|
| **LLM chat** | DeepSeek API (CN) / Yandex | Their vLLM, via existing base-URL override | **Near zero** — see §3 |
| **Embeddings** | Yandex `text-search-doc`, `vector(256)` | Local model, MRL-truncated to 256 dims | Medium — see §3.4 |
| **Object storage** | Yandex Object Storage (S3) | MinIO — `@aws-sdk/client-s3` + endpoint override | Low |
| **OCR** | Yandex Vision | Local VLM (Qwen3-VL) on their GPUs, or Tesseract | Medium, quality delta |
| **Web + image search** | Yandex Search API | Degrade — already optional per `.env.example` | Low (document it) |
| **Email** | Unisender Go → SMTP | Their SMTP / Exchange | Low |
| **Payments** | T-Bank acquiring | Disabled; revenue via `institution_contracts` | Low |
| **SSO** | SAML SP (+ Keycloak compose already present) | Their IdP — arguably better on-prem | Low |
| **LTI** | Already implemented | Their LMS | None |
| **CDN purge** | `yc cdn` in `deploy.sh` | No-op | None |
| **Backups** | Yandex bucket, `backupDatabase.ts` | Their backup policy / local MinIO | Low |
| **Telegram alerts** | `lib/telegramAlert.ts` | Route to control plane, or their channel | Low |
| **Frontend config** | `VITE_API_BASE_URL` baked at build time | **Must move to runtime config** | Low but real |

The frontend one is easy to miss: one artifact cannot serve many deployments
while the API base URL is compiled in. Needs a served `/config.js` or a
runtime `window.__ISPUM_CONFIG__` bootstrap.

---

## 3. Self-hosted DeepSeek + Qwen — portability findings

### 3.1 What already works

vLLM/SGLang expose an OpenAI-compatible `/v1/chat/completions`. Both providers
are plain axios against that shape with env-overridable endpoints:

- `DEEPSEEK_BASE_URL` + `DEEPSEEK_MODEL_FLASH` / `DEEPSEEK_MODEL_PRO`
- `QWEN_BASE_URL` + `QWEN_MODEL_FLASH` / `QWEN_MODEL_THINKING`

`services/llm/deepseek.ts:12` states the intent explicitly: *"so we can later
point at our own hosted DeepSeek inference (vLLM …) without code changes."*
vLLM's `--api-key` satisfies the non-empty `DEEPSEEK_API_KEY` requirement.

**Verify with a spike before promising it**, but the seam is real.

One small unlock: `services/llm/institutionResolver.ts:14` restricts `VALID`
to `deepseek | yandex`, so Qwen is not institution-selectable. `qwen.ts`
explains why — DashScope is not RU-resident and *"the sovereignty story needs
self-hosted Qwen weights first."* They are bringing self-hosted Qwen weights.
That question is now answered; the allow-list in `routes/institution.ts` opens
alongside it.

### 3.2 The thinking toggle may fail silently — test this first

`services/llm/qwen.ts:30-36` already records the trap: the open-weight
`qwen3-235b-a22b` release **ignores** `enable_thinking` and needs a separate
`-thinking-` model id instead. The same risk applies to self-hosted DeepSeek
weights, where V4's one-model-plus-toggle shape may not hold.

If the toggle is ignored, `opts.reasoner` silently returns non-reasoning
output. Calc grading (`services/grading.ts`), ВКР recomputation
(`services/longReview.ts:1128`) and calc verification keep *working* and are
quietly worse, with nothing in the logs.

**This is the single highest-priority item in the technical spike**, precisely
because it does not announce itself.

### 3.3 Which checkpoints, exactly

«У нас есть DeepSeek» spans full R1/V3-class (671B MoE, 8×H100-class) down to
a 7B distill on two consumer cards. This single fact determines whether we
ship at parity or visibly degraded. Required from them: checkpoint names,
quantization, GPU model and count, serving stack. **If the answer is Ollama,
expect throughput problems** — it is not built for concurrent production
serving.

### 3.4 Embeddings — the genuinely hard one

Non-negotiable rule #9 routes every `embed()` through Yandex
(`services/llm/registry.ts`), and the schema is `vector(256)` — migration 024,
Yandex `text-search-doc`. Inside their perimeter that call may be blocked.

**Cleanest answer:** Qwen3-Embedding-0.6B served on the same vLLM, with MRL
output truncated to **256 dims** — schema, indexes and every query untouched,
no migration.

Rule #9 must then be restated:

> **One embedding provider per deployment, fixed for that deployment's life.**
> Vector spaces are not comparable across providers. Changing it later requires
> a full re-embed (`npm run backfill:embeddings`), and an on-prem deployment's
> vectors can never merge with cloud ones.

That last clause is a strategic cost, not just a technical one — see §10.

### 3.5 Silent fallback is an audit landmine

`fallbackOrThrow()` in `registry.ts` retries on DeepSeek whenever a
non-DeepSeek provider fails. On-prem this is harmless *if* DeepSeek points at
their local box — but leave one cloud key in the env and a local inference
outage silently ships student text to `api.deepseek.com`.

This is exactly what their ИБ will look for in an audit. **On-prem mode must
hard-deny non-allowlisted egress and fail loudly instead of falling back.**
Design point, not a bug today.

### 3.6 Strict JSON mode

Both providers declare `strictJsonMode: true`. vLLM's structured-output flag
shape varies by version; if `response_format` is ignored, `chatJSON` silently
drops into its parse-and-retry path — correct, but it doubles calls on a GPU
that is already the bottleneck. Make it a per-deployment capability flag
rather than a hardcoded `true`.

### 3.7 Cost accounting becomes fiction

`calculateDeepSeekCost` / `calculateQwenCost` (`config/planLimits.ts`),
`spendCap.ts`, `globalSpendCap.ts`, `featureSpendCap.ts`, `capacityModel.ts`
and `usage_rollup_monthly` all assume per-token API pricing. On-prem the
marginal cost is ~0 and the ₽ figures are meaningless.

On-prem mode should track **tokens and GPU-seconds**. Since this is the data
we monitor them with, it is not cosmetic.

One genuinely useful on-prem-only metric: *"this deployment performed work
equivalent to ₽X of cloud spend"* — trivially derived from token counts and
the cloud rate tables, and it is the number that wins the renewal conversation.

### 3.8 Throughput

SaaS amortises bursts across many customers. One university on 2–4 GPUs
running concurrent grading + presentations + ВКР map-reduce will queue hard —
`longReview.ts` fires a long sequential chain per document. `pg-boss` is
already a dependency; on-prem needs real queueing, a concurrency ceiling tuned
to their GPU count, and honest SLA language («N дипломов/час на вашем
оборудовании»). Unmanaged, this is what sours the pilot.

### 3.9 Free win: the cross-provider ensemble

`gradeEnsemble`'s cross-provider confidence signal needs two model *families*
to be meaningful. They are bringing both DeepSeek and Qwen, so the ensemble,
critique and blind-verification paths work on-prem — which they would not in a
single-model deployment.

### 3.10 OCR gets a better answer than the generic case

With GPUs on site, Yandex Vision can be replaced by a local VLM (Qwen3-VL)
rather than Tesseract. Materially better quality than the fallback we would
otherwise be stuck with.

---

## 4. One codebase, deployment profiles

**Never fork.** Same code, same images, same version everywhere; differences
are config and feature flags. The moment there is an "on-prem branch" there
are two products and half the engineering capacity.

```
DEPLOYMENT_MODE = saas | dedicated | onprem
```

Per-mode behaviour:

| Concern | `saas` | `dedicated` | `onprem` |
|---|---|---|---|
| Entitlements source | DB plan tier | DB plan tier | Signed licence file |
| Payments routes | on | on | off |
| Egress policy | open | open | allowlist, fail loud |
| Provider fallback | to DeepSeek cloud | to DeepSeek cloud | local only, no fallback |
| Cost display | ₽ COGS | ₽ COGS | tokens / GPU-seconds |
| Telemetry | localhost push | push | push or offline export |

Feature parity is expressed through the existing `canUseFeature` seam plus
mode flags — **not** through branches. Publish the parity matrix rather than
letting customers discover gaps (Yandex search grounding and payments will
never exist on-prem).

**Packaging:** Docker Compose (app, Postgres+pgvector, MinIO, nginx; vLLM
external). Helm only if a customer demands it; a Kubernetes operator never, at
this fleet size. Air-gap adds versioned image tarballs + checksums + an
offline installer, and is a separate SKU because it doubles release testing.

---

## 5. Fleet monitoring — control plane / data plane

### 5.1 The core decision

`AdminOverview`, `AdminUsage` and `AdminCapacity` query production Postgres
directly. That does not stretch to a database behind a university firewall.

The tempting wrong fix is to keep SaaS tiles on local queries and add separate
on-prem tiles fed by telemetry — two code paths per page, drifting within a
quarter.

**Instead: split the data plane from the control plane, and make our own cloud
just another deployment.** Every deployment — including SaaS — pushes the same
envelope to a separate control plane. The admin dashboard reads *only* the
control plane. One code path, and our cloud deployment is the one we develop
and test against.

```
┌─ deployment #1: ИСПУМ Cloud (SaaS, many institutions) ─┐
│  app + postgres  ──agent──┐                            │
└───────────────────────────┼────────────────────────────┘
┌─ deployment #2: on-prem (their DC, their GPUs) ────────┐
│  app + postgres + vLLM ───┼──> signed HTTPS, outbound  │
└───────────────────────────┼────────────────────────────┘
┌─ deployment #3: air-gapped ───────────────────────────┐
│  app + postgres  ──> signed export file ──> manual ────┼──┐
└───────────────────────────┼───────────────────────────┘  │
                            ▼                              ▼
                   ┌────────────────────────────────────────┐
                   │  CONTROL PLANE (own host + own DB)     │
                   │  ingest → deployments, heartbeats,     │
                   │  usage_monthly, incidents              │
                   └──────────────────┬─────────────────────┘
                                      ▼
                            Admin dashboard (fleet view)
```

Two rules learned the hard way industry-wide:

- **The control plane is never in the request path.** No user action blocks on
  a call to our servers. Licence checks read a locally cached signed file;
  telemetry is fire-and-forget. Control plane down ⇒ every deployment keeps
  serving.
- **The link is outbound-only.** No inbound ports, no VPN for the baseline.
  This is what makes it approvable in one meeting instead of six.

The control plane must live on its own host and database — it has to survive
the SaaS data plane being down, or an outage removes our ability to observe
the outage.

### 5.2 The telemetry envelope

`institution_rollup_monthly` (migration 107) is already the right grain and
already PII-free. The envelope wraps it with platform, model and health
context:

```
envelope:  deployment_id, license_id, sent_at, agent_version, signature
platform:  app_version (VERSION), schema_version (max migration), uptime
health:    db ok, pg-boss queue depth, failed jobs 24h
models:    [{provider, model_id, endpoint_host, quantization,
             tokens_per_sec, calls_24h, error_rate}]
usage:     institution_rollup_monthly rows + per-feature call counts
seats:     active vs licensed
incidents: production_incidents counts by error_code + message class only
```

**Two rules that make this sellable to their ИБ:**

1. **Aggregates and identifiers only.** Never submission text, never teacher
   names or emails. Teachers appear as an opaque per-deployment hash, if at all.
2. **The exact payload is inspectable in their own admin UI** before it is
   sent, and documented as a contract appendix rather than buried.

That transparency is the mechanism, not a nicety. GitLab's Service Ping is the
reference implementation: published schema, customer-previewable, aggregate
only, opt-out with a *commercial* consequence (loss of reporting features)
rather than technical enforcement. A telemetry channel a customer cannot
inspect gets blocked at their firewall and we find out six months later.

The `models` block is the least obvious and most important part. When their
sysadmin swaps a checkpoint or upgrades vLLM, our grading quality changes;
without model identity in the heartbeat we would never know why the complaints
started.

### 5.3 Control-plane schema — four tables

- **`deployments`** — id, name, mode, licence ref, contacts, first_seen,
  last_heartbeat_at, current_version, status
- **`deployment_heartbeats`** — raw signed envelopes as JSONB, append-only.
  Audit trail, and it allows recomputing derived tables when the schema changes.
- **`deployment_usage_monthly`** — flattened rollups. Literally
  `institution_rollup_monthly` plus a `deployment_id` column.
- **`deployment_incidents`** — flattened counts by deployment **and version**.

### 5.4 Dashboard IA — what each existing page becomes

| Today | Becomes |
|---|---|
| `AdminOverview` | **Fleet overview** — one card per deployment: status dot, version, seats, last heartbeat, 24h errors. Click through to a single deployment. |
| `AdminUsage` | Same charts + a deployment dimension/filter; source swaps to `deployment_usage_monthly`. |
| `AdminCapacity` | Splits by mode. Cloud keeps ₽ COGS/margin; on-prem shows tokens/sec, queue depth, GPU saturation. |
| `AdminErrors` | Grouped by deployment **and version** — how we spot "only on the 2026-08 build". |
| `AdminInstitutions` | Stays for cloud tenants; on-prem deployments live under the fleet page. |
| `AdminPayments` / `AdminPricing` | Cloud-only. On-prem revenue via `institution_contracts` (migration 105), extended with licence terms. |
| **new: Развёртывания** | Deployment registry — licences, versions in the field, supported-model matrix, upgrade status, heartbeat health. |

### 5.5 Model connectivity, not customer type

Do not branch on SaaS vs on-prem. Branch on **connectivity**:

1. **live** — heartbeat within threshold (cloud, dedicated, connected on-prem)
2. **stale** — no heartbeat in N hours. Data exists but is old. This is an
   alert, not a state to render silently.
3. **offline** — never heartbeats by design; data arrives as a signed monthly
   export. Same tables, `source = 'offline_export'`.

**Every tile must render a freshness badge.** A three-week-old number shown as
if live is worse than a blank — that is the failure mode that has us telling a
customer their usage is X when it is not.

### 5.6 Why this is smaller than it sounds

Almost every piece exists:

- `institution_rollup_monthly` — the payload, computed by `services/usageRollup.ts`
- `production_incidents` (migration 072) — the incident feed
- `VERSION` — version reporting, read by `lib/version.ts`
- `jose` — envelope signing, same key mechanism as the licence
- `pg-boss` — the scheduled heartbeat job
- `npm run rollup:backfill` / `unitEconomics.ts` — the aggregation already runs

The agent is: pg-boss cron → collect → sign → POST → record ack. The ingest
endpoint plus four tables is small. **The real work is adding a deployment
dimension to every existing admin query and page** — mechanical, not hard.

---

## 6. Licensing and entitlements

- **Signed licence file**, offline-verifiable (Ed25519 or JWT via `jose`).
  Contains customer, deployment id, seats, feature set, expiry, mode. Verified
  locally, **no network call**.
- **Fail open, always.** Expiry degrades to a warning banner, then to limited
  mode, over weeks. Never hard-kill mid-semester — it is a reputational
  catastrophe and gets negotiated out of the contract anyway.
- **Seat true-up, not enforcement.** Count and report usage; reconcile at
  renewal. Blocking the 51st teacher on a 50-seat licence during exam week
  creates a support crisis to collect money we would collect regardless.
- **It is a contract instrument, not DRM.** Code on their machines can be
  patched. The licence exists so an honest customer stays compliant and an
  auditor has something to check. Over-engineering it is wasted effort.

In `onprem` mode, `canUseFeature` / `checkPlan` read the licence instead of the
DB plan tier. Same call sites, different source.

---

## 7. Release and delivery model

### 7.1 What we do today, and why it does not stretch

`deploy.sh` rsyncs the **working tree** to the VM, compiles TypeScript on the
production box, migrates, reloads PM2. `main` is defined as "whatever is live".
There is no artifact — the deployable thing is a laptop filesystem at the
moment the script ran.

**Latent problem to fix now:** `BUILD_VERSION` is
`$(git rev-parse --short HEAD)`, but rsync ships uncommitted changes. Deploying
with a dirty tree puts code in production that no commit contains, stamped with
a commit that does not describe it. Survivable with one server; fatal with a
fleet, because the version string is the only way to attribute a bug report to
a build — and the whole telemetry story rests on it.

### 7.2 The shift: pushing source → publishing artifacts

We cannot rsync into a university, cannot run `npm install --include=dev`
behind their firewall, and should not run a TypeScript compiler on any
production machine.

**New model:** CI builds an immutable versioned artifact; every environment —
including ours — *pulls* the version it is entitled to.

**Daily loop, cloud (nearly unchanged):**

```
edit → npm test → git commit && git push
  → CI: test, build image, tag version+SHA, push to registry
  → ./deploy.sh: pull that tag on the VM, migrate, reload
```

The inner loop is untouched. The one real difference: **uncommitted work can
no longer be deployed** — a feature, not a cost. It also improves today's
deploy immediately: no compiler on prod, no `rm -rf dist` on a live box, and
rollback becomes "repoint to the previous tag and restart".

**Self-managed release (rare, deliberate):**

```
git tag v1.7.0  (on a commit live on ispum.ru for weeks)
  → CI: images + air-gap tarball + checksums + Russian changelog
  → publish to the release channel
  → their admin UI shows «доступно обновление 1.7.0» (via control plane)
  → their sysadmin runs ./upgrade.sh in their maintenance window
  → next heartbeat reports the new version → fleet dashboard goes green
```

**We never push to them.** They pull, on their schedule, when students are not
submitting coursework. Practical necessity and contractual boundary both.

### 7.3 Two channels — cloud is the canary

Same commits, two cadences:

- **cloud** — continuous, deploys on merge, as now
- **stable** — cut quarterly, or aligned to semester boundaries

Rule: **nothing ships to a self-managed customer that has not served real
traffic on ispum.ru for weeks.** The business model hands us a free canary; it
costs only patience.

### 7.4 Version identity

`2026-08-12+667619c` is a build stamp — fine for one live copy, useless as
something a customer says out loud. Add semantic versions (`1.7.0`) mapped to
git tags, appearing in the licence, the support matrix and `/api/health`, with
date+SHA retained as build metadata.

`CHANGELOG.md`'s `[Unreleased]` → dated convention becomes the source for
customer-facing release notes (which need a Russian, non-engineering register).

### 7.5 Release branches and hotfixes — the new ceremony

```
fix on main → cloud immediately
  → cherry-pick onto release/1.7 (and any other supported line)
  → tag v1.7.1 → publish → notify affected deployments
```

One or two maintained release branches. This is the main organisational tax,
and it is why the **supported-version window (N-2)** belongs in the contract —
it is literally how many branches we agree to patch.

### 7.6 CI gains three jobs, not one

1. Unit + integration tests (exist today)
2. **Bundle smoke test** — boot the compose bundle from scratch, migrate, hit
   `/api/health`, run a grading call against a stub
3. **Upgrade test** — restore a DB snapshot at the *oldest supported version*,
   migrate to HEAD, boot, smoke

Job 3 is the one every vendor skips and every vendor regrets. Our migration
runner (`backend/scripts/migrate.js`) is already suitable: file-tracked,
idempotent, sorted, forward-only. Mostly harness work.

### 7.7 Migration discipline: expand/contract

With N deployments across M versions, a migration must leave the schema
compatible with the **previous** release, so rolling code back does not break
against an already-migrated database. Add a column → deploy code writing both
→ drop the old column a release later. Never rename or drop in the same
release that stops using something.

Longest-tailed discipline change here, and the cheapest time to adopt it is
now, with one deployment to be wrong about.

### 7.8 Config validation at boot

Today: one `.env` on one VM, hand-edited, fully understood. With a university
sysadmin configuring `DEEPSEEK_BASE_URL` against their vLLM, we need
**boot-time validation per deployment mode** — required vars present,
endpoints reachable, model responding — failing loudly with an actionable
message. Otherwise a typo becomes «ИСПУМ не работает» three days later instead
of a clear startup error.

### 7.9 What does not change

Local development, testing, git workflow, and the FEATURES / CHANGELOG / TODO
discipline in `CLAUDE.md`. `deploy.sh` still exists and still ends with a
health check — it promotes an image instead of rsyncing source.

---

## 8. Support model

Assume **no access to the customer's environment**, from day one.

- **`support:bundle` command** — one command collecting logs, config (secrets
  redacted), schema version, health and model identity into a file they email
  us. Highest-ROI item on this entire list; build it in Phase 3, not after the
  first incident.
- **Tiered access as an exception** — time-boxed accounts granted per incident,
  screen-share as fallback. Never assume standing SSH.
- **Runbooks for their admins, in Russian.** `docs/support/runbooks/` is the seed.
- **Named technical contact on their side, in the contract.** Without it every
  incident routes through a procurement officer.

**Honest limits:** we see aggregates, never causes. When a teacher there says
grading is wrong, we cannot open the submission. And their sysadmin can switch
the heartbeat off — handle that contractually, and technically treat heartbeat
absence as an event rather than a gap in a chart.

---

## 9. Russia-specific constraints

The standard vendor toolchain for all of this — Replicated (KOTS,
troubleshoot.sh), Keygen, LicenseSpring, reliable Docker Hub — is largely
US-hosted with payment and sanctions friction. The usual advice ("don't build
this, buy Replicated") does not apply to us.

**That is fine at our scale.** That tooling manages fleets of hundreds; we will
have between one and twenty deployments for years. A signed licence file, a
phone-home job, a support-bundle script and a Compose bundle is a few weeks of
work, all of it code we understand.

Likely to surface in procurement:

- **Реестр отечественного ПО** — frequently mandatory for state university
  purchases, and an on-prem deployable is usually a prerequisite for entry.
  **Check our status early; this may be a bigger commercial lever than the
  deal itself.**
- **ФСТЭК-certified base OS** (Astra Linux, RED OS) if their ИБ requires it —
  changes base images and the test matrix.
- **Self-hosted registry mirror** (Harbor, or Yandex Container Registry) — we
  cannot rely on customers pulling from Docker Hub.
- Telemetry endpoint must be RU-hosted (it already is).

---

## 10. Commercial framing

- **Separate SKU**: implementation/setup fee (not bundled into the licence) +
  annual licence + support tier + minimum term.
- **Their GPU ⇒ our COGS on that account is ~0.** Flat per-seat licensing, high
  margin, and a strong renewal story via the "equivalent cloud spend" metric.
- **Supported-models matrix in the contract.** We warrant quality on
  checkpoints we have evaluated, not on whatever gets loaded next semester.
  This clause is worth more than the licence file.
- **The RAG flywheel breaks.** Their approved grades never reach our corpus
  (§3.4 — vectors are deployment-local by construction). Our data moat stays
  cloud-only. Either negotiate optional anonymised contribution, or accept it
  and price on-prem as a licence business rather than a compounding one.
- **Reference value.** This deployment answers both the on-prem ask *and* the
  parked cross-border problem, and becomes the reference architecture for every
  other state university.

**Make the deal contingent on:** a paid implementation fee; their GPU or
written acceptance of a measured quality delta; a named sysadmin counterpart;
aggregate telemetry permitted. If they refuse GPU, telemetry *and* outbound
access simultaneously, that is a different and much larger project — price it
as one or walk.

---

## 11. Phasing

**Phase 0 — technical spike (2 weeks, before signing).**
Get endpoint access or replicate their checkpoints on a rented GPU. Run
`runEval.ts`, `evalPresentations.ts`, `runConfidenceEval.ts` against it via
`providerOverride` — built for exactly this comparison. Verify the thinking
toggle (§3.2), JSON mode (§3.6), embedding dims (§3.4), throughput (§3.8).
**Output:** a measured quality delta and a throughput number, so we negotiate
with data instead of hope.

**Phase 1 — artifact pipeline + control plane skeleton (worth doing regardless).**
CI-built images, semantic versions, image-promotion deploy. Control-plane
tables with our own cloud pushing to itself over localhost. Full architecture,
one deployment, zero on-prem risk; everything after is additive.

**Phase 2 — adapters + deployment profiles.**
Storage/OCR/search/embedding adapters on the LLM-registry pattern.
`DEPLOYMENT_MODE`. Runtime frontend config. Egress policy. Boot-time config
validation. Licence file + `canUseFeature` wiring.

**Phase 3 — packaging + fleet UI + support.**
Compose bundle, installer, upgrade script. Telemetry agent + ingest. Fleet
dashboard (deployment dimension across existing admin pages). `support:bundle`.
Russian runbooks.

**Phase 4 — release process hardening.**
Release branches, stable channel, N-2 window, upgrade test in CI,
expand/contract adopted as policy.

**Phase 5 — air-gap, only if actually required.**
Offline image bundles, offline licence, signed offline usage export.

---

## 12. Discovery questionnaire — send to their ИБ / IT before quoting

**Perimeter & network**
1. Is outbound HTTPS to a small allowlist possible, or is this strictly air-gapped?
2. Would BYOC (their infrastructure, our operations via a management channel) be acceptable?
3. Is aggregate, PII-free telemetry to a RU-hosted endpoint acceptable? What must it exclude?

**Inference**
4. Exact checkpoints and quantization for DeepSeek and Qwen?
5. GPU model and count? Serving stack (vLLM / SGLang / Ollama)?
6. Do they also host an embedding model, or must we provide one?
7. Who operates inference — them or us? What is their process when a model is updated?

**Platform**
8. OS requirement — is a ФСТЭК-certified distribution (Astra Linux / RED OS) mandatory?
9. Container runtime available? Internal registry we can mirror into?
10. Postgres: may we ship our own (with pgvector), or must we use their managed instance?
11. Backup and DR policy — theirs or ours?

**Identity & integration**
12. SSO: SAML or LDAP, which IdP?
13. LMS for LTI integration?
14. SMTP relay available for outbound mail?

**Operations & commercial**
15. Who operates the platform day to day — them or us?
16. Maintenance/upgrade windows and change-approval process?
17. Named technical contact?
18. Seat count, expected concurrency, semester peak profile?

---

## 13. Deliberately not building

- A Kubernetes operator
- A self-service customer portal
- Real DRM / tamper-proof licensing
- Inbound remote-access tunnels
- A separate on-prem codebase or branch

At one-to-twenty deployments, each of these costs more than it returns.

---

## 14. Open decisions

- [ ] Propose **BYOC** to this university as the middle path? (§1)
- [ ] Confirm our **Реестр отечественного ПО** status — possibly a bigger lever than this deal (§9)
- [ ] Air-gap: separate SKU, or decline for now? (§1)
- [ ] Accept that on-prem customers do not feed the RAG flywheel, or negotiate anonymised contribution? (§10)
- [ ] Release cadence for `stable`: quarterly, or semester-aligned? (§7.3)
- [ ] Prompts as shipped content vs. compiled-in code — and the IP exposure that follows (§15.2)
- [ ] Who holds `platform_admin` inside their deployment? (§15.6)
- [ ] Source escrow and business-continuity clauses — decide policy before procurement asks (§15.7)
- [ ] Is this deal worth displacing the existing pilot roadmap? (§15.9)

---

## 15. Additional findings (2026-08-14 review)

Nine items surfaced after the first draft. Two of them (15.1, 15.2) change the
critical path.

### 15.1 There is no CI in this repository — at all

No `.github/`, no pipeline of any kind. §7.6 says "CI gains three jobs"; it
actually gains **its first job**. Every downstream item — immutable artifacts,
version honesty, release branches, the upgrade test, image scanning, SBOM —
assumes a build server that does not exist.

This is the true Phase 1 prerequisite and the item most likely to blow the
schedule, precisely because the current plan renders it invisible.

### 15.2 Prompts are compiled into the code, and that freezes our fastest loop

Prompts live inline across 20+ files in `backend/src/services/` (`grading.ts`,
`presentations.ts`, `longReview.ts`, `topics.ts`, `fosGenerator.ts`, …). There
is no `prompts/` module.

Under a quarterly release train, **an on-prem customer's grading quality
freezes for three months at a time.** A prompt fix shipped to cloud on a
Tuesday reaches them in November. Prompt iteration is our fastest improvement
loop, and self-managed throttles it to the slowest cadence we have.

**Fix:** make prompts — and rubric templates, criteria libraries, FGOS
reference data — **versioned content shipped independently of code**. A signed
*content pack* the deployment pulls from the control plane, or applies from a
file when air-gapped. Same pattern security vendors use for detection rules:
engine on a slow cadence, content on a fast one. Cloud benefits too — prompt
changes stop requiring a deploy.

**Do this before the first on-prem release, not after.** Retrofitting it once
a customer is live means their first three months are on frozen prompts.

**IP dimension of the same fact:** our prompts *are* the product, and on-prem
they sit as readable JS on a university server. Minification is theatre. The
real answer is contractual (non-reverse-engineering clauses) plus accepting
that iteration speed is the moat — but it must be a conscious decision, not a
discovery.

### 15.3 Canary evals running inside their deployment

We have `services/evalHarness.ts`, the `eval_runs` table and
`scripts/runEval.ts`. Ship a small **synthetic** corpus — never real student
work — run it on a schedule inside their deployment, and report the scores in
the heartbeat (§5.2).

This converts "we are blind to their quality" into a tracked number, and
catches the exact failure we most fear: their sysadmin swaps a checkpoint and
grading quietly degrades (§3.2). Mostly assembly of parts that already exist.
**Highest value-per-effort item in this document.**

### 15.4 Cloud pilot first, then migrate

The realistic sequence is not on-prem from day one: a small cloud pilot proves
value while procurement grinds, then the deployment moves into their perimeter.
That de-risks the whole engagement.

It requires a **deployment-level export/import path** that does not exist —
`services/accountExport.ts` is per-account. Migration necessarily **re-embeds
everything** (§3.4: vector spaces do not transfer; `npm run
backfill:embeddings` is the tool). Build it deliberately rather than
improvising under deadline.

### 15.5 Procurement security artifacts

State university ИБ increasingly requires an **SBOM**, **container image
vulnerability scanning**, a documented **CVE patch SLA**, and sometimes a
**pentest report**. `docs/legal/security-overview.md` is the base to extend.

Cheap once CI exists (Trivy + SBOM generation are a few lines), and frequently
a hard gate — have them before the questionnaire comes back.

Related and nearly free: **a `/metrics` endpoint** (none today) so their ops
team can watch ИСПУМ in their own Zabbix/Prometheus. Low cost, and it makes
their infrastructure people allies rather than obstacles.

### 15.6 Who holds `platform_admin` inside their deployment?

Unresolved governance hole. The role sees everything and can change provider
settings, model config and institution-wide flags. If they hold it, they can
break their own support contract. If we hold it, they will object on principle.

Likely answer: **they hold it, and the licence gates which platform-admin
actions are available in `onprem` mode.** Decide before go-live.

### 15.7 The legal posture inverts, and one detail bites

On-prem, **they** become the оператор ПДн and we stop processing their data
entirely — our 152-ФЗ posture simplifies, and the DPA becomes a licence +
support contract.

The detail: the §5.1 attestation flow has students consenting without accounts,
and `CONSENT_VERSION` plus the consent copy in `routes/publicWrite.ts` name
ИСПУМ as the party. That wording is deployment-specific on-prem and must be
parameterised.

Also expect procurement to ask for **source escrow** and a
**business-continuity clause** — Russian state buyers routinely do. Decide the
policy before they ask.

### 15.8 Support capacity is the constraint, not code

When their deployment is down at 09:00 during exam week, who answers? Match the
SLA to the team that actually exists — **business hours only in the first
contract, explicitly written.** Vendors are hurt by self-managed customers
through support load, not engineering.

### 15.9 Opportunity cost against the existing pilot

`docs/KNITU-feature-map.md`, `docs/KNITU-roadmap.md` and
`docs/rop-pilot-onboarding.md` record live pilot commitments. Tracks 1–2 below
improve the cloud product regardless; **Tracks 3–4 are months of work shipping
zero features to existing users**, carried for one customer.

Is this deal large enough — or strategically load-bearing enough (Реестр, the
state-university segment, the sovereignty story) — to justify displacing the
pilot roadmap? Probably yes, but decide it explicitly with a number attached,
not by drift.

---

## 16. Ordered plan

Tracks are ordered by dependency. Within a track, numbered items are largely
sequential; tracks 1 and L run in parallel.

**Legend:** ▲ = blocks other work · ◆ = valuable even if the deal dies ·
◇ = on-prem-only cost

### Track 0 — Before signing (weeks 1–3, near-zero engineering)

| # | Item | Notes |
|---|---|---|
| 0.1 ▲ | Send the §12 discovery questionnaire | Unblocks every sizing decision. Do this first, today. |
| 0.2 ◆ | Confirm **Реестр отечественного ПО** status | May be a bigger commercial lever than the deal (§9) |
| 0.3 ▲ | **Technical spike** — thinking toggle (§3.2), JSON mode (§3.6), embedding dims (§3.4), throughput (§3.8), quality delta via `runEval.ts` / `evalPresentations.ts` / `runConfidenceEval.ts` with `providerOverride` | 2 weeks. Produces the numbers we negotiate with. |
| 0.4 | Decide deployment model: BYOC vs self-managed vs air-gap (§1) | Depends on 0.1 |
| 0.5 | Decide opportunity cost vs pilot roadmap (§15.9) | Depends on 0.3 giving a real effort estimate |

> **Gate:** do not sign without 0.3's measured numbers and 0.5's explicit decision.

### Track 1 — Foundations (do regardless of the deal) ◆

Strictly sequential; each unblocks the next.

| # | Item | Why here |
|---|---|---|
| 1.1 ▲◆ | **CI from zero** — typecheck + unit tests on push (`.github/workflows/ci.yml`) | §15.1. Nothing else in this plan is possible without it. **✅ shipped 2026-08-15** — Node 20 to match prod. |
| 1.1b ◆ | **Integration tests in CI** — `pgvector/pgvector:pg15` service container (matches prod), disposable `.env.test` via `backend/scripts/generateTestEnv.ts` | **✅ shipped 2026-08-15**, green — 27 files / 200 tests. (Two stale §7.10 tests in `domainAccess.integration.test.ts` surfaced with it and were rewritten to the current domain design, not skipped.) |
| 1.2 ◆ | **Version honesty** — fail the deploy on a dirty tree; semantic version; `VERSION` carries `1.5.0 (date+SHA)` | §7.1. Every telemetry claim rests on it. **✅ shipped 2026-08-15** — semver single-sourced from the root `package.json` (now `1.5.0`); deploy warns when no matching `v{semver}` git tag exists. Tag enforcement becomes a hard gate for `stable` in Track 4.1. |
| 1.3 ▲◆ | **Build artifact in CI** — `backend/Dockerfile` (multi-stage, Debian-based), built on every run, pushed to Yandex Container Registry when secrets are set | The source→artifact inversion (§7.2). **✅ shipped 2026-08-15.** Publishing is opt-in: set `YC_REGISTRY_ID` + `YC_SA_JSON_KEY` repo secrets to turn it on; until then the image is built (proving the Dockerfile works) but not pushed. Runtime smoke test of the image deferred to 3.7 — the build asserts the entry point exists, but nothing boots the container yet. |
| 1.4a ◆ | **Cluster-safe schedulers** — replace the PM2 `NODE_APP_INSTANCE` worker-0 gate with a Postgres lease (migration 112, `services/schedulerLease.ts`) | **✅ shipped 2026-08-15.** Discovered while scoping 1.4: that variable is set only by PM2, so in a container every replica reads itself as worker 0 and renewals/payment reconciliation would fire once *per replica*. Any replica count is now safe. |
| 1.4b ◆ | **`deploy.sh` promotes an image** instead of rsyncing source; rollback = repoint tag | Immediately better than today: no compiler on prod, real rollback. **✅ shipped 2026-08-15**, one replica, prerequisites completed by hand via the YC console. |

**1.4b prerequisites — all completed 2026-08-15 (operator actions, done by hand via the console, not code):**
1. ✅ Yandex Container Registry `ispum-backend` created (image scan on upload + weekly full-registry scan enabled). Two scoped service accounts: `ispum-ci-registry` (`container-registry.images.pusher`, key in GitHub secrets `YC_REGISTRY_ID`/`YC_SA_JSON_KEY`) and `ispum-vm-puller` (`container-registry.images.puller`, logged in on the VM via `docker login cr.yandex`) — deliberately separate keys so a compromised VM can only pull, never push.
2. ✅ Docker installed on the VM (`get.docker.com`), `boadtech` in the `docker` group.
3. ✅ **One replica**, chosen deliberately over two — proves the whole pipeline (image build → registry → pull → migrate → restart) with the fewest moving parts before adding the nginx `upstream` complexity a second replica needs. Documented trade-off: a single replica means every future deploy has a few seconds of downtime at container restart — PM2's `pm2 reload` did a zero-downtime rolling restart across 2 workers; a lone container doesn't get that for free. A second replica later is what buys it back, not just throughput. The 1.4a lease already makes either replica count safe.
4. ✅ Postgres stays on the host, unchanged. Made trivial by the `network_mode: host` choice in `deploy/docker-compose.cloud.yml` — the container's `localhost:5432` genuinely is the VM's Postgres, so the existing `DATABASE_URL` needed **zero changes**. Host networking (not a published port) also means the single-replica case needs **zero nginx changes** — nginx already proxies to `127.0.0.1:3000`, and the container binds that same port directly.

**What shipped:**
- `deploy/docker-compose.cloud.yml` — the `api` service (host networking, bind-mounted `uploads/` at the *same* path PM2 used — not a fresh named volume, to avoid silently orphaning existing local-fallback uploads) plus a `migrate` one-shot service (`profiles: [tools]`, same image as `api` — migrating with the exact code about to serve traffic, not whatever was last rsynced).
- `deploy.sh` rewritten: the backend's source no longer goes to the VM at all — only the compose file does. A **CI gate** was added — `deploy.sh` now polls `gh run list` and refuses to deploy until CI has actually passed for the exact commit being deployed (a tag is only a promise if nothing deploys before the promise is checked). The unpushed-commits check was **escalated from a warning to a hard block**: rsync used to ship the working tree regardless of git state, but a pull-based deploy can only fetch an image CI actually built, so an unpushed commit now fails fast instead of failing confusingly at the `docker pull` step. `YC_REGISTRY_ID` added to `.env.example`, deploy-only, same sourcing pattern as `CDN_RESOURCE_ID`.
- **One-time cutover, not automated**: `pm2 delete gradeassist-api && pm2 save`, run by hand once before the first container-based deploy. Deliberately *not* baked into `deploy.sh` — an unconditional `pm2 delete` in every future run would itself fail loudly (`set -e`) the moment PM2 no longer manages anything, breaking every subsequent deploy. Documented as a one-time step in `deploy.sh`'s header instead.
- **✅ Verified end-to-end in production, 2026-08-15.** First live cutover surfaced two real bugs, both fixed same-day:
  1. **CI → registry push failed** on the very first push attempt: `docker/build-push-action@v6`'s default provenance/SBOM attestation manifest is a multi-manifest OCI structure Yandex Container Registry rejects ("Cannot read manifest data") even though every image layer pushed fine. Fixed with `provenance: false` / `sbom: false`.
  2. **`deploy.sh`'s health check could report success while the API was down** — a `curl ... && echo` pattern that looks like it gates under `set -e` but doesn't (POSIX exempts non-last commands in an `&&` list from `-e`). This is what let the first cutover attempt claim "✅ Deploy complete" while the API was actually unreachable. Root incident cause: PM2 got restarted as an emergency fallback mid-debugging and was never stopped again, silently holding port 3000 for hours and blocking the container (host networking → both compete for the same port) — not a bug in the compose file, Dockerfile, or CI pipeline, all of which worked correctly once given a clear port. Fixed by rewriting the check as explicit `if`/`exit`, verified in isolation to actually propagate failure.
  - Confirmed live: `curl https://ispum.ru/api/health` → `1.5.0 (2026-08-15+b71fe95)`, the new container, serving public traffic through nginx unchanged.
- **Post-incident hardening, same day:**
  - The `[8/8]` health check's local-API probe now **retries for up to 30s** instead of a single immediate attempt — `docker compose up -d` returns as soon as the container is *created*, not once Node has actually bound the port, so a single-shot check risked false-negatives on a legitimately slow cold start. On genuine failure it now **dumps `docker logs ispum-api --tail=30` inline** — today's incident took ~10 back-and-forth messages to get from "curl failed" to "here's the actual crash reason"; that diagnosis now happens automatically, in the deploy's own output.
  - **`deploy/rollback.sh <tag>`** — a real script for the "rollback = repoint tag" promise made back in Track 1.3, which until today existed only as a sentence. Pulls and starts a previously-pushed tag; deliberately does not re-run migrations (forward-only/additive by policy, §7.7).
  - **Considered and rejected:** a pre-flight "is port 3000 already in use" check before `docker compose up -d`. With `network_mode: host`, the *previous* container is expected to be listening right up until `up -d` replaces it — a naive check would false-positive on every normal second deploy, not just catch bad ones. Not worth the risk it introduces for the incident it would prevent.

**A second bug found one deploy later — the "uneventful" docs-only deploy wasn't actually clean, and the first fix for it was itself wrong.** `docker compose up -d api` left the container running the *previous* deploy's image, with no error. First fix attempt (`--force-recreate` + a post-deploy image assertion) was built on the theory that Compose's own change-detection was unreliable — that theory was wrong, and the very next deploy proved it: the "fixed" script still produced zero output for `up -d --force-recreate` and its assertion, jumping straight to `[7/8] nginx guard…` right after the migrate step's own output ended. Nothing errored; the commands simply never executed.

**Real root cause:** `docker compose run` (like plain `docker run`) forwards its own stdin into the container by default, even without a real TTY. Inside `ssh ... bash -s <<REMOTE`, the remote script's stdin *is* the rest of the heredoc — so `docker compose run --rm migrate`, run partway through it, was silently consuming every subsequent line (the `up -d`, the assertion, the prune) as data fed to the migrate container; whatever the container didn't read before exiting was discarded, never reaching bash as commands. This explains every anomaly across all three deploys this session, including the very first one that never created a container at all. **Reproduced and verified the mechanism directly**, not inferred: a minimal `bash -s <<REMOTE` with a `read` in the middle silently eats the following line exactly the same way; redirecting that command's stdin from `/dev/null` fixes it completely. Fixed with `docker compose run --rm -T migrate < /dev/null` in `deploy.sh`. `deploy/rollback.sh` was never exposed (no `docker compose run` call there) — its `--force-recreate` + assertion should already have been correct.

**✅ Criterion genuinely met, 2026-08-15, third attempt.** With the real fix shipped, a deploy of that fix itself (commit `780be08`) produced the first *actually* clean run: the health check's local-API probe briefly failed to connect at all (the old container was genuinely stopped, the new one still booting — the first time any deploy this session showed real service interruption during a swap, rather than the old container silently answering the whole time), then succeeded on retry, and `curl https://ispum.ru/api/health` independently confirmed `1.5.0 (2026-08-15+780be08)` — the exact commit just deployed, verified directly against the live site rather than inferred from the script's own exit code. That distinction matters: two prior "clean" deploys this same day looked identical from the script's own output and were both wrong. Verify the live version independently before trusting a deploy's own report of success, until this pipeline has a longer track record.

**When to add the second replica:** the plan's own stated criterion was "prove the single-replica pipeline works completely first." That took three attempts, not one — a real incident (PM2 port conflict), a fix that looked complete but wasn't (the stdin-eating bug hiding underneath it), and finally a fix verified against the live site rather than the script's own report. **Criterion met as of `780be08`** — see above. Recommendation before touching replica count: let this pipeline accumulate a small handful of ordinary, unremarkable deploys first, each spot-checked against the live version independently, given how much confidence the last two "clean-looking" runs turned out not to deserve. Once that's true, the remaining work for replica 2 is mechanical: `PORT` was already env-driven (`config.port`), host networking is already the model, and the Track 1.4a scheduler lease already makes concurrent instances safe — what's left is a second `api` service block in compose with its own `PORT`/`container_name`, the one-time nginx `upstream` edit (§16 Track 1.4b prerequisites), and `deploy.sh`/`rollback.sh` pulling+starting both.
| 1.5 ◆ | **Image scanning + SBOM** in CI (Trivy) | §15.5. Trivial once 1.1+1.3 exist; a procurement gate later. |
| 1.6 ▲◆ | **Control-plane skeleton** — own host + DB, 4 tables, signed ingest endpoint; **our cloud pushes to itself** | §5.3. Full architecture, one deployment, zero on-prem risk. **✅ shipped 2026-08-15** — colocated in the existing DB for now (Phase 1's explicit "own host + DB" deferred to Phase 3, matching §11's sequencing); see below. |

**What shipped:** migration 113 (4 tables — `deployments` seeded with a fixed `ispum-cloud` row, `deployment_heartbeats` as append-only raw JSONB, `deployment_usage_monthly` mirroring `institution_rollup_monthly` + `deployment_id`, `deployment_incidents` grouped by code+version). Per-deployment RS256 keypairs (`backend/scripts/generateControlPlaneKeypair.ts`) — the envelope *is* the signed JWT (`services/controlPlane/signing.ts`), verified two-step (peek `sub` to find the key, then really verify) so one deployment's key can never forge another's telemetry. `POST /api/control-plane/ingest` (`routes/controlPlaneIngest.ts`) — no JWT auth, signature-verified inline, same trust shape as the existing T-Bank webhook route. `buildEnvelope()` (`services/controlPlane/buildEnvelope.ts`) assembles the envelope from data every deployment already computes for itself — `VERSION`, latest migration filename, `getUsageByModel()`, `getInstitutionRollupForMonth()`, grouped `production_incidents` counts — degrading `queueDepth` to 0 rather than crashing the heartbeat if pg-boss isn't ready. The agent (`services/controlPlaneAgent.ts`) ticks every 15 minutes via the Track 1.4a lease, so a second replica later won't double-send. Inert by default — no `CONTROL_PLANE_PRIVATE_KEY` set means the agent never starts.

**Known scope cuts, not oversights:** `failedJobs24h` dropped from the envelope entirely — pg-boss's public API can't isolate it cleanly without querying its internal tables directly, a real risk given this pg-boss version is already pinned old. Incident granularity is `code` only, no message-classification field exists yet to bucket finer. Both documented inline where the cut was made.

**Discovered while testing this, not fully resolved:** the integration suite had no test-mode rate-limit exemption at all — fixed (`SKIP_IN_TEST` added to all 8 limiters in `middleware/rateLimits.ts`) since it was a real, if minor, gap regardless of this feature. That fix did **not** fully explain a separate, lower-frequency flake also observed (a different unrelated test failing under added connection contention, non-deterministically) — confirmed pre-existing via a clean 3-run baseline before this feature's own files existed. Spawned as a separate follow-up rather than chased down here; this feature's own tests are 100% reliable in isolation and combined with the rest of the suite.
| 1.7 ◆ | **`deployment_id` dimension** across admin queries + fleet overview page | §5.4. The bulk of the dashboard work, done while there is one deployment to be wrong about. |
| 1.8 ◆ | **Expand/contract migrations adopted as policy** | §7.7. Cheapest to adopt now. |

> **Gate:** cloud must run entirely on this path for several weeks before anything ships externally.

### Track 2 — Multi-deployment product changes (needs signature or high confidence)

| # | Item | Notes |
|---|---|---|
| 2.1 ▲ | `DEPLOYMENT_MODE` + **boot-time config validation** per mode | §4, §7.8 |
| 2.2 | **Runtime frontend config** — drop build-time `VITE_API_BASE_URL` | §2 |
| 2.3 ▲◆ | **Prompts → content packs** (prompts, rubric templates, criteria, FGOS data), versioned and shipped independently | §15.2. **Earlier than instinct suggests** — retrofitting after go-live means three frozen months. Benefits cloud too. |
| 2.4 | **Adapter extraction** — storage (MinIO), OCR, search, embeddings; `services/llm/registry.ts` is the template | §2 |
| 2.5 | **Embedding provider per deployment**; restate rule #9; wire the re-embed path | §3.4 |
| 2.6 | **Egress policy** — no cross-provider fallback in `onprem`; fail loud | §3.5. Audit-critical. |
| 2.7 | **Licence file** + `canUseFeature` / `checkPlan` wiring; fail-open grace | §6 |
| 2.8 | **Cost accounting in tokens / GPU-seconds** for `onprem`; split `AdminCapacity` | §3.7 |
| 2.9 | **`platform_admin` gating** in `onprem` mode | §15.6 |
| 2.10 ◆ | **Deployment-level export/import** (cloud pilot → on-prem migration, incl. re-embed) | §15.4. Promote earlier if the pilot-first path is chosen. |

### Track 3 — Packaging & operations ◇

| # | Item | Notes |
|---|---|---|
| 3.1 ▲ | **Compose bundle** + installer + `upgrade.sh` | §4 |
| 3.2 | **Telemetry agent** (pg-boss job) + envelope + **customer-inspectable payload page** | §5.2. The inspectable page is what gets ИБ approval. |
| 3.3 | **In-deployment canary eval** → score in heartbeat | §15.3. Highest value-per-effort here. |
| 3.4 | **`support:bundle` command** | §8. Build before the first incident, not after. |
| 3.5 | **`/metrics` endpoint** for their own monitoring | §15.5. Nearly free goodwill. |
| 3.6 | **Russian runbooks + GPU sizing guide** (numbers from 0.3) | §8 |
| 3.7 | **Bundle smoke test + upgrade test** in CI | §7.6. The job every vendor skips and regrets. |

### Track 4 — Release process ◇

| # | Item |
|---|---|
| 4.1 | Release branches + `stable` channel; cloud as canary (§7.3) |
| 4.2 | N-2 supported-version window, written into the contract (§7.5) |
| 4.3 | Content-pack cadence decoupled from code releases (§15.2) |
| 4.4 | Hotfix / cherry-pick procedure documented (§7.5) |

### Track L — Legal & commercial (parallel with Tracks 1–3)

| # | Item |
|---|---|
| L1 | Parameterise §5.1 consent copy + `CONSENT_VERSION` per deployment (§15.7) |
| L2 | Source escrow + business-continuity clauses (§15.7) |
| L3 | Supported-models matrix in the contract (§10) |
| L4 | Telemetry appendix — exact payload schema, published (§5.2) |
| L5 | SLA matched to actual team capacity — business hours in v1 (§15.8) |
| L6 | On-prem SKU: implementation fee + annual licence + support tier + minimum term (§10) |

### Track 5 — Deferred / conditional

| # | Item | Condition |
|---|---|---|
| 5.1 | Air-gap bundle, offline licence, offline usage export | Only if genuinely required; separate SKU |
| 5.2 | Helm chart | Only on customer demand |
| 5.3 | Fine-tuned RU pedagogical model (Research.md §3.8) | Independent bet; on-prem GPUs make it more attractive |

### Critical path

```
0.1 questionnaire ──┐
0.3 spike ──────────┴─> 0.5 go/no-go
                              │
1.1 CI ─> 1.3 artifact ─> 1.6 control plane ─> 1.7 fleet UI
                              │
                    2.1 mode ─┴─> 2.3 content packs ─> 3.1 bundle ─> 3.2 telemetry ─> 3.3 canary eval
```

**If only five things get done:** 1.1 (CI), 1.3 (artifacts), 1.6 (control
plane), 2.3 (content packs), 3.3 (canary evals). The first three are owed to
the cloud product anyway; the last two are what keep an on-prem customer from
silently degrading while we watch a dashboard that says everything is fine.
