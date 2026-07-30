import { chatJSON } from './deepseek'
import { webSearch, type SearchResult } from './yandexSearch'
import { createTopicSet } from '../db/queries/topics'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { pool } from '../db/connection'
import { logger } from '../lib/logger'
import type { TopicItem, TopicSet } from '../../../shared/types'

const LEVEL_RU: Record<string, string> = {
  bachelor: 'бакалавриат', specialist: 'специалитет', master: 'магистратура', postgraduate: 'аспирантура',
}
const WORK_RU: Record<string, string> = {
  coursework: 'курсовая работа', thesis: 'выпускная квалификационная работа (ВКР)',
  internship: 'производственная практика', pre_diploma: 'преддипломная практика', article: 'научная статья',
}
const LEVEL_GUIDANCE: Record<string, string> = {
  bachelor:     'Прикладная направленность, освоение и применение известных методов, чёткий измеримый результат. Без требования научной новизны.',
  specialist:   'Углублённая прикладная/инженерная задача с практической значимостью и обоснованием решений.',
  master:       'Исследовательская глубина: методология, анализ литературы, элемент научной новизны и самостоятельный вклад.',
  postgraduate: 'Оригинальный научный вклад, выраженная новизна, потенциал публикации, теоретическая и практическая значимость.',
}

interface GenerateParams {
  teacherId:    string
  institutionId?: string
  courseId?:    string
  level:        string
  workType:     string
  field?:       string
  interests?:   string
  practiceSite?: string
  studentName?:  string   // attached to the topic_set for later lookup; NOT sent to the AI
  studentGroup?: string
  count?:       number
}

export async function generateTopics(p: GenerateParams): Promise<TopicSet> {
  const count = Math.min(Math.max(p.count ?? 5, 1), 5)

  // Pull a little course context if linked
  let syllabus = ''
  if (p.courseId) {
    try {
      const { rows } = await pool.query<{ syllabus_text: string | null; name: string }>(
        `SELECT name, syllabus_text FROM courses WHERE id = $1 AND teacher_id = $2`, [p.courseId, p.teacherId]
      )
      if (rows[0]) syllabus = `Предмет: ${rows[0].name}. ${(rows[0].syllabus_text ?? '').slice(0, 600)}`
    } catch { /* non-fatal */ }
  }

  // Build a search query and ground on live results (best-effort)
  const queryParts = [p.field, p.interests, p.practiceSite, WORK_RU[p.workType]].filter(Boolean)
  const searchResults = queryParts.length
    ? await webSearch(queryParts.join(' '), 6, { teacherId: p.teacherId, institutionId: p.institutionId, feature: 'presentation' })   // reuse a logged feature bucket, same as the chatJSON call below
    : []
  const usedSearch = searchResults.length > 0

  const system =
    `Вы — опытный научный руководитель в российском вузе. Вы предлагаете студентам ценные, ` +
    `актуальные и выполнимые темы для исследований и практик с учётом уровня обучения и требований ФГОС. ` +
    `Темы должны быть конкретными (не общими формулировками), реалистичными по объёму и современными. ` +
    `Отвечайте только валидным JSON на русском языке.`

  const user = buildPrompt({ ...p, count, syllabus, searchResults })

  const result = await chatJSON<{ topics: TopicItem[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'список тем',
    { context: { teacherId: p.teacherId, feature: 'presentation' } },   // reuse a logged feature bucket
  )

  const topics = (result.topics ?? []).slice(0, count).map((t) => ({
    title:     String(t.title ?? '').trim(),
    rationale: String(t.rationale ?? '').trim(),
    scope:     String(t.scope ?? '').trim(),
    site_link: t.site_link ? String(t.site_link).trim() : undefined,
    outcome:   t.outcome ? String(t.outcome).trim() : undefined,
  })).filter((t) => t.title)

  if (topics.length === 0) {
    logger.warn({ message: 'Topic generation returned no topics', teacherId: p.teacherId })
  }

  return createTopicSet({
    teacherId: p.teacherId, courseId: p.courseId, level: p.level, workType: p.workType,
    field: p.field, interests: p.interests, practiceSite: p.practiceSite,
    studentName: p.studentName, studentGroup: p.studentGroup,
    topics, usedSearch,
  })
}

function buildPrompt(p: GenerateParams & { count: number; syllabus: string; searchResults: SearchResult[] }): string {
  const levelRu = LEVEL_RU[p.level] ?? p.level
  const workRu  = WORK_RU[p.workType] ?? p.workType

  const searchBlock = p.searchResults.length
    ? `## Актуальный контекст из поиска (используйте как ориентир для современности и связи с реальностью)\n` +
      p.searchResults.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}`).join('\n') + '\n\n'
    : ''

  const siteBlock = p.practiceSite
    ? `Место практики/исследования: ${sanitiseForPrompt(p.practiceSite)}. Каждая тема должна быть реально выполнима в этой организации и опираться на её деятельность.\n`
    : ''

  return `## Задача
Предложите ${p.count} тем для работы вида «${workRu}», уровень обучения — ${levelRu}.

## Требования к уровню
${LEVEL_GUIDANCE[p.level] ?? ''}

## Данные студента
Направление/специальность: ${sanitiseForPrompt(p.field ?? '—')}
Научные/практические интересы: ${sanitiseForPrompt(p.interests ?? '—')}
${siteBlock}${p.syllabus ? `Контекст предмета: ${sanitiseForPrompt(p.syllabus)}\n` : ''}
${searchBlock}## Формат ответа
Верните JSON: {"topics": [ ... ]}, где каждый элемент:
- "title": конкретная формулировка темы
- "rationale": почему тема ценна и актуальна (1–2 предложения)
- "scope": что именно предстоит сделать студенту (объём, методы — под уровень обучения)
${p.practiceSite ? '- "site_link": как тема связана с местом практики\n' : ''}${(p.level === 'master' || p.level === 'postgraduate') ? '- "outcome": ожидаемый результат и элемент научной новизны\n' : ''}
Темы должны различаться по направлению. Ответьте ТОЛЬКО JSON-объектом.`
}
