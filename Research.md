# Ispum — Innovation & Patentability Research

Working document for grant applications and patent strategy. Captures candidate
innovations, their novelty angle, what infrastructure they require, and a rough
sense of how defensible / patentable each is.

Three sections:
1. **Teacher- and student-facing innovations** built on existing infrastructure (pgvector RAG + DeepSeek).
2. **Admin-facing innovations** built on existing infrastructure.
3. **Innovations requiring new infrastructure** — higher ambition, larger moats.

Section 4 (proposed) — grant-pitch shortlist with demo plan.

---

## 1. Teacher- / Student-Facing — Built on Existing Infrastructure

### 1.1 Implicit-rubric inference
Your RAG flywheel currently retrieves similar past grades. The stronger novelty
claim: *infer each teacher's hidden scoring criteria from systematic divergence
between AI score and teacher-approved score over time*. You're reverse-engineering
their personal rubric — what they actually weight vs what the written rubric says.

- **Novelty:** longitudinal approval signal → implicit-criteria extraction.
- **Patent framing:** "method for deriving implicit grading criteria from longitudinal approval signal."
- **Infrastructure delta:** none — extends the existing `assignments` table.
- **Pitch story:** "the platform learns each teacher individually."

### 1.2 Per-student stylometric baseline for LLM-detection
Russian universities care a lot about ChatGPT cheating, but generic AI-detectors
are unreliable and politically fraught. Use each student's *own prior approved
submissions in this course* as their stylistic baseline (not a generic classifier).

- **Novelty:** detection grounded in per-student historical corpus.
- **Defensibility:** structurally hard to replicate — only you have the longitudinal corpus.
- **Infrastructure delta:** none — pgvector already there. Add a stylometric embedding alongside the semantic embedding.

### 1.3 Disagreement-driven grading review
Run grading twice (different temperatures or prompt framings); only require
teacher attention on criteria where the two passes disagree. Cuts review time
and surfaces calibrated uncertainty.

- **Novelty:** workflow — "ensemble grading with selective human review gated on inter-pass disagreement."
- **Infrastructure delta:** none — two DeepSeek calls instead of one.
- **Ship priority:** highest — easiest to demo within a grant timeline.

### 1.4 Pedagogical-alignment scoring for generated lectures
Automatically score how well a generated lecture's slides map to the syllabus's
stated learning outcomes — Bloom's taxonomy bucketing per slide, coverage matrix
vs syllabus.

- **Novelty:** automated quality gate for AI-generated educational content.
- **Infrastructure delta:** none — extension of presentation generation pipeline.

### 1.5 Cross-cohort similarity search for recycled essays
Assignment embeddings already exist; nearest-neighbour across years catches
submissions copied between semesters.

- **Novelty:** lower — useful but standard NN search.
- **Pitchability:** high — easy to demo, real value.

---

## 2. Admin-Facing — Built on Existing Infrastructure

### 2.1 Institutional grading-fairness audit
Use embeddings to find *comparable* submissions across teachers in the same
department, then quantify score variance for similar work. Surfaces inter-grader
inconsistency that universities care about for accreditation but currently
cannot measure. Combine with teacher-level *temporal drift* (do they grade
harsher in week 14 than week 2?) — that's a fatigue signal nobody else can
produce.

- **Patent framing:** "method for detecting inter-grader inconsistency via embedding-space comparable-submission retrieval."
- **Scoping:** "same department" resolves to sibling teachers under a shared `type_code='department'` unit per §7; roll-ups to `division`/`cluster`/`admin_office` for higher-level views.

### 2.2 Curriculum coverage audit
Given a course's syllabus + all generated lectures + all rubrics, produce an
automatic matrix: which stated learning outcomes have been taught, at what
Bloom's level, tested by which assignment. Auto-flag gaps.

- **Why it matters:** Рособрнадзор reaccreditation demands exactly this kind of
  documentation today — currently done by hand in Excel, takes weeks per
  programme.
- **Demo speed:** fastest — can be demoed with a single course.
- **Lead this for grants.**
- **Scoping:** coverage matrix is computed per `department` (§7) and rolled up to any ancestor — a УМЦ head sees institution-wide gap heatmap, a kafedra head sees only their own.

### 2.3 Institution-scope collective RAG (with consent)
Today the flywheel is per-teacher. The defensible extension: opt-in
*department-level* RAG where new hires benefit from approved grades of senior
colleagues in the same department.

- **Patent framing:** "collective grading intelligence with role-based consent boundaries."
- **Infrastructure delta:** scope flag on embeddings; consent UI.

### 2.4 Federated cross-institutional benchmarking
Institutions never share raw data — but you can derive *aggregated,
differentially-private* benchmarks: "your business school scores 0.4σ above
network mean on critical-thinking criteria."

- **152-FZ aligned, patent-novel, business moat.**
- **Strong fit for Russian grant data-sovereignty themes.**
- **Lead this for grants alongside 2.2.**
- **Scoping:** peer comparison requires the canonical `type_code` taxonomy from §7 — without it, cross-institutional benchmarks are not meaningful (one university's "faculty" vs another's "department" is apples-to-oranges).

### 2.5 Tamper-evident grade attestation
Every AI grade gets a cryptographic record of model version, retrieved
examples, prompt, teacher approval. Institution admin issues an auditable
certificate: "1,247 grades issued, X% teacher override rate, no systematic bias
detected on protected attributes."

- **Patent framing:** workflow-level — verifiable AI-grading audit trail.
- **Trust signal for accreditation bodies and parents.**

---

## 3. Innovations Requiring New Infrastructure

To be expanded — initial brainstorm below; details and patent framing pending
review.

### 3.1 Live-lecture engagement layer
Real-time student signal during class: WebRTC session, anonymous comprehension
pings, AI-generated comprehension questions calibrated to the slide currently
displayed, "confusion heatmap" surfaced to the teacher live. Post-class:
delivered-vs-planned lecture fidelity scoring.

