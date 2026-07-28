import { pool } from '../connection'
import type { UmcReadinessRow, RpdSubmissionStatus } from '../../../../shared/types'

interface ReadinessQueryRow {
  program_id:             string
  program_name:           string
  program_code:           string | null
  department_org_unit_id: string | null
  department_name:        string | null
  discipline_id:          string
  discipline_name:        string
  semester:                number
  syllabus_uploaded_at:   Date | null
  overall_coverage:       string | null   // numeric comes back as string from pg
  review_created_at:      Date | null
  submission_status:      string | null   // NULL = no rpd_submissions row yet (never touched)
}

function toRow(r: ReadinessQueryRow): UmcReadinessRow {
  return {
    program_id:             r.program_id,
    program_name:            r.program_name,
    program_code:            r.program_code,
    department_org_unit_id:  r.department_org_unit_id,
    department_name:         r.department_name,
    discipline_id:           r.discipline_id,
    discipline_name:         r.discipline_name,
    semester:                r.semester,
    has_syllabus:            r.syllabus_uploaded_at !== null,
    syllabus_uploaded_at:    r.syllabus_uploaded_at ? r.syllabus_uploaded_at.toISOString() : null,
    reviewed:                r.review_created_at !== null,
    overall_coverage:        r.overall_coverage !== null ? Number(r.overall_coverage) : null,
    review_created_at:       r.review_created_at ? r.review_created_at.toISOString() : null,
    // Phase 4c (docs/RPD-WORKFLOW.md) — the approval-stage column. NULL means
    // the discipline has never been submitted (getOrCreateSubmission only
    // materialises a 'draft' row on first touch), distinct from an explicit
    // 'draft' — the dashboard renders both the same way but the distinction
    // matters for anyone querying rpd_submissions directly later.
    submission_status:      r.submission_status as RpdSubmissionStatus | null,
  }
}

/**
 * One row per (programme, discipline) for every programme in the institution
 * (or, when `unitPathPrefixes` is given, every programme whose own org-tree
 * unit falls under one of those subtrees) — the readiness matrix's raw
 * material. "Department" is the parent of the programme's own org-tree unit
 * (programs.org_unit_id links to a `program`-typed unit; its immediate
 * parent is the owning кафедра/institute in practice) — a programme with no
 * org-tree link at all rolls up into a NULL-keyed "Без подразделения" bucket
 * rather than being dropped (and is excluded entirely once a subtree filter
 * is active, since it has no path to match against).
 *
 * Current syllabus = the non-superseded `working_programme` document for the
 * discipline (migration 084's supersede model — at most one such row exists
 * per discipline). Latest review = the most recent program_document_reviews
 * row for the discipline, if any (services/documentReview.ts / TODO Feature K).
 */
export async function findReadinessRows(
  institutionId: string,
  unitPathPrefixes?: string[]
): Promise<UmcReadinessRow[]> {
  const { rows } = await pool.query<ReadinessQueryRow>(
    `SELECT
       p.id                AS program_id,
       p.name              AS program_name,
       p.code              AS program_code,
       dept.id             AS department_org_unit_id,
       dept.name           AS department_name,
       pd.id               AS discipline_id,
       pd.name             AS discipline_name,
       pd.semester         AS semester,
       doc.uploaded_at     AS syllabus_uploaded_at,
       rev.result->>'overall_coverage' AS overall_coverage,
       rev.created_at      AS review_created_at,
       sub.status          AS submission_status
     FROM programs p
     JOIN program_disciplines pd ON pd.program_id = p.id
     LEFT JOIN org_units pu   ON pu.id = p.org_unit_id
     LEFT JOIN org_units dept ON dept.id = pu.parent_id
     LEFT JOIN LATERAL (
       SELECT uploaded_at FROM program_documents
        WHERE discipline_id = pd.id AND kind = 'working_programme' AND superseded_at IS NULL
        LIMIT 1
     ) doc ON true
     LEFT JOIN LATERAL (
       SELECT result, created_at FROM program_document_reviews
        WHERE discipline_id = pd.id
        ORDER BY created_at DESC
        LIMIT 1
     ) rev ON true
     LEFT JOIN rpd_submissions sub ON sub.discipline_id = pd.id
     WHERE p.institution_id = $1
       AND ($2::text[] IS NULL OR EXISTS (
             SELECT 1 FROM unnest($2::text[]) AS prefix WHERE pu.path LIKE prefix || '%'
           ))
     ORDER BY dept.name NULLS LAST, p.name, pd.semester, pd.sort_order`,
    [institutionId, unitPathPrefixes ?? null]
  )
  return rows.map(toRow)
}
