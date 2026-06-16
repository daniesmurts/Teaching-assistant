import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchFeedbackLibrary } from '../../api/feedbackLibrary'
import { getAssignment } from '../../api/grading'
import AssignmentDetailModal from './AssignmentDetailModal'
import { gradeColor } from '../../lib/grades'
import type { Assignment, GradeLetter } from '../../types'

interface Props {
  submissionText: string
  courseId:       string | undefined
  /** Whether to fire the search. Caller turns this on once grading starts. */
  active:         boolean
}

const MIN_CHARS = 200      // skip too-short submissions — embedding is noise
const QUERY_CAP = 1500     // embeddings have a token cap; head of the work is fine

/**
 * Shown next to the loading state in the grading form: the teacher's most
 * similar past approved feedback. Lets them remember how they handled the
 * same kind of work before — and gives them something to read instead of
 * staring at the spinner.
 */
export default function SimilarPastFeedback({ submissionText, courseId, active }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  // Cap the query input so the embedding call stays cheap.
  const queryText = submissionText.slice(0, QUERY_CAP).trim()

  const { data: hits = [], isLoading } = useQuery({
    // Quantise the query key — we don't want re-fires on every keystroke.
    queryKey: ['inline-similar', queryText.length, courseId, hashFirst(queryText, 64)],
    queryFn:  () => searchFeedbackLibrary({ q: queryText, course_id: courseId, limit: 1 }),
    enabled:  active && queryText.length >= MIN_CHARS,
    staleTime: 5 * 60_000,
  })

  // Fetch the assignment lazily when the teacher clicks through.
  const { data: openAssignment } = useQuery({
    queryKey: ['assignment', openId],
    queryFn:  () => getAssignment(openId!),
    enabled:  openId != null,
  })

  if (!active || queryText.length < MIN_CHARS) return null
  if (isLoading) return <Skeleton />
  if (hits.length === 0) return null

  const h = hits[0]
  return (
    <>
      <div className="mt-3 bg-amber-light/40 border border-amber/25 rounded-md p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-sans font-semibold text-amber uppercase tracking-wide">
            Похожий прошлый отзыв
          </span>
          <span className="text-[10px] font-sans text-ink-tertiary">
            сходство {Math.round((1 - h.similarity) * 100)}%
          </span>
        </div>
        <div className="flex items-start gap-2">
          {h.approved_grade && (
            <div
              className="font-display text-xl font-bold leading-none flex-shrink-0 w-6 text-center"
              style={{ color: gradeColor(h.approved_grade as GradeLetter) }}
            >
              {h.approved_grade}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] font-sans text-ink-secondary leading-relaxed line-clamp-4">
              {h.feedback_excerpt}
            </div>
            <button
              type="button"
              onClick={() => setOpenId(h.assignment_id)}
              className="text-[11px] font-sans font-medium text-amber hover:underline mt-1.5"
            >
              Открыть прошлую работу →
            </button>
          </div>
        </div>
      </div>

      {openAssignment && (
        <AssignmentDetailModal
          assignment={openAssignment as Assignment}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}

function Skeleton() {
  return (
    <div className="mt-3 bg-amber-light/40 border border-amber/25 rounded-md p-3">
      <div className="h-2 bg-amber/20 rounded w-1/3 mb-2" />
      <div className="h-2 bg-amber/15 rounded w-full mb-1.5" />
      <div className="h-2 bg-amber/15 rounded w-5/6" />
    </div>
  )
}

// Cheap stable string hash for the query key. We want the same value to
// produce the same key so React Query dedupes; we don't need cryptographic
// strength.
function hashFirst(s: string, len: number): number {
  let h = 0
  const end = Math.min(s.length, len)
  for (let i = 0; i < end; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return h
}
