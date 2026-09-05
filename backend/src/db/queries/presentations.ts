import { pool } from '../connection'
import type {
  Presentation,
  PresentationStyle,
  PresentationSource,
  Slide,
  SlideImage,
} from '../../../../shared/types'

interface PresentationRow {
  id: string
  teacher_id: string
  course_id: string | null
  // Only present when the query joins courses (findPresentationsByTeacher /
  // findPresentationById) — absent (undefined) on plain `RETURNING *` rows
  // from create/update, which toPresentation() maps to null.
  course_name?: string | null
  lecture_number: number | null
  topic: string
  duration_minutes: number | null
  audience_level: string | null
  learning_goals: string[] | null
  style: string | null
  slide_count_target: number | null
  slides: Slide[] | null
  generated_content: string | null
  sources: PresentationSource[] | null
  source_text: string | null
  strict_source: boolean | null
  lecture_topic_id: string | null
  approved_at: Date | null
  visibility_scope: string | null
  scope_unit_id: string | null
  created_at: Date
}

function toPresentation(row: PresentationRow): Presentation {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    course_id: row.course_id,
    course_name: row.course_name ?? null,
    lecture_number: row.lecture_number,
    topic: row.topic,
    duration_minutes: row.duration_minutes,
    audience_level: row.audience_level,
    learning_goals: row.learning_goals,
    style: row.style as PresentationStyle | null,
    slide_count_target: row.slide_count_target,
    slides: row.slides,
    generated_content: row.generated_content,
    sources: row.sources,
    lecture_topic_id: row.lecture_topic_id ?? null,
    approved_at: row.approved_at ? row.approved_at.toISOString() : null,
    visibility_scope: (row.visibility_scope === 'unit' ? 'unit' : 'private'),
    scope_unit_id: row.scope_unit_id ?? null,
    created_at: row.created_at.toISOString(),
  }
}

