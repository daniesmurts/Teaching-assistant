import client from './client'
import type {
  Program, ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramAnalysis,
  ProgramPracticeType, ProgramDocumentKind, ProgramDocument,
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
  description?: File | null      // описание ОП (PDF)
  plan: File                     // учебный план (PDF) — required
  // Required when the caller is `specific` scope (РОП). Optional for `all-rw`
  // (they may link later via the detail page's structure select).
  org_unit_id?: string | null
  // Migration 050 attachments — рабочая программа + практики (each with a type).
  working_programme?: File | null
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
  if (input.description) fd.append('description', input.description)
  if (input.org_unit_id) fd.append('org_unit_id', input.org_unit_id)
  fd.append('plan', input.plan)

  // Migration 050 attachments — рабочая программа + практики.
  if (input.working_programme) fd.append('working_programme', input.working_programme)
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
  input: { file: File; kind: ProgramDocumentKind; practiceType?: ProgramPracticeType | null }
): Promise<{ id: string }> {
  const fd = new FormData()
  fd.append('file', input.file)
  fd.append('kind', input.kind)
  if (input.practiceType) fd.append('practice_type', input.practiceType)
  const res = await client.post<{ id: string }>(`/api/institution/programs/${programId}/documents`, fd)
  return res.data
}

export async function deleteProgramDocument(programId: string, docId: string): Promise<void> {
  await client.delete(`/api/institution/programs/${programId}/documents/${docId}`)
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

export async function updateProgram(id: string, input: Partial<CreateProgramInput>): Promise<Program> {
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