- **New infra:** WebSockets, session management, ASR (Yandex SpeechKit), student
  ephemeral join flow (no accounts needed — QR/code).
- **Patent framing:** "real-time pedagogical adaptation from anonymous student
  comprehension signal aligned to slide timeline."
- **Wow factor:** very high. Visually demonstrable.

### 3.2 Course knowledge graph + targeted remediation
Extract concepts, prerequisites, and relationships from syllabus + lectures +
assignments to build a per-course concept graph. Then: identify which concepts
a struggling student is missing and propose precisely targeted remediation
content (auto-generated micro-lessons).

- **New infra:** graph layer (pgvector + relations table, or AGE extension),
  concept extraction pipeline, micro-lesson generator.
- **Patent framing:** "automatic prerequisite-relationship inference from
  generated educational corpora; targeted remediation routing on concept graph."
- **Enables many downstream features** (adaptive assessment, student tutor).

### 3.3 Student-facing AI tutor grounded in the teacher's rubric
Students opt in. Tutor *knows* their grading history, their specific teacher's
rubric, the course's concept graph, and their own weak concepts. This is the
killer feature — tutoring grounded in the actual course context, not generic
ChatGPT.

- **New infra:** student auth (separate from teacher accounts), student
  conversation persistence, per-student usage metering, student billing or
  institution-paid seats.
- **Scope:** large — explicitly out of MVP per CLAUDE.md. Phase 2+.
- **Patent framing:** "context-grounded student tutor with retrieval over
  teacher-approved historical grading corpus."

### 3.4 Adaptive assessment generation
Instead of fixed assignments, the AI generates the next assignment for each
student calibrated to where they are on the concept graph. Personalised
difficulty curve.

- **New infra:** depends on 3.2 and 3.3.
- **Patent framing:** "concept-graph-driven personalised assessment generation."

### 3.5 Voice-first teacher input
Teacher speaks rubric criteria; speaks feedback while reading the assignment;
AI structures it. Massively lowers friction for older / less computer-literate
faculty (a real Russian university demographic).

- **New infra:** ASR pipeline (Yandex SpeechKit), audio capture UI.
- **Patent framing:** modest — workflow novelty in spoken-rubric structuring.

### 3.6 Teacher voice-cloned async lecture narration
Teacher records 10 minutes of speech once; AI narrates generated slide notes
in their voice for absent students or review.

- **New infra:** voice-clone pipeline (Yandex SpeechKit voice synthesis),
  TTS-per-slide rendering.
- **Patent framing:** "teacher-voiced async pedagogical content generation
  with consent-gated voice model."
- **Accessibility angle** — strong grant story.

### 3.7 On-premises / isolated-tenancy deployment
Some Russian institutions (military academies, FSB-adjacent, certain regional
universities) cannot send data outside their own perimeter. Offer an
isolated Yandex Cloud tenant or true on-prem deployment, with a smaller
locally-hosted Russian-language model handling sensitive paths.

- **New infra:** deployable artefact (Docker / k8s bundle), local model serving
  (vLLM + Saiga or similar), licence-management.
- **Defensibility:** very high — government-grant aligned, premium pricing.
- **Patent framing:** modest individually, but combined with §3.8 forms a strong
  sovereign-AI story.

### 3.8 Small fine-tuned Russian pedagogical model
Use accumulated approved-grade corpus to fine-tune a small Russian-language
pedagogical model (e.g. Saiga / YandexGPT-distil). Run locally for cheap
high-volume paths; route to DeepSeek only for hard cases.

- **New infra:** training pipeline, eval harness, model registry, routing layer.
- **Defensibility:** very high — proprietary model is core IP, only you have
  the training data.
- **Patent framing:** "routing layer for cost-aware fallback between domain-tuned
  pedagogical model and frontier general model."
- **Sovereign-AI narrative:** very strong for Russian grants.

### 3.9 Multimodal assignment grading
Beyond text — handwritten maths and diagrams (whiteboard photos), code
submissions with execution sandbox, oral presentation recordings.

- **New infra:** vision models, code sandbox (Yandex Serverless Containers or
  isolated VMs), audio-analysis pipeline.
- **Patent framing:** "rubric-driven multimodal assessment with modality-specific
  evidence extraction."

### 3.10 Inter-rater reliability training tool
Active-learning loop on rubric calibration: platform schedules re-grading of
the same submission weeks apart and measures teacher self-consistency.
Department-level: same submission given to multiple teachers, surfaces
disagreement for collective rubric refinement.

- **New infra:** scheduled-task system, blinded re-grading workflow, calibration
  reporting.
- **Patent framing:** "longitudinal grader-calibration measurement with
  blinded re-presentation."

### 3.11 Anti-plagiarism focused on AI-rewriting
Students often write originally then rewrite with ChatGPT to "polish." Detect
this transformation specifically — dual embeddings (semantic vs stylistic) and
trained discriminator on student-AI hybrid texts.

- **New infra:** stylometric embedding model, hybrid-text training corpus,
  discriminator training.
- **Patent framing:** "detection of AI-mediated rewriting via dual-embedding
  divergence."

---

## 4. Grant Shortlist — TBD

To be filled in after deeper review. Working hypothesis on top picks:
- §5.1 Process-of-creation attestation — strongest single patent claim, directly answers the "AI grading AI" concern.
- §2.2 Curriculum coverage audit — fastest demo, urgent Рособрнадзор pain.
- §2.4 Federated cross-institutional benchmarking — data-sovereignty narrative.
- §3.1 Live-lecture engagement — wow factor demo.
- §3.8 Fine-tuned Russian pedagogical model — strongest IP creation story.
- §3.7 Isolated-tenancy deployment — government-aligned moat.

**§5 v1 bundle is intentionally lean:** §5.1 + §5.3 + §5.5 only. §5.2
(oral defense) deferred pending cost-model work; §5.4 (concept probing)
deferred behind §3.2 / Feature O (knowledge graph). The three-signal v1
bundle still forms a coherent patentable system per §5.6.

