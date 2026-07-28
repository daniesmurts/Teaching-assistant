
# Топология программы — Product & Engineering Spec

**Status:** draft v2 (2026-07-28) · **Home:** `docs/topology-spec.md`
**Supersedes/extends:** the «Учебные планы (program architecture analysis)» feature (FEATURES.md) — that feature's analysis becomes the *report view* of this graph; this spec is the graph itself plus what is built on it.
**Builds on:** `programAnalysis`, `documentReview`, `syllabusReview`, `curriculumAnalysis`, `programReportPdf`, the ФГОС 3++ registry (Feature AA), the ФОС generator (Feature X), the programme-access model + domain axis (§7.10), Yandex textEmbedding, the global audit middleware.

**What changed in v2:** scope tightened to the graph + dashboard + sandbox (R4/R5 explicitly deferred); competency identity moved onto the ФГОС registry instead of per-programme PDF extraction; ФОС split into the authored path (cheap) and the ingest path (expensive); edge identity/provenance/stability promoted from an implementation detail to the founding problem of Increment 0; the composite alignment score deferred behind findings-as-counts; document provenance (authored here vs. ingested) added as a first-class property. Factual references re-checked against the codebase as of migration 098.

---

## 1. North star & positioning

**One-liner.** A per-programme, zoomable graph of how the curriculum constructs competencies — disciplines and their internal content on one side, ФГОС competencies and the ФОС instruments that verify them on the other — with a structural-quality dashboard and a sandbox for drafting rearranged plan variants that can be compared against the current plan and exported as a branded proposal PDF.

**Positioning — a read-and-recommend layer, not a system of record.** The university authors its curriculum in its own systems (АСУ «Университет», and increasingly ИСПУМ itself for РПД and ФОС). ИСПУМ takes the four document families, renders the construction graph they imply, measures how sound that construction is, and lets the РОП/УМЦ propose a better arrangement. **The variant is a recommendation artefact, never an authoritative plan.** ИСПУМ never has to win a fight with the university's plan of record to be useful — and never has to be right about it.

**The backward-design spine.** The product operationalises *обратный педагогический дизайн* (Wiggins & McTighe): plan backwards from the result. The three stages are the organising principle, and they map one-to-one onto the document families the university already produces:

| Backward-design stage | Documents | Node type | Edge it produces |
|---|---|---|---|
| **1. Desired results** | ФГОС + ОП | Competencies (УК/ОПК/ПК) + indicators (Знать/Уметь/Владеть) | — |
| **2. Acceptable evidence** | ФОС | Assessment items | `verifies` |
| **3. Learning plan** | УП + РПД | Disciplines + content units | `contributes-to`, `prerequisite` |

**The honesty principle — map vs. territory.** A document-based graph measures the *map* (is the plan coherent?). Only real student evidence measures the *territory* (are competencies actually formed?). In this scope the product measures the map only, and **says so in the UI** — no dial is allowed to be phrased as if it measured student outcomes. The schema keeps one door open to the territory (§2, `evidence_kind`), but the claim the product makes today is deliberately the smaller one.

**One object, three views.** The finding (замечание) is the unit of coordination: the УМЦ *triages* findings, the РОП *fixes* them, and a later oversight layer would *count* them. Findings flow down; resolution flows up.

---

## 2. Conceptual model

### The three quality layers, and which one this scope addresses

| Layer | Question | Measured by | Status |
|---|---|---|---|
| **Design** | Is the curriculum coherent? | Topology from documents | **This spec** |
| **Delivery** | Is the content substantive? | РПД / content-unit audit | Partly shipped (`documentReview`, Готовность УМК) — this spec wires it to the graph |
| **Outcome** | Do students *actually* form competencies? | Live student evidence | **Deferred.** Schema door left open, nothing built |

### Nodes

| Node | Source | Granularity |
|---|---|---|
| **Competency** | ФГОС registry (УК/ОПК) + ОП description (ПК) | + Знать/Уметь/Владеть indicators |
| **Discipline** | УП | semester, ЗЕТ, форма контроля |
| **Content unit** | РПД | лекция / практическое / лабораторная / СРС / контроль |
| **Assessment item** | ФОС | экзаменационный вопрос / тест / кейс / критерий защиты |

