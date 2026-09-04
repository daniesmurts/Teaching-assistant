import { useQuery } from '@tanstack/react-query'
import { getLibrary } from '../../api/library'
import type { DocumentVisibilityScope, DocumentProvenance } from '../../types'

// Feature AN — Кафедральная библиотека (TODO.md "### AN"). Read-only roster
// of documents teachers have promoted above their own course's RAG scope
// (routes/documents.ts's PATCH /:id/scope, triggered from a course's
// materials list — components/ui/DocumentUpload.tsx). Reuse counts
// (Phase 3) come for free from Feature AN Phase 0's rag_document_uses log.
export default function InstitutionLibrary() {
  const { data, isLoading } = useQuery({
    queryKey: ['institution-library'],
    queryFn:  getLibrary,
  })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <h1 className="font-display text-2xl font-bold text-ink mb-2">Библиотека кафедры</h1>
        <p className="text-xs font-sans text-ink-tertiary mb-6 max-w-prose leading-relaxed">
          Материалы, которыми преподаватели поделились за пределами своего предмета — они
          используются как дополнительный источник при генерации презентаций, тестов и в
          «Спроси документ» для предметов той же кафедры или всего учебного заведения.
          Поделиться материалом можно со страницы «Предметы» → «Материалы».
        </p>

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary">Загрузка…</div>
        ) : !data || data.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p className="font-sans text-sm text-ink-secondary">
              Пока никто не поделился материалом за пределами своего предмета.
            </p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs font-sans">
              <thead>
                <tr className="border-b border-border bg-surface-warm text-ink-tertiary text-left">
                  <th className="px-4 py-2.5 font-medium">Файл</th>
                  <th className="px-4 py-2.5 font-medium">Преподаватель</th>
                  <th className="px-4 py-2.5 font-medium">Предмет</th>
                  <th className="px-4 py-2.5 font-medium">Область</th>
                  <th className="px-4 py-2.5 font-medium">Происхождение</th>
                  <th className="px-4 py-2.5 font-medium text-right">Использований</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-4 py-3 text-ink">{doc.file_name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{doc.teacher_name ?? '—'}</td>
                    <td className="px-4 py-3 text-ink-secondary">{doc.course_name ?? '—'}</td>
                    <td className="px-4 py-3"><ScopeBadge scope={doc.visibility_scope} /></td>
                    <td className="px-4 py-3"><ProvenanceBadge provenance={doc.provenance} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{doc.reuse_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const SCOPE_LABEL: Record<DocumentVisibilityScope, string> = {
  course:      'Предмет',
  unit:        'Кафедра',
  institution: 'Учебное заведение',
  platform:    'Платформа',
}

function ScopeBadge({ scope }: { scope: DocumentVisibilityScope }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full bg-surface-warm border border-border text-[11px] text-ink-secondary">
      {SCOPE_LABEL[scope]}
    </span>
  )
}

const PROVENANCE_LABEL: Record<DocumentProvenance, string> = {
  own_work:          'Собственная разработка',
  open_licence:       'Открытая лицензия',
  institution_owned:  'Собственность учебного заведения',
  unknown:            'Происхождение не уточнено',
}

function ProvenanceBadge({ provenance }: { provenance: DocumentProvenance }) {
  return (
    <span className="text-[11px] text-ink-tertiary">{PROVENANCE_LABEL[provenance]}</span>
  )
}