**Foundational prerequisite to almost all of the above:** §7 organisational
structure model. Without canonical org-tree scoping, §2.1, §2.2, §2.4, §5.1
ship with the wrong permission and roll-up semantics. Ships first per §7.8.

**Build target:** the full institutional path, not a demo. Grant
applications benefit from this work but are not the primary driver of
scope — institutional client pipeline is already active. §4 should be
read as "what to highlight in grant materials," not "what to scope the
build around."

---

## 5. Authenticity & AI-Resilient Assessment

### 5.0 Reframe — why "better AI detection" is a trap

Teachers raise this concern often: *students use AI to write assignments, and
we use AI to grade them — aren't we just AI grading AI?* The instinctive
response is "build a better classifier." That instinct is wrong.

- The detection arms race is unwinnable. Every detector gets defeated within
  months; frontier models produce text statistical detectors cannot
  distinguish from human writing.
- False positives ruin innocent students and are politically catastrophic in
  Russian universities.
- Antiplagiat.ru is the institutional standard for output-based detection.
  We are intentionally not competing on that surface (see TODO.md
  *Intentionally NOT building*).

The innovative framing is the opposite: **stop assessing the artifact, start
assessing the process and the defense.** AI can produce any artifact; AI
cannot reproduce the cognitive trajectory of *this student* writing it, and
cannot defend choices it made on the student's behalf. Move assessment to
that ground. That reframe is patent-rich because nobody else is doing it
systematically.

The thesis that ties §5.1–§5.5 together:
> "We don't try to win the AI-detection arms race. We move assessment to
> ground where AI cannot operate."

### 5.1 Process-of-creation attestation
A writing surface inside GradeAssist where students compose. Captures
keystroke dynamics, paste events, pause patterns, revision history,
time-on-task. The platform produces a *provenance score* the teacher reads
alongside the grade: "this submission was typed over 4.2 hours with 230
revisions and one 800-character paste" vs "this submission was 100% pasted
in 47 seconds."

