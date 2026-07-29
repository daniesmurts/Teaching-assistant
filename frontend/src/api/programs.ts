import client from './client'
import type {
  Program, ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramAnalysis,
  ProgramPracticeType, ProgramDocumentKind, ProgramDocument, ProgramDocumentReview,
  ProgramDocumentDiff, MarketEvidence, SupportedRegion, RpdSubmission, ProgramTopology, ProgramContentUnit,
  ProgramPlacementReview, ProgramMtoReview,
} from '../types'

// Academic programs (учебные планы) — institution-admin feature.

export async function listPrograms(): Promise<Program[]> {
  const res = await client.get<Program[]>('/api/institution/programs')
  return res.data
}

export interface CreateProgramInput {
  name: string
  code?: string | null
  level?: string | null
  duration_semesters?: number
  description?: string | null
  // Link into the §7 org tree. Only settable by IT admin (all-rw scope). Sets
  // which `program` org_unit's `head` becomes this programme's РОП.
  org_unit_id?: string | null
}

export async function createProgram(input: CreateProgramInput): Promise<Program> {
  const res = await client.post<Program>('/api/institution/programs', input)
  return res.data
}

export interface ImportProgramInput {
  code?: string
  specialty_name?: string
  education_level?: string
  profile?: string
  forms_of_study?: string
  name?: string                 // falls back to specialty_name server-side
  description?: File | null      // описание ОП (PDF) — or descriptionUrl
  descriptionUrl?: string        // link to описание ОП in the university system
  plan?: File | null             // учебный план (PDF) — this OR planUrl required
  planUrl?: string               // link to учебный план in the university system
  // Required when the caller is `specific` scope (РОП). Optional for `all-rw`
  // (they may link later via the detail page's structure select).
  org_unit_id?: string | null
  // Migration 050 attachment — практики (each with a type). Рабочая программа
  // is NOT gathered at intake (migration 051) — it's attached later, per
  // discipline, from the programme's document library.
  practices?: { file: File; type: ProgramPracticeType }[]
}

export interface ImportProgramResult {
  program: Program
  imported: { disciplines: number; competencies: number }
  warnings: string[]
}

// Program units the caller may link a new/edited programme to. Server picks
// the right set per scope: all program units in the institution for all-rw;
// the caller's subtree-walked set for specific (РОПы, polygroup heads).
export interface PickableProgramUnit {
  id:         string
  name:       string
  short_name: string | null
  type_code:  'program' | 'program_direction'
  // Programme metadata (migration 055) — prefills the import form when the
  // admin recorded the ФГОС header on the unit.
  code:            string | null
  specialty_name:  string | null
  education_level: string | null
  forms_of_study:  string | null
}

export async function getPickableProgramUnits(): Promise<PickableProgramUnit[]> {
  return (await client.get<PickableProgramUnit[]>('/api/institution/programs/pickable-units')).data
}

export async function importProgram(input: ImportProgramInput): Promise<ImportProgramResult> {
  const fd = new FormData()
  const name = input.name || input.specialty_name || ''
  if (name) fd.append('name', name)
  if (input.code) fd.append('code', input.code)
  if (input.specialty_name) fd.append('specialty_name', input.specialty_name)
  if (input.education_level) fd.append('education_level', input.education_level)
  if (input.profile) fd.append('profile', input.profile)
  if (input.forms_of_study) fd.append('forms_of_study', input.forms_of_study)
  // Описание ОП: an uploaded file OR a university-system link.
  if (input.description) fd.append('description', input.description)
  else if (input.descriptionUrl) fd.append('description_url', input.descriptionUrl)
  if (input.org_unit_id) fd.append('org_unit_id', input.org_unit_id)
  // Учебный план: an uploaded file OR a university-system link.
  if (input.plan) fd.append('plan', input.plan)
  else if (input.planUrl) fd.append('plan_url', input.planUrl)

  // Migration 050 attachment — практики.
  if (input.practices) {
    for (const p of input.practices) {
      fd.append('practices', p.file)
      fd.append('practice_types', p.type)
    }
  }

  // Extraction + two LLM parse passes — can take ~1–2 minutes.
  const res = await client.post<ImportProgramResult>('/api/institution/programs/import', fd, { timeout: 240_000 })
  return res.data
}

// ─── Attached documents (migration 050) ───────────────────────────────────────

