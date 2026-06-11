import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCourses } from '../../api/courses'

/**
 * Subtle nudge shown under a course selector when the teacher has no courses yet.
 * Non-blocking — grading and presentations work without a course, but quality is
 * better with one, and a brand-new user landing here gets a clear next step.
 */
export default function NoCourseHint() {
  const { data: courses } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  if (courses === undefined || courses.length > 0) return null

  return (
    <Link
      to="/courses"
      className="flex items-center gap-1.5 mt-1.5 text-xs font-sans text-amber hover:underline"
    >
      <span>＋</span>
      <span>Создайте предмет — это повысит точность и сохранит контекст</span>
    </Link>
  )
}