- **Crucial framing:** the platform does *not* claim to detect AI. It attests
  the writing process. The teacher (or the institution's policy) decides
  what threshold matters. This sidesteps the legal/political fragility of
  detection claims.
- **New infra:** in-platform writing surface (React component with
  telemetry), telemetry capture pipeline, signed-attestation schema,
  provenance-report UI in the grading view.
- **Patent framing:** "method for cryptographic attestation of authorship
  process via captured authoring telemetry, producing a provenance signal
  consumed in assessment without making a detection claim."
- **Strongest single patent claim on the roadmap.**

#### 5.1.1 v1 design lock — published assignments

The teacher chooses, per assignment, between the legacy *copy/paste* flow
(unchanged from today) and a new *publish* flow that activates §5.1.

- **Per-student tokenised links, not class codes.** Each link is bound to a
  specific `student_name + student_email` before the student opens it. That
  binding is what makes the telemetry meaningful — you know whose authoring
  process is being attested. A class-wide code is simpler but loses the
  binding.
- **Always-open until deadline, with autosave.** Session resumes on the same
  token if the student closes the browser; local-storage draft +
  periodic server-side snapshot. The added complexity is modest and it
  gives §5.3 (longitudinal trajectory) effectively for free.
- **Strict publish mode.** Once an assignment is published, the link is the
  only valid submission route. Teachers cannot paste a manual submission
  in as the student. Mixing routes would undermine the attestation story
  and weaken the patent claim.
- **Schema delta is small.** New columns on `assignments`: `is_published`,
  `student_token`, `published_at`, `due_at`; new JSONB column
  `submission_telemetry` for the attestation payload. `student_name` and
  `student_email` become required on publish. No new tables for v1.
- **Identity verification is out of v1.** Anyone holding the link can
  submit. For high-stakes work institutions handle identity physically
  (студенческий билет in hand at the exam); for everything below that bar,
  "the teacher distributed the link to the named student" is sufficient.
  A proctored in-room mode (teacher confirms identity before unlocking the
  writing surface) is a clean follow-on, not a blocker.
- **Distribution UX for v1:** the teacher sees a table of generated links
  next to student rows; copies them out manually. Email-blast is a v1.1
  add. LMS-integrated distribution (see §6.2) makes manual distribution
  irrelevant for institutional clients.

The build sits at ~4–6 weeks on top of the existing assignment model.

#### 5.1.2 152-FZ and the telemetry data class — design constraint

Keystroke dynamics and authoring timing can be read as **биометрические
персональные данные** under 152-FZ — typing rhythm is an established
behavioural-biometric identifier, and biometric data carries a higher
consent and storage bar than ordinary personal data. We are processing it
about *students*, who are not our account holders. An institution's legal
department *will* ask about this. Design around it from the start:

1. **Process-attestation framing, not identity-biometric.** We attest
   *that a writing process occurred* with certain characteristics; we do
   not biometrically identify the author. This is the same framing that
   keeps §5.1 out of the AI-detection-claim trap (§5.0) and it also keeps
   us off the biometric-identification surface legally. Hold this line in
   copy, in the data model, and in the patent claim language.
2. **Store aggregates, never raw keystroke streams.** Persist derived
   process metrics — revision count, active minutes, paste events and
   their sizes, longest-pause, draft-to-draft deltas — *not* the raw
   inter-keystroke timing vector. Aggregated process metrics are much
   harder to classify as biometric, and the provenance score (§5.1.3)
   does not need the raw stream. This is a hard constraint on the
   telemetry pipeline: the raw stream may exist transiently in the
   browser to compute aggregates, but only aggregates cross the wire and
   land in `submission_telemetry`.
3. **Explicit consent gate before the writing surface activates.** The
   student sees a plain-language Russian notice and must accept before
   composing; acceptance is recorded (timestamp + notice version) on the
   invite. **Framing matters** (decided 2026-06): the copy is written around
   *student benefit* — autosave so nothing is lost + "your effort is
   credited as your own work" — not "проверка авторства". This keeps the
   gate aligned with the "help, don't catch" ethos while still serving as
   the lawful-basis record. **Consent delivery is rail-dependent:** the
   per-session gate is the only consent mechanism on the standalone
   tokenised rail, so it stays there; on the LTI/institutional rail (§6) the
   institution can carry consent via enrolment terms, so the gate becomes
   institution-configurable (skippable) — future work.
4. **Data residency.** All telemetry stays on Yandex infrastructure
   inside Russia — already the platform default, but stated explicitly
   for this data class because it is the first behavioural data we
   capture about non-account-holders.

This constraint does not change the §5.1 design — it sharpens it. The
aggregate-only rule actually *simplifies* the build (less data to move
and store) while making the feature institutionally defensible.

#### 5.1.3 Provenance score — needs definition at build-start

§5.1's ~4–6 week estimate hides one undefined piece: *what computes the
score*. Lock a concrete v1 before building. Recommended: a transparent,
**rule-based** score, not ML — paste-ratio, active-time-vs-length,
revision-count, and largest-single-insertion thresholds, surfaced to the
teacher as the underlying *facts* ("100% pasted in 47s") rather than a
single opaque number. Transparency is the point: the teacher judges, the
platform attests. ML scoring is a future enhancement, explicitly not v1.

**Editor stack — decided: TipTap (MIT core only).** The telemetry hooks
depend on the editor, so this is locked here rather than left to build
time. TipTap sits on ProseMirror's transaction model, which gives an
inspectable, ordered stream of changes (insertions with size and timing)
and — critically — first-class paste capture via `editorProps.handlePaste`,
mapping 1:1 to the paste-ratio / largest-single-insertion metrics above.
ProseMirror's step model also makes §5.3 draft-to-draft diffing natural.
Lexical is the runner-up (lighter, Meta-backed) but loses on a smaller
ecosystem and more manual paste/transaction inspection. Raw ProseMirror
loses on DX with no offsetting benefit since TipTap exposes the underlying
ProseMirror objects when needed.

- **License constraint:** use only the MIT core (`@tiptap/core`,
  `@tiptap/react`, `@tiptap/starter-kit`). Do **not** take TipTap Pro
  extensions or TipTap Cloud — they are paid and unnecessary. Everything
  this feature needs (basic formatting + transaction/paste hooks + JSON
  serialisation for autosave) is in the free core.
- **Integration shape:**
  - `editor.on('transaction')` → client-side aggregator (revision count,
    active time, insertion sizes).
  - `editorProps.handlePaste` → paste size for paste-ratio /
    largest-insertion.
  - Flush **aggregates only** to the server, never the raw stream (§5.1.2).
  - Serialise the document as JSON for autosave / resume; snapshot at
    intervals for §5.3 trajectory.

#### 5.1.5 Implementation plan (Feature Q) — agreed 2026-06-28

**Architecture shift.** Q inverts the existing flow: the teacher publishes an
assignment *definition*, students write against it via tokenised links (no
accounts), submissions flow back into the existing grading pipeline. Two new
surfaces: a **public token-authenticated route group** (`/write/:token`, no
teacher JWT) and a **standalone student writing page** (no teacher chrome).

**Data model (refines §5.1.1 — uses three tables, not "columns only").** The
literal "no new tables" under-scoped a class roster. Model:
- `published_assignments` — the definition (teacher_id, course_id?, rubric_id?,
  title, instructions, due_at, status draft|open|closed, published_at).
- `assignment_invites` — per-student writing workspace (published_assignment_id,
  student_name, student_email, token UNIQUE, status invited|writing|submitted,
  `draft_content` JSONB (live TipTap doc), `submission_telemetry` JSONB
  **aggregates only**, consent_accepted_at/version, assignment_id set on submit,
  submitted_at). Keeps invited/draft rows OUT of the core `assignments` table.
- `submission_snapshots` — draft snapshots for §5.3 trajectory (invite_id, seq,
  content, char_count, captured_at).
- `assignments` gains only `published_assignment_id`, `submission_telemetry`,
  `submitted_at` — populated on submit, so the **grading pipeline is unchanged**
  (a submitted published assignment becomes an ordinary gradeable row).

**Increments.** Q1 schema + publish backend (gated `publishedAssignments`,
Pro/Institution). Q2 teacher publish UI (create, roster, copy links, track
status). Q3 public `/write/:token` — consent gate, TipTap surface, autosave,
submit, aggregate-only telemetry, offline-blocked. Q4 submit→grading +
provenance report (rule-based facts). Q5 §5.3 trajectory + §5.5 metacognition.

**Constraints baked in:** aggregate-only telemetry (raw stream never leaves the
browser), Russian consent gate before the editor activates, strict publish mode
(token link is the only submission route), transparent rule-based provenance
(no ML, no opaque score), connectivity required on the writing surface, TipTap
MIT core only.

#### 5.1.4 Offline PWA exception

The platform is an offline-capable PWA. A student could compose offline in
another tool and paste on sync, defeating the attestation. The published-
assignment writing surface therefore **requires connectivity** — a
deliberate exception to the offline-first stance, scoped to this surface
only.

**Scoping:** submission and telemetry visibility resolves via §7 — the
publishing teacher always sees their own; ancestor-unit admins/heads of
the teacher's primary `department` see them via authorisation walk;
nobody else does. §5.1 should not ship until §7.8 step 2 (org tree
migration) is in.

**Tier availability:** §5.1 attestation is available on **Pro** (individual
teacher tier, tokenised-link rail) and **Institution** (LTI-launched rail
via §6). Free tier remains on the legacy copy/paste flow. This keeps Pro
substantive — Pro users get the patent-grade authenticity feature on
their own published assignments without needing an institutional
contract, which matters for solo lecturers at universities that have not
yet adopted GradeAssist institutionally. The pricing-tier matrix in
CLAUDE.md needs updating when §5.1 ships.

### 5.2 Auto-generated personalised oral defense
GradeAssist reads the student's submission and generates 3–5 verbal questions
that probe whether they understand what they wrote — specific to choices
made in this text: "you argued X over Y on page 2 — why not Y?" Student
records answers in-platform (Yandex SpeechKit); teacher sees submission +
defense together.

- **Cultural fit:** Russian universities already practise защита; legitimacy
  is pre-built.
- **New infra:** ASR pipeline (SpeechKit), question generation grounded in
  submission, paired-artifact storage (submission + defense audio +
  transcript).
- **Patent framing:** "automated personalised oral defense generation from
  submitted artifact, grounded in artifact-specific argumentative choices."

### 5.3 Longitudinal authorship trajectory
The assignment is not the final artifact — it is the trajectory from
draft 1 → draft 2 → draft 3 with platform-coached revisions. Human drafting
shows normal revision patterns; pasted AI output either appears perfect on
draft 1 (suspicious) or shows structurally inconsistent draft-to-draft
transformations (style shifts, voice changes, structural overhauls that
look like swapped-out text rather than human revision).

- **Free if §5.1 is built** — same telemetry, different analysis layer.
- **Patent framing:** "longitudinal authorship trajectory as authentication
  signal in academic assessment."

### 5.4 Concept-graph probing
Pairs with §3.2 (course knowledge graph). Once the graph exists,
auto-generate concept-check questions targeting the *specific concepts* the
student's submission claims to demonstrate. AI can write a polished essay
invoking a concept; the student either has that concept activated in their
head or does not. A 3-question concept probe tied to the submission
separates these cleanly.

- **Second-order payoff** of building the knowledge graph — turns the graph
  from a feedback tool into an integrity tool.
- **Patent framing:** "concept-grounded comprehension probing of submitted
  artifacts using a course-specific prerequisite concept graph."

### 5.5 Rubric weight on metacognition
A rubric criterion category called *process reflection*: "Describe the
hardest part of writing this. What argument did you abandon, and why? If
you used AI, declare which prompts and critique what it gave you."

- AI is structurally bad at faking specific personal cognitive struggle;
  "what I struggled with" is uncannily revealing.
- **Pairs with §5.1** — the reflection box appears at the end of the
  writing surface, and pasted reflections are flagged.
- **Cheapest item on the roadmap** — rubric template + UI hint, no ML.

### 5.6 The bundle pitch
Each method targets a different cognitive surface AI cannot occupy:

| Signal | What it captures | AI cannot reproduce | In v1 bundle? |
|---|---|---|---|
| §5.1 Process attestation | *How* it was written | Human authoring telemetry | ✓ Core |
| §5.2 Oral defense | *Can you defend the choices* | Choices the student did not make | Deferred — post-v1 |
| §5.3 Trajectory | *How it evolved* | Coherent human revision pattern | ✓ (free with §5.1) |
| §5.4 Concept probing | *Do you have the concept* | Activated concept in this person's head | Deferred — gated on §3.2 |
| §5.5 Metacognition | *What was hard for you* | Specific personal cognitive struggle | ✓ Cheap |

The **v1 bundle (§5.1 + §5.3 + §5.5)** forms a coherent and defensible
system claim — *"AI-resilient academic assessment via multi-signal
authorship attestation"* — patentable as a system in addition to the
per-method claims. Three independent signals AI cannot fake is enough for
both the patent and the institutional pitch; §5.2 and §5.4 strengthen the
system over time but are not load-bearing.

### 5.7 Build sequencing and tradeoffs

**v1 bundle — committed for first institutional pilot and grant
submission:**

- **§5.1 (process attestation)** — strongest patent claim, highest
  leverage. ~4–6 weeks for a working version. Requires students to write
  in the platform, which is a UX shift but pairs naturally with the
  existing assignment-upload flow becoming an in-platform compose flow.
- **§5.3 (trajectory)** — essentially free once §5.1 telemetry exists.
  Adds a second independent signal at near-zero marginal cost.
- **§5.5 (metacognition rubric)** — could ship next week. Pure rubric
  template + UI nudge, no engineering. Lowest-cost item on the entire
  roadmap with real pedagogical value.

**Deferred to future versions** — design captured here so we know what
the full system can become, but not in v1 scope:

- **§5.2 (oral defense)** — biggest demo wow but recurring SpeechKit ASR
  + audio-storage cost; unit economics need a back-of-envelope before
  commit. Revisit after first institutional pilot when we have real load
  data on which to size it.
- **§5.4 (concept probing)** — gated on §3.2 / Feature O (course
  knowledge graph). Ships only when the graph is in. Stays in §5.6 as
  the long-term completion of the system claim.

**Lead for both grant and institutional pilot:** §5.1. Most patent-
defensible, directly and specifically answers "AI grading AI" in a way no
competitor does, and Russian institutional culture (formal authorship
attribution, защита) gives it natural legitimacy.

**Honest scope caveat:** §5.1 changes the assignment-submission UX — students
have to write in-platform for high-stakes work. Worth deciding early whether
this applies to all assignments, only flagged-high-stakes ones, or only
opt-in by the teacher. Probably the third for v1. *(Resolved in §5.1.1 —
teacher opts in per assignment.)*

---

## 6. Student Presence and LMS Interoperability

### 6.0 Why this section exists

The original CLAUDE.md "what this is not" list rules out a **student-facing
portal or accounts**. That call was right for the MVP — when the platform
was a pure AI grading tool, students had no reason to log in. The platform
is no longer that. §5.1 puts students in the writing surface. §5.2 has them
record oral defenses. §3.1 has them join live lectures. §3.3 (planned) is a
full student-facing tutor.

The question is no longer "do students touch the platform?" — they will,
imminently. The question is "*how* do they touch it — ephemerally via tokens,
or as identified account holders, and where does the identity come from?"

### 6.1 Reframing the "no student portal" decision

Two distinct concepts that the MVP-era decision conflated:

| Concept | What it means | Cost to build | When needed |
|---|---|---|---|
| **Ephemeral student presence** | Tokenised link, no login, no persistent identity across courses | Low — already implied by §5.1 design | Now |
| **Full student accounts** | Login, password, cross-course identity, history, billing surface | High — new auth surface, support burden, GDPR/152-FZ scope expansion | Only when student tutor §3.3 launches |

**Recommendation:**

- **Keep "no full student portal" for now** — no logins, no passwords, no
  separate student billing.
- **Explicitly endorse "tokenised ephemeral student identity"** as a
  supported pattern. Document it as such. §5.1 published assignments, §5.2
  oral defenses, §3.1 lecture join all use it.
- **Plan the upgrade trigger.** Full student accounts become necessary
  *only* when the student tutor (§3.3) ships, because the tutor needs to
  know the student across courses and over time. Until then, ephemeral
  identity is enough for everything else.
- **And — critically — even when §3.3 ships, the cleanest path is to
  outsource student identity to the institution's LMS** (see §6.2), not to
  build our own auth. That preserves "no student portal" in a meaningful
  sense: GradeAssist *never* owns the student-side credentials.

So the answer is: the original decision was right for the wrong reason
(MVP scope). It is still right going forward, but for a different and
stronger reason: **student identity belongs to the institution, not to us.**

### 6.2 LMS interoperability — Moodle as the wedge

Moodle is the dominant LMS in Russian universities. Institutions don't
switch off Moodle; they augment it. GradeAssist must play nicely or it gets
locked out of the institutional market.

The right answer is the user's instinct: do not replace Moodle. Integrate,
deliver disproportionate value at the integration seam, and let value pull
workflows from Moodle into GradeAssist over time.

**The standard that makes this work: LTI 1.3 + LTI Advantage** (Learning
Tools Interoperability). This is the open IMS Global standard supported by
Moodle, Canvas, Sakai, Open edX, and effectively every academic LMS. ~2–3
weeks of careful work for a working integration; unlocks the entire LMS
ecosystem in one move.

LTI provides three things GradeAssist needs:

1. **Tool launch** — from a Moodle assignment, the teacher (or student)
   clicks "Open in GradeAssist" and is launched into our app with a signed
   JWT containing their identity, role, course context, and assignment
   metadata.
2. **Names and Roles Provisioning Service (NRPS)** — fetch the course
   roster (students, names, emails, roles) from Moodle without manual
   import.
3. **Assignment and Grade Service (AGS)** — write grades back to the
   Moodle gradebook automatically when teacher approves.

The student-identity payoff is enormous: **the student is authenticated by
Moodle, not by us.** They land in GradeAssist via LTI launch with a verified
identity already attached to a course enrolment. We never store a password,
never run a password-reset flow for a student, never need a separate
student billing relationship. Section 6.1's recommendation ("student
identity belongs to the institution") is realised by adopting LTI.

### 6.3 The nudge architecture — four layers

Each layer increases GradeAssist's footprint inside the institution without
ever asking them to leave Moodle.

**Layer 1 — Coexistence (Moodle is primary).**
- Teacher continues to use Moodle for course structure, announcements,
  rosters, gradebook.
- Teacher launches into GradeAssist *only* for AI-assisted grading of a
  Moodle-collected submission, or for AI lecture generation.
- Grades flow back to Moodle via AGS. Student never sees GradeAssist
  branding.
- Value delivered: AI grading + lecture generation, with zero workflow
  change for the institution. This is the wedge.

**Layer 2 — Embedded workflows.**
- Teacher creates a Moodle assignment with GradeAssist set as the external
  tool. Students click "Open assignment" in Moodle → land in GradeAssist's
  writing surface (§5.1) → write with attestation → submit → grade flows
  back to Moodle.
- Now the *student* uses GradeAssist, but feels like they're still in
  Moodle.
- Value delivered: authorship attestation, which Moodle cannot do. This is
  the first thing teachers cannot get anywhere else.

**Layer 3 — Pulling workflows out of Moodle.**
- Rubric design, criterion management, RAG-flywheel feedback history,
  oral-defense recording (§5.2), and eventually the knowledge graph (§3.2)
  live entirely in GradeAssist.
- Moodle becomes a thin shell around an increasingly thick GradeAssist
  workflow. Teachers spend most of their grading time in our UI.
- Value delivered: features Moodle has no equivalent for.

**Layer 4 — Institutions without Moodle.**
- Newer private universities, corporate training contexts, individual
  teachers in low-tech departments. They use GradeAssist standalone.
- This is the per-student tokenised link flow from §5.1.1, unchanged.

Crucially, Layers 1–3 *and* Layer 4 are the same product. The only
difference is the identity source: LTI launch (institutional) vs tokenised
link (standalone). All the downstream features — attestation, oral defense,
trajectory, concept probing — work identically on both rails.

### 6.4 Implications for the build order

- **Add LTI 1.3 support before formal institutional sales.** Without it,
  institutional procurement conversations stall. With it, GradeAssist is
  a "compatible tool" instead of "another system to migrate to," which is
  the difference between a sale and a dead lead.
- **Build §5.1 (published assignments) on the tokenised-link rail first.**
  LTI is the second integration on top of it — the writing surface itself
  doesn't change. This means the standalone v1 ships sooner; LTI follows
  as the institutional wedge.
- **Defer §3.3 (student tutor) until LTI is shipped.** That way student
  accounts are never built — the student arrives pre-authenticated via
  LTI, and the tutor binds to that identity. Skips an entire scope of
  work (student auth, password reset, student billing) that would
  otherwise be unavoidable.
- **Update CLAUDE.md "What this is not".** The current entry rules out
  *student accounts*; the policy going forward should be:
  > "GradeAssist does not operate its own student account system. Student
  > presence is delivered either ephemerally via tokenised links
  > (standalone deployments) or via LTI launch from the institution's LMS.
  > Student credentials are never stored by GradeAssist."

  That is a meaningfully different — and stronger — version of the
  original decision.

### 6.5 IT-admin LTI configuration UX — sketch

LTI 1.3 is a real protocol with fiddly setup (issuer URL, client ID,
key sets, deployment ID, platform vs tool roles). If the IT admin cannot
self-serve this, every institutional sale becomes a hand-held engineering
engagement that does not scale. The UX has to be designed before §6
build, not improvised during the first pilot.

**Where it lives.** Settings → Organisation → LTI Integration. Gated on
`admin` role on the root `institution` unit (§7.4 IT admin). Hidden from
academic admins entirely — wrong audience, wrong vocabulary.

**Three sub-screens:**

1. **Setup** — two-pane key exchange.
   - *Left pane: "What GradeAssist exposes to your LMS."* Tool URL, login
     initiation URL, redirect URI, public JWKS URL — all read-only, all
     with copy-to-clipboard. A one-click "Copy as Moodle JSON preset"
     gives a paste-able blob the IT admin drops into Moodle's external
     tool configuration.
   - *Right pane: "What your LMS gives us back."* Form for: client ID,
     deployment ID, platform issuer URL, platform JWKS URL, auth
     endpoint. Inline help per field with a screenshot of where to find
     it in Moodle's Russian UI.
   - *"Test connection" button.* Sends a synthetic LTI launch and
     reports back: success (green), signature failure (red, with the
     exact mismatched value surfaced), endpoint unreachable (red, with
     a copy-able curl command the IT admin can run from their own
     network).

2. **Course mapping** — table of LTI course contexts that have arrived
   via real launches, unmapped ones flagged. Click a row → modal: "Map
   this LTI course to an org_unit." Tree picker (§7) preselects the
   `department` level. Optional auto-rule: *"automatically map any
   future LTI course whose `lis_course_section_sourcedid` starts with X
   to org unit Y."* Rules listed in a sub-section, editable. The auto-
   rule layer can ship in v1.1; manual mapping is enough for the first
   pilot.

3. **Activity log** — last 100 LTI launches with timestamp, course
   context, teacher email, status (accepted / rejected / mapping-
   pending). The single most-requested piece of UI during support
   tickets — invest in it early.

**Failure modes the UX must surface clearly** (these are the support
tickets you will get if it does not):

- Time skew between Moodle and GradeAssist servers (LTI JWTs are clock-
  sensitive). Surface as a banner with NTP guidance.
- Mis-matched issuer URL (the most common Moodle setup error). Surface
  in the *Test connection* diagnostic with the exact expected vs
  received value.
- Public JWKS not reachable from Moodle's network (firewall). Surface
  with a curl-equivalent command the IT admin can run from their own
  network to verify reachability.
- LTI course context arrives with no corresponding org_unit. Surface in
  the *Course mapping* screen with an "auto-create as `department`
  under parent X" quick-action so the IT admin is not blocked.

**Localisation.** Russian by default, English available. All screenshots
in inline help use the Russian Moodle UI. *Test connection* diagnostics
are translated. Russian university IT admins are competent, but the
mental friction of debugging a protocol-level issue in their second
language is real.

**v1 scope:** Setup + Test connection (required for first pilot), Course
mapping with manual rows (required), Activity log (basic table, no
filtering). Auto-rules and rich filtering defer to v1.1. Estimated
~1 week of focused UI work on top of the §6 LTI backend.

---

## 7. Organisational Structure Model

### 7.0 Why this section exists

The MVP schema models institutions flatly: one `institutions` row, teachers
attached by `institution_id`, three-value role enum on the teacher. That
model collapses the moment we touch a real university.

A typical Russian university has a multi-level academic hierarchy: rector /
vice-rector → administrative office (УМУ / УМЦ / УОЦ) → subject cluster →
institute or faculty → kafedra → teacher. A small private institute might
be flat: rector → kafedra → teacher. Either way the 2-level model is wrong:
it cannot scope reports, cannot route permissions correctly, cannot express
that one person holds multiple roles across the tree, and cannot support
cross-institutional comparison (§2.4) because there is no canonical notion
of what a "department" is.

This section locks the model **before** §5.1 and §6 build cements scoping
assumptions on the existing schema.

### 7.1 Model — canonical-typed, flexible-depth tree

A single self-referencing `org_units` table. Every unit has a parent (root
unit per institution has no parent), a free `name`, an institution-chosen
`short_name` (УМЦ, ОАиД, etc.), and a `type_code` drawn from a **canonical,
fixed list**:

| `type_code`    | Meaning | Examples |
|---|---|---|
| `institution`  | Top-level entity, billing/contract anchor | КНИТУ, a small private institute |
| `governance`   | Rector / vice-rector level; read-only viewing | Проректор по учебной работе |
| `admin_office` | Operational academic administration | УМУ, УМЦ, УОЦ, отдел тестирования |
| `cluster`      | Subject grouping under admin office | "Естественные науки," "Гуманитарные" |
| `division`     | Faculty or institute | Институт инженерной экологии |
| `department`   | Kafedra — the unit teachers belong to | Кафедра физики |

Depth is flexible — skip levels you do not have. Types are canonical — so
cross-institutional features stay comparable.

Teachers belong to exactly one `department` (their primary kafedra). They
may hold roles at any level above (§7.3).

### 7.2 Schema sketch

```sql
CREATE TABLE org_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES org_units(id) ON DELETE CASCADE,
  type_code       TEXT NOT NULL,        -- canonical, see §7.1
  name            TEXT NOT NULL,
  short_name      TEXT,                 -- УМЦ, ОАиД, etc.
  external_code   TEXT,                 -- LMS / AD / LTI mapping key (§6, §7.7)
  path            TEXT NOT NULL,        -- materialised path for subtree queries
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (institution_id, parent_id, name)
);

CREATE INDEX ON org_units (institution_id);
CREATE INDEX ON org_units (parent_id);
CREATE INDEX ON org_units (path text_pattern_ops);
CREATE INDEX ON org_units (institution_id, type_code);

ALTER TABLE teachers
  ADD COLUMN primary_org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;
```

`path` is a materialised path like `/inst-uuid/admin-uuid/dept-uuid/`.
Combined with `text_pattern_ops` it gives O(log n) subtree queries
(`WHERE path LIKE '/inst-uuid/admin-uuid/%'`) without recursive CTEs in
the hot path.

### 7.3 Role model — unit-scoped roles

Today's `teacher.role` collapses scope and capability into one enum.
Replace with a junction table:

```sql
CREATE TABLE org_unit_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  org_unit_id   UUID NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,    -- 'admin' | 'head' | 'viewer'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (teacher_id, org_unit_id, role)
);

CREATE INDEX ON org_unit_roles (teacher_id);
CREATE INDEX ON org_unit_roles (org_unit_id);
```

Role values:
- **`admin`** — full operational control of this unit and everything beneath
  it. Held by IT admin at the root; by УМЦ head at the УМЦ unit; etc.
- **`head`** — academic authority over this unit and everything beneath.
  Held by institute heads, kafedra heads.
- **`viewer`** — read-only dashboard access. Held by governance roles
  (vice-rector) who want to see numbers but not modify.

Authorisation: *"can teacher X perform action A on unit Y?"* = does X hold
an authoritative role on Y or on any ancestor of Y. Resolved by walking
the materialised path.

A teacher may hold multiple roles across the tree — very common in Russian
universities (a kafedra head is also a teacher; a deputy УМЦ head may also
head one cluster). The junction-table model accommodates this naturally;
the current enum cannot.

### 7.4 Two distinct admin concepts

The current single `institution_admin` value conflates two operationally
different roles:

| | Org / IT admin | Academic admin |
|---|---|---|
| Held by | IT department contact | УМЦ head, institute head, kafedra head |
| Scope | Root (`institution`) unit | A specific subtree |
| Cares about | Billing, LTI/SSO, AD sync, tree configuration | Teachers, grading quality, reports, rubrics |
| Daily user? | No | Yes |
| UI surface | Settings, integrations, contract | Dashboards, rubric library, reports |

Both are supported as `role='admin'` on different units in the tree, but
the *UI they land in* differs. v1: ship the academic-admin UI first (the
daily user); the IT-admin surface is a smaller settings area that can
follow.

### 7.5 Mappings — same model, different institutions

**КНИТУ (current test institution):**

```
КНИТУ                              [institution]
└─ Проректор по учебной работе    [governance]    — viewer
   └─ УМУ                          [admin_office]  — admin
      ├─ УМЦ                       [admin_office]  — admin (primary buyer)
      │  ├─ Subject cat. A         [cluster]
      │  │  └─ Институт X          [division]      — head
      │  │     ├─ Кафедра X1       [department]    — head
      │  │     │  └─ teachers
      │  │     └─ Кафедра X2       [department]    — head
      │  └─ Subject cat. B         [cluster]
      │     └─ ...
      └─ УОЦ                       [admin_office]
```

**Small private institute:**

```
SmallU                             [institution]  — admin (IT)
└─ Faculty of Economics            [division]     — head
   ├─ Кафедра экономики            [department]   — head
   └─ Кафедра менеджмента          [department]   — head
```

Same model, same query layer, same admin UI configured to the depth that
exists.

### 7.6 Onboarding variability — pick one for v1

Three options for how institutions populate their tree:

1. **Self-service tree builder.** IT admin draws the tree in a UI during
   onboarding. Maximum flexibility. Slow for large universities but small
   ones do it in ten minutes. **Recommended for v1.**
2. **Templates.** Ship preset trees (Federal university, Regional
   university, Pedagogical institute, Technical institute, Corporate
   training). Admin picks and tweaks. Accumulate templates from real
   onboarded institutions over time.
3. **LDAP / Active Directory sync.** Most Russian universities have org
   structure in AD; sync programmatically. Powerful institutional-sales
   feature but a real integration project. Pro+ / Institution tier,
   defer.

### 7.7 Implications for other sections

Each of these now resolves scope against the org tree rather than against
a flat `institution_id`:

- **§2.1 grading-fairness audit** — "comparable submissions in the same
  department" resolves to sibling teachers under the same
  `type_code='department'` unit. Inter-grader inconsistency rolls up at
  any tree level.
- **§2.2 curriculum coverage audit** — coverage matrix per `department`,
  rolled up to `division` and above. A УМЦ head sees *"X% of departments
  under me have full coverage; here are the gaps."*
- **§2.4 federated benchmarking** — canonical `type_code` is what makes
  cross-institutional comparison meaningful. Without it, peer benchmarks
  are not comparable.
- **§5.1 published assignments** — submission and telemetry visibility
  resolves to: the publishing teacher, plus any teacher holding
  `admin`/`head` on an ancestor unit of the publishing teacher's primary
  `department`.
- **§6 LTI / Moodle** — LTI course context lands on an `org_units` row via
  the `external_code` mapping key. The org tree and LTI integration ship
  together; neither makes complete sense without the other.

### 7.8 Build sequence

1. **Lock §7 design** — this section.
2. **Schema migration + middleware** — `org_units`, `org_unit_roles`,
   `teachers.primary_org_unit_id`, authorisation helper that walks the
   path. Backfill: one root `institution` unit per existing institution,
   all existing teachers assigned to a placeholder `department` under it;
   existing `institution_admin` rows mapped to `org_unit_roles(role='admin')`
   on the root.
3. **Minimal tree-admin UI** — IT-admin surface to build/edit the tree,
   assign teachers to units, assign roles. Enough to onboard the first
   pilot institution.
4. **Then §5.1 build.** Scoping uses the tree from day one rather than
   retrofitting.
5. **Then §6 LTI.** LTI mapping rides on `external_code`.
6. **Defer:** rich per-level dashboards, template library (§7.6 #2), AD
   sync (§7.6 #3).

Estimated 3–4 weeks of focused work for steps 2–3 before §5.1 starts.
Painful to retrofit later; worth doing now.

### 7.9 Documentation impact

- **CLAUDE.md Admin System section** needs revision *with* the §7.8 step
  2 migration — the 3-role model and flat institution assumption no
  longer hold. Update code and docs together.
- **CLAUDE.md Database Schema section** gains `org_units` and
  `org_unit_roles`.
- **TODO.md** gains Feature P (org structure tree) at L+ effort.