export async function uploadProgramDocument(
  programId: string,
  input: {
    kind: ProgramDocumentKind
    practiceType?: ProgramPracticeType | null
    // Required when kind === 'working_programme' (migration 051) — which
    // discipline this РПД belongs to. A re-upload for the same discipline
    // replaces the previous file server-side.
    disciplineId?: string | null
  } & (
    // Either an uploaded file OR a link to the university's document system —
    // the server fetches the latter (restricted to the institution's domains).
    | { file: File; fileUrl?: never }
    | { fileUrl: string; file?: never }
  )
): Promise<{ id: string; detected_competency_codes: string[]; replaced_review: boolean }> {
  const fd = new FormData()
  if ('file' in input && input.file) fd.append('file', input.file)
  else if ('fileUrl' in input && input.fileUrl) fd.append('file_url', input.fileUrl)
  fd.append('kind', input.kind)
  if (input.practiceType) fd.append('practice_type', input.practiceType)
  if (input.disciplineId) fd.append('discipline_id', input.disciplineId)
  const res = await client.post<{ id: string; detected_competency_codes?: string[]; replaced_review?: boolean }>(
    // The auto-detect LLM pass runs synchronously on the same request — bumps
    // the client-side timeout from the axios default (30s) so a slow model
    // reply doesn't cancel the upload before it finishes.
    `/api/institution/programs/${programId}/documents`, fd, { timeout: 90_000 }
  )
  return {
    id: res.data.id,
    detected_competency_codes: res.data.detected_competency_codes ?? [],
    // Server signals when a previous coverage review for this discipline was
    // dropped (cascade off the replaced document row). The UI toasts a hint
    // so the user knows to re-run «Проверить соответствие».
    replaced_review: res.data.replaced_review ?? false,
  }
}

export async function deleteProgramDocument(programId: string, docId: string): Promise<void> {
  await client.delete(`/api/institution/programs/${programId}/documents/${docId}`)
}

// ─── Bulk РПД discovery from the /sveden/education disclosure page ────────────

export interface SvedenDiscoveredItem {
  url:              string
  text:             string
  kind:             'working_programme' | 'practice'
  practice_type:    ProgramPracticeType | null
  discipline_id:    string | null
  match_confidence: 'exact' | 'fuzzy' | null
  /** РПД: the matched discipline already has a current file (import would supersede it). Practice: that type is already uploaded (import replaces). */
  has_current_doc:  boolean
}

export interface SvedenDiscoverResult {
  matched:    { code: string | null; name: string | null; profile: string | null } | null
  /** Populated instead of items when the programme row couldn't be identified —
   *  either no row matched, or (verified against a real pilot university)
   *  the code matched several rows across different профили with no way to
   *  tell them apart from the programme's own name. `profile` distinguishes
   *  those candidates, which otherwise look identical (same code + name). */
  candidates: { code: string | null; name: string | null; profile: string | null; doc_count: number }[]
  items:      SvedenDiscoveredItem[]
  /** Counts of links found but not importable here (план/описание/график/аннотации). */
  skipped:    Record<string, number>
  /** Years found as separate tabs on a multi-year page (verified against a
   *  real pilot university, which bundles ALL years into one response
   *  behind client-side tabs), newest first. Empty for a single-year page. */
  available_years: string[]
  /** Which year's tab was actually parsed — the page's own default/active
   *  tab unless a different `year` was requested. Null on a single-year page. */
  selected_year: string | null
}

/** Fetch + parse the university's «Сведения → Образование» page and return the
 *  importable-document checklist for this programme. The import itself then
 *  runs client-side through uploadProgramDocument per confirmed item.
 *  Real disclosure pages can be huge (a pilot university's ran 13+ MB and
 *  took 2+ minutes server-side, per its own on-page "please wait" banner) —
 *  timeout here must clear the backend's own PAGE_FETCH_TIMEOUT_MS (240s).
 *  `year` re-runs against a specific tab on a multi-year page (see
 *  available_years/selected_year on the result). */
export async function discoverProgramDocuments(
  programId: string, pageUrl: string, year?: string
): Promise<SvedenDiscoverResult> {
  const res = await client.post<SvedenDiscoverResult>(
    `/api/institution/programs/${programId}/documents/discover`,
    { page_url: pageUrl, year },
    { timeout: 260_000 }
  )
  return res.data
}

// ─── Discipline document review (migration 051 — Feature K scoped to a discipline) ──

export async function reviewDiscipline(programId: string, disciplineId: string): Promise<ProgramDocumentReview> {
  // One chatJSON call — same timeout budget as the other AI-backed program actions.
  const res = await client.post<ProgramDocumentReview>(
    `/api/institution/programs/${programId}/disciplines/${disciplineId}/review`, {}, { timeout: 120_000 }
  )
  return res.data
}