**Competency identity is not per-programme.** УК and ОПК are federal law, identical for every institution on the platform, and are already curated once in `fgos_competencies` (migration 088, `type CHECK IN ('УК','ОПК')`, verbatim-verified, published-gated). Programme competencies must resolve to those rows, not to independently extracted strings. Only **ПК are programme-owned** and stay local. This is not tidiness: if each programme carries its own noisy «УК-1», nothing comparable can ever be computed across programmes, and today's `program_competencies.code` is free text with no FK.

### Document provenance — authored here vs. ingested

Every node carries where it came from. Two of the four families can already originate *inside* ИСПУМ:

| Family | Ingested path | Authored-here path |
|---|---|---|
| ОП (описание) | `programs.description_text` (extracted PDF) | — |
| УП (учебный план) | `programs.plan_text` (extracted PDF) | manual semester builder |
| РПД | `program_documents` kind `working_programme` (+ versions, migration 084; state machine, migration 098) | РПД-студия (`syllabus_studio_drafts`, migration 070) |
| ФОС | *(not yet a `program_documents` kind — see Inc 3b)* | ФОС generator (`fos_documents`, migration 080) |

Authored-here nodes arrive as **structured data with no extraction loss and no citation risk**. Ingested nodes arrive as extracted text under the citation-validation contract. The graph must record which, because it determines how much a given edge can be trusted, and because the cheap wins live entirely on the authored side.

**Corollary for РПД:** with migration 098 the platform knows a РПД's approval state (`draft | submitted | returned | forwarded | approved`). Content units should be sourced from the **approved** version where one exists, and the graph should show when it is reading a draft instead.

### Edges

| Edge | Meaning | Key attribute |
|---|---|---|
| **contributes-to** | content unit / discipline → competency | formation stage: `introduce` / `develop` / `master` |
| **prerequisite** | discipline → discipline | inferred rationale |
| **verifies** | evidence → competency | `evidence_kind` discriminator (see below) |

### The dual-evidence `verifies` edge (R5 deferred, discriminator kept)

The `verifies` edge carries an `evidence_kind` discriminator:

- `fos_document` — "a ФОС item exists that maps to this competency" (the *claim*) — **built in this scope**
- `student_evidence` — "N students demonstrated this in graded work, mastery rate X%" (the *reality*) — **deferred, nothing built**

**Decision (2026-07-28):** student evidence is deferred, not deleted. The discriminator column and the nullable `subject_count` / `mastery_rate` columns ship in the first migration anyway. That is a column and a check constraint — a rounding error in cost — and it is the difference between the outcome layer later being an addition and being a rewrite. Nothing else in this scope depends on it.

---

## 3. Data model

**Reused as-is:** `programs`, `program_disciplines`, `program_competencies`, `program_documents`, `program_document_reviews`, `program_analyses`, `fgos_standards`, `fgos_competencies`, `fos_documents`, `rpd_submissions`.