export async function createPresentation(data: {
  teacherId: string
  courseId?: string
  lectureNumber?: number
  topic: string
  durationMinutes?: number
  audienceLevel?: string
  learningGoals?: string[]
  style?: string
  slideCountTarget?: number
  generatedContent: string
  slides?: Slide[]
  sources?: PresentationSource[]
  // Persisted so regenerating a single slide can rebuild the same params the
  // deck was written under (migration 119) — a strict-conspectus deck whose
  // conspectus wasn't kept could only be "regenerated" from invented material.
  sourceText?: string
  strictSource?: boolean
  lectureTopicId?: string
}): Promise<Presentation> {
  const { rows } = await pool.query<PresentationRow>(
    `INSERT INTO presentations
       (teacher_id, course_id, lecture_number, topic, duration_minutes,
        audience_level, learning_goals, style, slide_count_target,
        generated_content, slides, sources, source_text, strict_source, lecture_topic_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      data.teacherId,
      data.courseId ?? null,
      data.lectureNumber ?? null,
      data.topic,
      data.durationMinutes ?? null,
      data.audienceLevel ?? null,
      data.learningGoals ?? null,
      data.style ?? null,
      data.slideCountTarget ?? null,
      data.generatedContent,
      data.slides && data.slides.length > 0 ? JSON.stringify(data.slides) : null,
      data.sources && data.sources.length > 0 ? JSON.stringify(data.sources) : null,
      data.sourceText ?? null,
      Boolean(data.strictSource),
      data.lectureTopicId ?? null,
    ]
  )
  return toPresentation(rows[0])
}

// The generation params a deck was written under, for regenerating one slide
// (services/presentations.ts's regenerateSlide). Separate from
// findPresentationById because the conspectus is bulky and nothing else needs
// it — the public Presentation shape deliberately doesn't carry it.
export async function findPresentationGenerationInputs(
  id: string,
  teacherId: string,
): Promise<{ source_text: string | null; strict_source: boolean } | null> {
  const { rows } = await pool.query<{ source_text: string | null; strict_source: boolean | null }>(
    `SELECT source_text, strict_source FROM presentations WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  if (!rows[0]) return null
  return { source_text: rows[0].source_text, strict_source: Boolean(rows[0].strict_source) }
}

/**
 * Replaces the whole slide array (and the text rendering derived from it) —
 * the single write behind every Phase 1 mutation: edit, regenerate, delete,
 * insert, reorder. One presentation has exactly one writer (its owner, in one
 * browser tab), so a whole-array overwrite is fine here for the same reason
 * setSlideImage has always done it.
 *
 * `generatedContent` is passed in rather than recomputed here: rendering
 * slides as text lives in services/presentations.ts, and a query module that
 * reached into a service to keep a derived column in sync would invert the
 * dependency every other query file respects.
 */
export async function replaceSlides(
  id: string,
  teacherId: string,
  slides: Slide[],
  generatedContent: string,
): Promise<Presentation | null> {
  const { rows } = await pool.query<PresentationRow>(
    `UPDATE presentations
        SET slides = $1, generated_content = $2
      WHERE id = $3 AND teacher_id = $4
      RETURNING *`,
    [JSON.stringify(slides), generatedContent, id, teacherId]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}

// Replace a single slide's image (used by the picker UI). Returns the updated
// presentation or null if the id/teacher/idx combo doesn't match. We update
// the whole `slides` array in one shot — there's no concurrent writer per
// presentation so optimistic overwrite is fine.
export async function setSlideImage(
  id: string,
  teacherId: string,
  slideIdx: number,
  image: SlideImage | null
): Promise<Presentation | null> {
  const existing = await findPresentationById(id, teacherId)
  if (!existing || !existing.slides) return null
  if (slideIdx < 0 || slideIdx >= existing.slides.length) return null

  // Every slide type can carry an image now (TODO.md Feature AG Phase 2) —
  // diagram keeps its own body.image_query/image (see shared/types.ts's
  // SlideBase comment), everything else uses the top-level field. Route
  // already validated the slide actually has a query before calling here;
  // this just decides which of the two locations to write into.
  const next = existing.slides.map((s, i) => {
    if (i !== slideIdx) return s
    return s.type === 'diagram'
      ? { ...s, body: { ...s.body, image } }
      : { ...s, image }
  })

  const { rows } = await pool.query<PresentationRow>(
    `UPDATE presentations
        SET slides = $1
      WHERE id = $2 AND teacher_id = $3
      RETURNING *`,
    [JSON.stringify(next), id, teacherId]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}

export async function findPresentationsByTeacher(
  teacherId: string,
  courseId?: string
): Promise<Presentation[]> {
  if (courseId) {
    const { rows } = await pool.query<PresentationRow>(
      `SELECT p.*, c.name AS course_name
         FROM presentations p
         LEFT JOIN courses c ON c.id = p.course_id
        WHERE p.teacher_id = $1 AND p.course_id = $2
        ORDER BY p.created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toPresentation)
  }
  const { rows } = await pool.query<PresentationRow>(
    `SELECT p.*, c.name AS course_name
       FROM presentations p
       LEFT JOIN courses c ON c.id = p.course_id
      WHERE p.teacher_id = $1
      ORDER BY p.created_at DESC`,
    [teacherId]
  )
  return rows.map(toPresentation)
}

export async function findPresentationById(
  id: string,
  teacherId: string
): Promise<Presentation | null> {
  const { rows } = await pool.query<PresentationRow>(
    `SELECT p.*, c.name AS course_name
       FROM presentations p
       LEFT JOIN courses c ON c.id = p.course_id
      WHERE p.id = $1 AND p.teacher_id = $2
      LIMIT 1`,
    [id, teacherId]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}

export async function deletePresentation(id: string, teacherId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM presentations WHERE id = $1 AND teacher_id = $2',
    [id, teacherId]
  )
  return (rowCount ?? 0) > 0
}

// ─── «Готово» + style exemplars (TODO.md "### AO" Phase 2) ──────────────────

/** Marks a deck as one the teacher stands behind, or takes that back. */
export async function setPresentationApproved(
  id: string,
  teacherId: string,
  approved: boolean,
): Promise<Presentation | null> {
  const { rows } = await pool.query<PresentationRow>(
    `UPDATE presentations
        SET approved_at = ${'$3'}
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [id, teacherId, approved ? new Date() : null]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}

export interface ExemplarSlide {
  presentation_id: string
  topic:           string
  same_course:     boolean
  /** False for a deck a colleague shared to the кафедра (migration 123). */
  is_own:          boolean
  slide:           Slide
}

/**
 * Slides from decks this teacher has approved, as style references for a new
 * generation.
 *
 * Scoped to the teacher's OWN decks, deliberately. The plan said "course →
 * кафедра", but pooling one teacher's decks into a colleague's generation is
 * exactly what CLAUDE.md invariant 7 gates behind two explicit flags for
 * documents (`institutions.shared_rag_enabled` AND
 * `courses.share_rag_with_institution`), and presentations have no such flag
 * yet. Adding the pooling before the gate would be the leak that invariant
 * exists to prevent — so кафедра scope waits for a real share control.
 *
 * Same-course decks rank first: a teacher's voice is consistent, but the
 * register of a first-year lecture is not the register of a master's seminar,
 * and the course is the closest proxy for that we have.
 */
export async function findApprovedExemplarSlides(
  teacherId: string,
  courseId: string | undefined,
  deckLimit = 6,
): Promise<ExemplarSlide[]> {
  // Own approved decks, plus decks a кафедра has shared (migration 123).
  // The unit match is ancestor-or-self on the reader's own path, identical to
  // document retrieval's SCOPE_WHERE: a deck shared to /root/faculty reaches
  // everyone under it, one shared to a single кафедра does not leave it.
  //
  // `LIKE path || '%'` is safe against prefix collisions only because
  // org_units.path carries a trailing slash — '/a/bb/' does not match
  // '/a/b/%'. Verified against the live column, not assumed.
  //
  // Own decks always outrank shared ones, and same-course outranks the rest:
  // a colleague's style is a useful reference, the teacher's own is a better
  // one, and their own lecture on this very course is the best.
  const { rows } = await pool.query<{
    id: string; topic: string; course_id: string | null; slides: Slide[] | null; is_own: boolean
  }>(
    `WITH me AS (
       SELECT t.id, t.institution_id, u.path AS unit_path
         FROM teachers t
         LEFT JOIN org_units u ON u.id = t.primary_org_unit_id
        WHERE t.id = $1
     )
     SELECT p.id, p.topic, p.course_id, p.slides, (p.teacher_id = $1) AS is_own
       FROM presentations p
       JOIN teachers pt ON pt.id = p.teacher_id
       CROSS JOIN me
      WHERE p.approved_at IS NOT NULL
        AND p.slides IS NOT NULL
        AND (
          p.teacher_id = $1
          OR (
            p.visibility_scope = 'unit'
            AND me.unit_path IS NOT NULL
            AND pt.institution_id IS NOT DISTINCT FROM me.institution_id
            AND EXISTS (
              SELECT 1 FROM org_units su
               WHERE su.id = p.scope_unit_id AND me.unit_path LIKE su.path || '%'
            )
          )
        )
      ORDER BY (p.teacher_id = $1) DESC,
               (p.course_id IS NOT DISTINCT FROM $2) DESC,
               p.approved_at DESC
      LIMIT $3`,
    [teacherId, courseId ?? null, deckLimit]
  )

  return rows.flatMap((row) =>
    (row.slides ?? []).map((slide) => ({
      presentation_id: row.id,
      topic:           row.topic,
      same_course:     Boolean(courseId) && row.course_id === courseId,
      is_own:          row.is_own,
      slide,
    }))
  )
}

/** Decks shared to a unit on this teacher's own path — the кафедра bank. */
export async function findSharedPresentations(teacherId: string): Promise<Presentation[]> {
  const { rows } = await pool.query<PresentationRow>(
    `WITH me AS (
       SELECT t.id, t.institution_id, u.path AS unit_path
         FROM teachers t
         LEFT JOIN org_units u ON u.id = t.primary_org_unit_id
        WHERE t.id = $1
     )
     SELECT p.*, c.name AS course_name
       FROM presentations p
       JOIN teachers pt ON pt.id = p.teacher_id
       LEFT JOIN courses c ON c.id = p.course_id
       CROSS JOIN me
      WHERE p.visibility_scope = 'unit'
        -- Still «Готово»: the route refuses to share an unapproved deck, and
        -- un-approving one afterwards must take it off the shelf as well, not
        -- merely stop it feeding generation. Otherwise the bank slowly fills
        -- with lectures their own authors have disowned.
        AND p.approved_at IS NOT NULL
        AND p.teacher_id <> $1
        AND me.unit_path IS NOT NULL
        AND pt.institution_id IS NOT DISTINCT FROM me.institution_id
        AND EXISTS (
          SELECT 1 FROM org_units su
           WHERE su.id = p.scope_unit_id AND me.unit_path LIKE su.path || '%'
        )
      ORDER BY p.approved_at DESC NULLS LAST, p.created_at DESC
      LIMIT 50`,
    [teacherId]
  )
  return rows.map(toPresentation)
}

/**
 * Promotes a deck to a кафедра, or takes it back to private. Not teacher-
 * scoped on purpose: promotion is a curation act a методист performs on
 * someone else's deck, so the *route* enforces who may do it (the same
 * umu/edit grant documents require), exactly as promoteDocumentScope does.
 */
export async function setPresentationScope(
  id: string,
  scope: 'private' | 'unit',
  scopeUnitId: string | null,
): Promise<Presentation | null> {
  const { rows } = await pool.query<PresentationRow>(
    `UPDATE presentations
        SET visibility_scope = $2, scope_unit_id = $3
      WHERE id = $1
      RETURNING *`,
    [id, scope, scope === 'unit' ? scopeUnitId : null]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}

/** Unscoped read — the scope route must see a deck it does not own. */
export async function findPresentationByIdUnscoped(id: string): Promise<Presentation | null> {
  const { rows } = await pool.query<PresentationRow>(
    `SELECT p.*, c.name AS course_name FROM presentations p
       LEFT JOIN courses c ON c.id = p.course_id
      WHERE p.id = $1 LIMIT 1`,
    [id]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}