/**
 * Bridge into РПД-студия: find-or-create the caller's personal предмет for
 * this programme discipline (seeded with the uploaded РПД's text) and return
 * its id for navigation to /curriculum?tab=studio&course=<id>.
 */
export async function openDisciplineInStudio(
  programId: string, disciplineId: string
): Promise<{ course_id: string; created: boolean }> {
  const res = await client.post<{ course_id: string; created: boolean }>(
    `/api/institution/programs/${programId}/disciplines/${disciplineId}/studio-course`, {}
  )
  return res.data
}

export async function getDisciplineReviews(programId: string): Promise<ProgramDocumentReview[]> {
  const res = await client.get<ProgramDocumentReview[]>(`/api/institution/programs/${programId}/discipline-reviews`)
  return res.data
}

// ─── «Место дисциплины в структуре ОП» (migration 100) ────────────────────────

export async function reviewDisciplinePlacement(
  programId: string, disciplineId: string
): Promise<ProgramPlacementReview> {
  const res = await client.post<ProgramPlacementReview>(
    `/api/institution/programs/${programId}/disciplines/${disciplineId}/placement-review`, {}, { timeout: 120_000 }
  )
  return res.data
}

export async function getPlacementReviews(programId: string): Promise<ProgramPlacementReview[]> {
  const res = await client.get<ProgramPlacementReview[]>(`/api/institution/programs/${programId}/placement-reviews`)
  return res.data
}

// ─── «Материально-техническое обеспечение» (migration 101) ────────────────────

export async function reviewDisciplineMto(
  programId: string, disciplineId: string
): Promise<ProgramMtoReview> {
  const res = await client.post<ProgramMtoReview>(
    `/api/institution/programs/${programId}/disciplines/${disciplineId}/mto-review`, {}, { timeout: 120_000 }
  )
  return res.data
}

export async function getMtoReviews(programId: string): Promise<ProgramMtoReview[]> {
  const res = await client.get<ProgramMtoReview[]>(`/api/institution/programs/${programId}/mto-reviews`)
  return res.data
}

// ─── РПД approval — РОП side (docs/RPD-WORKFLOW.md phase 4b) ──────────────────

export interface AssignableTeacher {
  id:    string
  name:  string | null
  email: string
}

/** Lean institution-wide teacher list for the «Ответственный» picker — see
 *  the backend route's comment for why this isn't institution.ts's /teachers. */
export async function getAssignableTeachers(): Promise<AssignableTeacher[]> {
  const res = await client.get<AssignableTeacher[]>('/api/institution/programs/teachers')
  return res.data
}

/** Assign (or clear, with `null`) the teacher responsible for authoring this
 *  discipline's РПД. Separate from saveDisciplines — never bundled into a
 *  plan-structure save. */
export async function setDisciplineResponsible(
  programId: string, disciplineId: string, teacherId: string | null,
): Promise<void> {
  await client.put(`/api/institution/programs/${programId}/disciplines/${disciplineId}/responsible`, { teacherId })
}

/** 'submitted' items for one programme — the РОП's own review queue. */
export async function getSubmissionQueue(programId: string): Promise<RpdSubmission[]> {
  const res = await client.get<RpdSubmission[]>(`/api/institution/programs/${programId}/submissions`)
  return res.data
}

export async function actOnSubmission(
  programId: string, disciplineId: string, action: 'return' | 'forward', comment?: string,
): Promise<RpdSubmission> {
  const res = await client.post<RpdSubmission>(
    `/api/institution/programs/${programId}/disciplines/${disciplineId}/submission/${action}`,
    { comment }
  )
  return res.data
}

// ─── Year-over-year РПД diff (migration 084, Research.md §9.6) ────────────────

/** «Что изменилось с прошлого года» — compares the discipline's current РПД against the version it superseded. Cached server-side per document pair. */
export async function diffDiscipline(programId: string, disciplineId: string): Promise<ProgramDocumentDiff> {
  const res = await client.post<ProgramDocumentDiff>(
    `/api/institution/programs/${programId}/disciplines/${disciplineId}/diff`, {}, { timeout: 120_000 }
  )
  return res.data
}

/** URL for a direct authenticated GET — the axios interceptor adds the JWT. */
export function programDocumentDownloadUrl(programId: string, docId: string): string {
  return `/api/institution/programs/${programId}/documents/${docId}/download`
}