**New tables** — numbered from **099** (the tree is at 098; the spec's earlier "from 056" was stale). Full DDL lives in the migrations.

| Table | Purpose | Key columns |
|---|---|---|
| `program_content_units` | First-class lectures/practicals/labs/СРС | `discipline_id`, `kind`, `title`, `topics JSONB`, `source_doc_id`, `source_version_id`, `source_section`, `provenance`, `sort_order` |
| `program_competency_links` | The `contributes-to` edge, at discipline *and* content-unit granularity | `discipline_id`, `content_unit_id NULL`, `competency_id`, `stage`, `origin`, `analysis_id`, `evidence_quote`, `confidence` |
| `program_prerequisites` | The `prerequisite` edge | `discipline_id`, `prerequisite_discipline_id`, `rationale`, `origin`, `analysis_id` |
| `program_assessment_items` | ФОС items (authored or ingested) | `discipline_id NULL`, `source_kind`, `fos_document_id NULL`, `doc_id NULL`, `kind`, `text`, `verification_level` |
| `program_verification_links` | The dual-evidence `verifies` edge | `competency_id`, `evidence_kind`, `assessment_item_id NULL`, `subject_count NULL`, `mastery_rate NULL` |
| `program_findings` | The shared finding object | `stage` (results/evidence/plan), `kind`, `severity`, `competency_id`, `chain JSONB`, `suggested_actions JSONB`, `status`, `variant_id NULL` |
| `program_variants` + `variant_overrides` | Sandbox variants | `baseline_fingerprint`, `baseline_snapshot JSONB`, `status`; overrides: `kind`, `discipline_id`, `payload JSONB` |

Also: add a nullable `fgos_competency_id` FK to `program_competencies`, resolved for УК/ОПК; ПК stay unresolved by design.

### 3.1 The founding problem: edge identity, provenance and stability

The v1 spec framed Increment 0 as "the analysis already infers these edges, stop discarding them." That's half true and the missing half is the hard part.

**What's actually there today.** `analyzeSequencing` ([programAnalysis.ts:375](../backend/src/services/programAnalysis.ts:375)) returns edges as **discipline name strings** (`from_name`/`to_name`), matched back to semesters by a normalised-name lookup, with unmatched names silently skipped ([:417](../backend/src/services/programAnalysis.ts:417)). Formation stages are the same shape — `CompetencyTimelineCell.via` is a name. The prompt deliberately asks for only **8–20 edges** because the output is a human-readable report. Results are cached whole into `program_analyses.result` JSONB.

For a report regenerated on demand, all of that is fine. For a substrate that РОПы edit on top of and variants fork from, it is not:

1. **Identity.** Edges must reference `program_disciplines.id`, not names. The inference passes need to emit stable ids (give the model numbered disciplines and have it answer in ids), and unmatched output must be *reported*, not silently dropped.
2. **Density.** 8–20 edges over a ~44-discipline plan is a sparse graph. The lane visualisation will look convincing and be thin. Either raise the cap for the graph path or accept and *display* the sparsity — but decide deliberately.
3. **Stability across re-analysis.** Re-running produces a different edge set. Every persisted edge therefore carries `origin` (`extracted` / `manual` / `confirmed`) and the `analysis_id` that produced it. The rule: **re-analysis may add and may retire `extracted` edges; it may never touch `manual` or `confirmed` ones.** An extracted edge a human has confirmed is promoted and becomes immune. Retired edges are marked, not deleted, so a variant referencing them stays explicable.
4. **Missing-data honesty.** `MappingConfidence` ([shared/types.ts:1595](../shared/types.ts:1595)) exists precisely because `program_disciplines.competency_codes` is often empty, which makes «uncovered» frequently a data artefact rather than a curriculum flaw. The graph inherits this problem and must carry it forward into every finding it emits (§4.2).

**This is the real content of Increment 0.** Creating seven tables is an afternoon; getting these four decisions right is the increment.

### 3.2 Variant reconciliation against a moving baseline

`variant_overrides` is copy-on-write over a **mutable** baseline: the УП can be re-imported, a discipline deleted, a РПД superseded (migration 084), an analysis rerun. The v1 spec named `baseline_snapshot` but not the semantics. Decision:

- Each variant stores `baseline_fingerprint` — a hash over discipline ids/semesters and the edge set it was forked from.
- On open, if the fingerprint no longer matches, the variant is marked **stale**, shown read-only, and offered a re-base that replays overrides whose target nodes still exist and lists those that can't be replayed.
- Overrides referencing a deleted discipline are never silently dropped — they surface as unreplayable so the РОП sees what their proposal assumed.

A variant is a recommendation artefact (§1). It is allowed to become stale; it is not allowed to become quietly wrong.

---

## 4. The intelligence layer

**Ingest-time (LLM, paid once):** content-unit segmentation, ПК/indicator extraction, prerequisite inference, formation-stage attribution, ФОС item extraction + competency mapping (ingest path only), topic embeddings (Yandex per rule #9, stored as `vector(1536)`). All under the citation-validation contract and `chatJSON` structured extraction.

**Edit-time (deterministic, free, instant):** every sandbox operation — re-semestering, re-staging an edge, adding/removing a link — is pure recomputation over the persisted edges. No AI in the loop while editing. This is what makes drag-and-rearrange feel instant and keeps suggestions trustworthy, and it mirrors the discipline already used in sequencing analysis: the model proposes links, the *system* decides what's an inversion, so the verdict can never contradict the count.

### 4.1 What the dashboard reports

Six measures, grouped by backward-design stage:

| Stage | Measure | Reports |
|---|---|---|
| **1. Results** | Покрытие | competencies without a full introduce→develop→master chain |
| | Прогрессия | competencies that plateau or start too late |
| **2. Evidence** | Контроль | competencies with no verifying instrument; taught-but-never-checked |
| **3. Plan** | Последовательность | prerequisite inversions |
| | Нагрузка | semester ЗЕТ/count imbalance |
| | Дублирование | overlapping topics, orphan disciplines |

### 4.2 Findings first, score later — deliberate

**Each measure ships as a count of concrete findings, not as a 0–100 dial, and there is no composite alignment score in this scope.**

Reasons, in order of weight: (a) the underlying mapping is frequently incomplete (§3.1 item 4), so a score compresses "we don't know" and "it's bad" into the same number; (b) there is no defensible weighting yet — v1 filed this as a calibration detail, but a single number shown to a УМЦ head and drilled down to a named РОП is read as an accusation; (c) [migration 086](../backend/migrations/086_rpd_monitor.sql) already set the precedent for exactly these institutional politics — store counts, recompute percentages server-side, surface anomalies rather than silently fixing them.

«7 компетенций не проверяются ни одним оценочным средством, 3 инверсии в последовательности» is defensible in a meeting. «63/100» is not. A composite score can be added later once weights have been calibrated against several real programmes — and at that point it will be a presentation change over data that already exists.

Every finding carries a **confidence qualifier** derived from `MappingConfidence`: a competency reported as uncovered in a plan where half the disciplines declare no codes says so on the finding itself.

### 4.3 The suggestion engine (deterministic, over ingest-time outputs)

| Issue type | Generation rule | Each option shows |
|---|---|---|
| Gap / thin coverage | Cosine affinity between the competency's indicators and content-unit topics (reuses the existing embedding machinery) | Ranked candidate + grounding РПД quote |
| Inversion | Enumerate legal moves, simulate each against *all* prerequisite edges | "Move X → sem N: resolves this, creates none, load 18→22" — top 2–3 |
| Load imbalance | Move candidates from overloaded semesters, filtered by prerequisite legality | Move + balance delta + side effects |
| Unverified competency | Disciplines touching it whose ФОС carries no mapped item | Suggested instrument type for the stage |

**Auto-proposal** («Предложить исправления»): a greedy pass applying options that reduce findings without creating new ones, presented as a reviewable variant. The optimizer proposes; the РОП disposes — consistent with "AI assists, teacher is author of record."

**Narration from computation:** every rationale string is assembled from computed deltas. The LLM never invents a recommendation the numbers don't support.

---

## 5. Surfaces & UX

**The graph is infrastructure before it is a screen.** The highest-value, lowest-adoption-risk consumers of the new tables are surfaces that already have users:

- The **Отчёт** tab's numbers become queries over persisted edges instead of a cached JSONB blob.
- **Готовность УМК** (УМЦ dashboard) gains a competency-coverage column.
- **РПД-студия** can tell a teacher which competencies their discipline owes.
- The **ФОС generator** can tell a teacher which competencies still have no instrument.

None of these require anyone to adopt a new screen. The dedicated topology surface is worth building — but it should be understood as one consumer of the graph, not as the point of it.

**Home of the surfaces:** per-programme topology → a **«Топология»** tab on `/programs/:id` (inherits context, access, data), behind its own `/api/programs/:id/topology/*` namespace so a later merge with Отчёт is a routing change, not a rewrite.

**The graph.** Competency lanes (horizontal) over a semester axis (left→right). Disciplines are blocks in the lanes they contribute to; fill intensity encodes stage (outline=introduce, half=develop, solid=master). Prerequisites render as arcs — an inversion is visibly an arc pointing *backwards*. Assessment instruments hang off lanes as markers. A lane that runs empty or never goes solid reads as broken at a glance. Sparse or low-confidence regions must be visually distinct from *bad* regions (§4.2). Two zoom levels: **arrangement** (disciplines — the editable surface) and **audit** (click a discipline → its content units + РПД coverage evidence — read-only). Dragging a block runs the full recompute live, flashing arcs that would invert (red) or resolve (green) and semester load deltas *before* drop.

**The issue feed.** Every finding is a row, ordered by backward-design stage (fix results before evidence before plan): what's wrong, where (click → graph flies to the subgraph), why it matters, confidence, and pre-computed options.

**The sandbox.** «Создать вариант» forks the plan (copy-on-write, §3.2). Drag to re-semester, re-stage or add/remove contribution links. Findings recompute live; moved blocks ghost at their old position. A running change ledger, each entry reversible. Named variants per programme.

**Compare + export.** Side-by-side current vs. variant with a structured change list. The PDF is an *argument*, not a picture — a «проект изменений учебного плана»: change list, before/after findings, the graph, and an explicit statement that it is a recommendation, not an approved plan. Same pdfkit / PT Serif pipeline as `programReportPdf`.

---

## 6. Roles & access

Inherits the programme-access model unchanged (`getProgramAccessScope`: `all-rw` / `all-ro` / `specific` / `none`):

| Role | Sees | Can do |
|---|---|---|
| **РОП** (`specific`) | Their programme(s) | Full topology + sandbox + variants + export |
| **УМЦ / проректор** (`all-rw` via `governance` / `admin_office` unit type) | All programmes | Same, across programmes |
| **Polygroup / institute heads** | Subtree programmes | Read + edit within subtree |

**Domain axis — required, not optional.** Per CLAUDE.md §7.10, every new route must state which domain it gates on. **Topology routes gate on `curriculum`** (`requireDomain('curriculum', 'view' | 'edit')`), matching Мониторинг РПД and Готовность УМК, so a УМЦ head reaches it without institution-root admin. `getProgramAccessScope` already requires `domain IN ('all','curriculum')`, so the two agree. Naming this in the spec is deliberate: the domain axis is load-bearing and its absence from v1 was a real gap.

Every variant mutation flows into the global audit middleware for free. Read-only viewers get the «Только просмотр» treatment (existing `<fieldset disabled>` pattern).

---

## 7. Delivery plan

Three releases. Each increment is independently shippable and verified in the usual way (*both typechecks clean, tests green, verified against dev DB*).

| Release | Theme | Increments |
|---|---|---|
| **R1 — Топология** | See the shape | 0, 1, 2 |
| **R2 — Замкнутый контур** | Close the backward-design loop | 3a, (3b) |
| **R3 — Песочница** | Rearrange the map | 4, 5, 6 |

**Commitment boundary:** R1 is committed. **R2 and R3 are conditional on evidence that a real РОП or УМЦ head uses the read-only graph in actual work.** The graph without the sandbox is still valuable; the sandbox without adoption of the graph is a large frontend build serving nobody. This is a deliberate gate, not hedging.

### R1 — Топология (see the shape)

**Increment 0 — Graph substrate (foundation, invisible to users).**
- *In:* migrations 099+ for the new tables; `fgos_competency_id` FK resolution for УК/ОПК; discipline-**id**-based output from the inference passes with unmatched output reported; `origin` / `analysis_id` provenance and the re-analysis rule (§3.1); content units persisted from the РПД parser, preferring the approved version (migration 098); the `verifies` schema including the deferred `student_evidence` discriminator (empty).
- *Out:* any UI; any variant table (defer to Inc 4 — it's a different problem).
- *Done when:* edges + content units queryable per programme by id; a re-run of the analysis provably leaves manual/confirmed edges untouched; migration idempotent on existing КНИТУ data; tests green.

**Increment 1 — Read-only topology + findings (v0.1).**
- *In:* «Топология» tab; competency-lane graph at discipline level; the six measures as finding counts with confidence qualifiers; click a measure → highlight nodes.
- *Reused:* `programAnalysis` (sequencing/progression/gaps/load), `curriculumAnalysis` (duplication).
- *Done when:* the graph renders a real imported programme and the finding counts reconcile with the existing Отчёт numbers.

**Increment 2 — Content-unit drill-down (v0.2).**
- *In:* click a discipline → expand to lectures/practicals/labs/СРС; inline РПД coverage evidence; draft-vs-approved indicator.
- *Reused:* `program_content_units` (Inc 0), `documentReview` coverage.
- *Done when:* the audit level shows coverage per content unit with quotes.

### R2 — Замкнутый контур (close the loop)

**Increment 3a — Verification edges from authored ФОС (v0.3).**
- *In:* join `fos_documents` (migration 080) → `program_assessment_items` → `fos_document` verification edges; the Контроль finding. **No extraction, no OCR, no citation risk** — for ИСПУМ-generated ФОС the items and their competency mapping already exist as structured data.
- *Done when:* a programme whose disciplines have generated ФОС shows taught-but-unverified competencies flagged.

**Increment 3b — Ingest legacy ФОС PDFs (conditional).**
- *In:* new `program_documents` kind `fos`; extract items → map to competencies + verification level.
- *Reused:* `extractText` + Vision OCR fallback, `chatJSON`, citation contract.
- *Gate:* build only if КНИТУ's ФОС demonstrably aren't going through the generator. This is the expensive path and v1 wrongly sequenced it first.

### R3 — Песочница (rearrange the map)

**Increment 4 — Sandbox variants (v0.4).**
- *In:* `program_variants` + `variant_overrides` including the fingerprint/stale/re-base semantics (§3.2); fork a variant; drag to re-semester; re-stage / add / remove contribution links; live recompute + ghost diff; change ledger + undo; named variants. All deterministic.
- *Done when:* a move updates sequencing/load/progression findings instantly with no LLM call, and a baseline change marks dependent variants stale rather than silently corrupting them.

**Increment 5 — Compare + proposal PDF (v0.5).**
- *In:* side-by-side current vs. variant; structured change list; branded «проект изменений» PDF carrying the recommendation-not-plan statement.
- *Reused:* `programReportPdf` pipeline.

**Increment 6 — Issue feed + suggestions + auto-proposal (v0.6).**
- *In:* unified issue feed ordered by stage; pre-computed options per issue (§4.3); live propagation preview on drag; «Предложить исправления» greedy variant.
- *Reused:* embeddings (gap affinity), prerequisite edges (move simulation).
- *Done when:* auto-proposal produces a reviewable variant that measurably reduces findings without introducing new ones.

### Deferred, by decision

- **R4 — accreditation drill, institutional heat map, self-survey report.** The accreditation framing is a strong wedge, but it pulls the roadmap toward document generation and away from the graph. Revisit once R1 has real users. Note also that the institutional matrix would be the *fourth* institution-wide table aimed at the УМЦ (Готовность УМК, Мониторинг РПД, РПД-approval queues) — when it comes back, it should be a column on an existing surface, not a new screen.
- **R5 — live student evidence.** Deferred, not deleted. The `evidence_kind` discriminator ships in Inc 0 (§2) so this stays an addition. When revisited, consider deriving weak evidence from the *discipline* rather than the criterion — graded work in a discipline that contributes-to ПК-3 is evidence for ПК-3 with zero teacher action, which turns criterion tagging from a precondition into an upgrade.

---

## 8. Relationship to adjacent work

- **Feature O (course knowledge graph, research-track).** Same shape one level down: O is concepts within a course, topology is disciplines within a programme. They will collide conceptually, and O's patent-claim language is meant to be locked before building. **Needed decision:** does topology absorb O's accreditation/coverage-reporting use case, leaving O only diagnostic feedback and the student tutor? Resolve before either starts.
- **Feature Z / `/rop-studio`.** Already the РОП-level surface, already produces a grounded, citation-backed dossier. Topology's proposal PDF and Z's «обоснование открытия новой ОП» are the same genre of artifact for the same person — they should share one document family and one PDF pipeline, not two.
- **Feature AC (АСУ «Университет»).** Reinforces §1's positioning: the plan of record lives there. If a push adapter ever lands, the variant becomes a submission rather than a PDF — but nothing in this spec should assume it.
- **Feature X (ФОС generator) and РПД-студия.** These are the authored-here producers (§2). Every improvement to them makes the graph denser for free, which is a better investment than more extraction.

---

## 9. Open questions

1. **Graph rendering.** No current dependency handles a layered DAG with lane layout + drag. Library or hand-rolled SVG? This is a substantial frontend build in its own right and sits in Inc 1/4 — scope it before committing to R3.
2. **Edge density.** Is the 8–20-edge inference cap raised for the graph path, or is sparsity displayed honestly? (Recommendation: display honestly first, measure, then decide.)
3. **ПК indicators.** УК/ОПК indicators belong on the ФГОС registry; ПК indicators are programme-owned and need deeper extraction from the ОП. Required for gap-affinity suggestions (Inc 6), not for R1.
4. **ФОС at КНИТУ** — per-discipline or programme-scoped, and are they going through the generator? Determines whether Inc 3b is needed at all. Confirm against a real sample.
5. **Adoption evidence for the R2/R3 gate.** What specifically counts — a РОП opening the tab twice unprompted? A УМЦ head citing a finding in a meeting? Define it before shipping Inc 1, or the gate won't hold.

---

## 10. Recommended first increment

Start with **Increment 0**, understanding that its real content is §3.1 — edge identity, provenance, and the re-analysis rule — not the seven `CREATE TABLE`s. Resolve competencies onto the ФГОС registry in the same migration. Ship the `evidence_kind` discriminator empty.

It is invisible to users, low-risk, unblocks everything above it, and turns work the platform already does and throws away into an asset it keeps.
