import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { selectRelevantSections, validateEvidence } from './documentReview'
import type {
  ProgramCompetency, DocumentDiffResult, DocumentDiffTopicChange,
  DocumentDiffCompetencyChange, DocumentDiffAssessmentChange, DiffChangeKind,
} from '../../../shared/types'

// «Что изменилось с прошлого года» (Research.md §9.6) — compares a
// discipline's current РПД against the version it superseded (migration 084)
// and reports material differences as a structured diff: changed topics,
// changed competency mappings, changed assessment forms. Deliberately NOT a
// text diff — a teacher re-uploading a lightly reformatted РПД shouldn't get
// a wall of noise.
//
// Modeled directly on reviewDocumentCoverage in documentReview.ts: same
// chatJSON-direct pattern, same section-aware slicing, same verbatim-quote
// evidence contract (non-negotiable rule #2). The two documents now share
// one prompt's token budget, so each gets half the budget that single-
// document review uses.
const MAX_DOC_CHARS_EACH = 18000
const MAX_COMPETENCIES = 24

const VALID_KIND: DiffChangeKind[] = ['added', 'removed', 'changed']

export async function diffWorkingProgrammes(params: {
  teacherId:      string
  institutionId?: string
  oldText:        string
  newText:        string
  competencies:   ProgramCompetency[]   // discipline's declared competencies — for mapping-change framing
  label:          string                // discipline name, for prompt context
}): Promise<DocumentDiffResult> {
  const oldText = selectRelevantSections(params.oldText, MAX_DOC_CHARS_EACH)
  const newText = selectRelevantSections(params.newText, MAX_DOC_CHARS_EACH)
  const oldHaystack = oldText.toLowerCase().replace(/\s+/g, ' ').trim()
  const newHaystack = newText.toLowerCase().replace(/\s+/g, ' ').trim()

  const competencies = params.competencies.slice(0, MAX_COMPETENCIES)
  const competencyBlock = competencies.length > 0
    ? competencies.map((c) => `${c.code ? `[${sanitiseForPrompt(c.code)}]` : '[ЦЕЛЬ]'} ${sanitiseForPrompt(c.title)}`).join('\n')
    : '(не заявлены)'

  const system =
    'Вы — методист российского вуза, эксперт по экспертизе рабочих программ дисциплин (РПД). ' +
    'Вам даны ДВЕ версии одной и той же РПД — прошлогодняя и текущая. Ваша задача — найти ' +
    'СУЩЕСТВЕННЫЕ содержательные различия между ними, а не переформулировки или изменения ' +
    'форматирования. Сравнивайте: (1) темы и разделы тематического плана — добавленные, ' +
    'удалённые, заметно переработанные; (2) коды компетенций/индикаторов, которые дисциплина ' +
    'заявляет формировать — добавленные или снятые; (3) формы контроля и оценочные средства ' +
    '(фонд оценочных средств) — изменившиеся форматы аттестации, новые/убранные виды работ. ' +
    'Если версии по сути совпадают — верните unchanged=true и пустые списки, а не надуманные ' +
    'находки. Отвечайте только валидным JSON на русском.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(params.label)}\n\n` +
    `## Заявленные компетенции дисциплины (для контекста при сравнении раздела компетенций)\n${competencyBlock}\n\n` +
    `## Прошлогодняя версия РПД\n<old>\n${sanitiseForPrompt(oldText)}\n</old>\n\n` +
    `## Текущая версия РПД\n<new>\n${sanitiseForPrompt(newText)}\n</new>\n\n` +
    `## Задача\nСравните <old> и <new>. Для каждого найденного различия укажите kind: ` +
    `"added" (появилось в новой версии), "removed" (было в старой, исчезло в новой) или ` +
    `"changed" (было и осталось, но заметно изменилось). Дайте evidence — ДОСЛОВНУЮ короткую ` +
    `цитату (5–15 слов): из <new> для "added"/"changed", из <old> для "removed". Если дословной ` +
    `цитаты нет — оставьте evidence пустым. detail — 1 короткое предложение о сути изменения ` +
    `(можно оставить пустым для простого добавления/удаления).\n\n` +
    `## Формат ответа\nВерните JSON:\n` +
    `{"summary":"1-2 предложения общего вывода","unchanged":false,` +
    `"topics":[{"kind":"added","topic":"...","detail":"...","evidence":"..."}],` +
    `"competencies":[{"kind":"removed","code":"ОПК-2","title":"...","detail":"..."}],` +
    `"assessment":[{"kind":"changed","form":"экзамен","detail":"..."}]}\n` +
    `Только JSON. Если существенных различий нет — {"summary":"...","unchanged":true,"topics":[],"competencies":[],"assessment":[]}.`

  interface RawTopic { kind?: string; topic?: string; detail?: string; evidence?: string | null }
  interface RawCompetency { kind?: string; code?: string | null; title?: string; detail?: string }
  interface RawAssessment { kind?: string; form?: string; detail?: string }
  interface RawResult {
    summary?: string
    unchanged?: boolean
    topics?: RawTopic[]
    competencies?: RawCompetency[]
    assessment?: RawAssessment[]
  }

  const result = await chatJSON<RawResult>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'сравнение версий РПД',
    { context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' }, maxTokens: 4000 },
  )

  const topics: DocumentDiffTopicChange[] = (result.topics ?? [])
    .filter((t) => VALID_KIND.includes(t.kind as DiffChangeKind) && String(t.topic ?? '').trim().length > 0)
    .map((t) => {
      const kind = t.kind as DiffChangeKind
      const haystack = kind === 'removed' ? oldHaystack : newHaystack
      return {
        kind,
        topic:    String(t.topic ?? '').trim(),
        detail:   String(t.detail ?? '').trim(),
        evidence: validateEvidence(t.evidence, haystack),
      }
    })

  const competencyChanges: DocumentDiffCompetencyChange[] = (result.competencies ?? [])
    .filter((c) => VALID_KIND.includes(c.kind as DiffChangeKind) && String(c.title ?? '').trim().length > 0)
    .map((c) => ({
      kind:   c.kind as DiffChangeKind,
      code:   c.code ? String(c.code).trim() : null,
      title:  String(c.title ?? '').trim(),
      detail: String(c.detail ?? '').trim(),
    }))

  const assessment: DocumentDiffAssessmentChange[] = (result.assessment ?? [])
    .filter((a) => VALID_KIND.includes(a.kind as DiffChangeKind) && String(a.form ?? '').trim().length > 0)
    .map((a) => ({
      kind:   a.kind as DiffChangeKind,
      form:   String(a.form ?? '').trim(),
      detail: String(a.detail ?? '').trim(),
    }))

  const unchanged = result.unchanged === true
    || (topics.length === 0 && competencyChanges.length === 0 && assessment.length === 0)

  return {
    summary: String(result.summary ?? '').trim(),
    unchanged,
    topics,
    competencies: competencyChanges,
    assessment,
  }
}