/** Trigger a browser download for a document — hits the download endpoint via
 *  axios so the JWT is attached, then converts the blob to a save prompt. */
export async function downloadProgramDocument(programId: string, doc: ProgramDocument): Promise<void> {
  const res = await client.get<Blob>(programDocumentDownloadUrl(programId, doc.id), { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a   = document.createElement('a')
  a.href    = url
  a.download = doc.file_name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function getProgram(id: string): Promise<ProgramDetail> {
  const res = await client.get<ProgramDetail>(`/api/institution/programs/${id}`)
  return res.data
}

export interface UpdateProgramInput extends Partial<CreateProgramInput> {
  // Official ФГОС header fields — settable after creation (fixing a typo'd
  // code or misspelt specialty name is otherwise a dead end: it silently
  // breaks sveden-page discipline matching and ФГОС-code lookups keyed on
  // `code`, and nothing surfaced why the import kept failing).
  specialty_name?:  string | null
  education_level?: string | null
  profile?:         string | null
  forms_of_study?:  string | null
}

export async function updateProgram(id: string, input: UpdateProgramInput): Promise<Program> {
  const res = await client.patch<Program>(`/api/institution/programs/${id}`, input)
  return res.data
}

export async function deleteProgram(id: string): Promise<void> {
  await client.delete(`/api/institution/programs/${id}`)
}

export async function saveDisciplines(id: string, disciplines: ProgramDiscipline[]): Promise<ProgramDetail> {
  const res = await client.put<ProgramDetail>(`/api/institution/programs/${id}/disciplines`, { disciplines })
  return res.data
}

export async function saveCompetencies(id: string, competencies: ProgramCompetency[]): Promise<ProgramDetail> {
  const res = await client.put<ProgramDetail>(`/api/institution/programs/${id}/competencies`, { competencies })
  return res.data
}

export async function analyzeProgram(id: string): Promise<ProgramAnalysis> {
  // Embedding pass + two LLM calls — can take ~1 minute. Override the default timeout.
  const res = await client.post<ProgramAnalysis>(`/api/institution/programs/${id}/analyze`, {}, { timeout: 180_000 })
  return res.data
}

export async function getAnalysis(id: string): Promise<ProgramAnalysis | null> {
  const res = await client.get<ProgramAnalysis | null>(`/api/institution/programs/${id}/analysis`)
  return res.data
}

export async function getProgramTopology(id: string): Promise<ProgramTopology> {
  const res = await client.get<ProgramTopology>(`/api/institution/programs/${id}/topology`)
  return res.data
}

export async function getDisciplineContentUnits(programId: string, disciplineId: string): Promise<ProgramContentUnit[]> {
  const res = await client.get<ProgramContentUnit[]>(
    `/api/institution/programs/${programId}/disciplines/${disciplineId}/content-units`
  )
  return res.data
}

// ─── РОП Студия v0 — market evidence (TODO Feature Z, Phase 0) ─────────────

export async function getSupportedRegions(): Promise<SupportedRegion[]> {
  const res = await client.get<SupportedRegion[]>('/api/institution/programs/regions')
  return res.data
}

export async function getMarketEvidence(programId: string): Promise<MarketEvidence | null> {
  const res = await client.get<MarketEvidence | null>(`/api/institution/programs/${programId}/market-evidence`)
  return res.data
}

export async function generateMarketEvidence(
  programId: string,
  input: { regionCodes: string[]; professions: string[] }
): Promise<MarketEvidence> {
  // A trudvsem fetch per (region × profession term) pair + one LLM call —
  // override the default timeout; scales with how many regions are picked.
  const res = await client.post<MarketEvidence>(
    `/api/institution/programs/${programId}/market-evidence`,
    { region_codes: input.regionCodes, professions: input.professions },
    { timeout: 30_000 + input.regionCodes.length * 20_000 }
  )
  return res.data
}

export async function updateMarketEvidence(
  programId: string, evidenceId: string, sectionText: string
): Promise<MarketEvidence> {
  const res = await client.put<MarketEvidence>(
    `/api/institution/programs/${programId}/market-evidence/${evidenceId}`,
    { section_text: sectionText }
  )
  return res.data
}

// Download the server-rendered PDF of the latest analysis and save it locally.
// Uses a blob fetch (so the JWT interceptor authenticates the request).
export async function downloadAnalysisPdf(id: string, filename: string): Promise<void> {
  const res = await client.get(`/api/institution/programs/${id}/analysis.pdf`, {
    responseType: 'blob', timeout: 120_000,
  })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
