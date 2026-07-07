import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCriteria } from '../../api/criteria'

/**
 * Subtle nudge shown near the criterion picker when the teacher has never
 * created a criterion of their own (templates don't count — this is about
 * discovering the library, not just picking a generic starter). Non-blocking:
 * holistic grading works fine without criteria, but criteria are the
 * platform's stated differentiator, and a fresh user who never notices the
 * separate /criteria page grades holistically forever.
 */
export default function CriteriaHint() {
  const { data: criteria } = useQuery({ queryKey: ['criteria-all'], queryFn: () => getCriteria() })
  if (criteria === undefined || criteria.length > 0) return null

  return (
    <Link
      to="/criteria"
      className="flex items-center gap-1.5 text-xs font-sans text-amber hover:underline"
    >
      <span>＋</span>
      <span>Создайте свой первый критерий — так проверка будет точнее общих стандартов</span>
    </Link>
  )
}
