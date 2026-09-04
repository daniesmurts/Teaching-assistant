import { useQuery, useQueryClient } from '@tanstack/react-query'
import DocumentUpload, { SharePrompt } from '../ui/DocumentUpload'
import { listDocuments, deleteDocument, type ProcessingStatus } from '../../api/documents'
import { useUIStore } from '../../store/uiStore'

// Feature AN (TODO.md "### AN") — the actual "материалы" upload surface the
// кафедральная библиотека feature assumes exists. Separate from the
// syllabus slot above it in Courses.tsx: a course can have many materials
// (methodichka, reading lists, чертежи), not just one programme document.

const STATUS_LABEL: Record<ProcessingStatus, string> = {
  pending:    'Загрузка…',
  extracting: 'Обработка…',
  chunking:   'Индексация…',
  ready:      'Готов',
  failed:     'Ошибка',
}

export default function CourseMaterials({ courseId }: { courseId: string }) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const queryKey = ['course-materials', courseId]
  const { data: materials = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listDocuments(courseId, 'material'),
  })

  async function handleDelete(id: string, fileName: string) {
    if (!confirm(`Удалить материал «${fileName}»?`)) return
    try {
      await deleteDocument(id)
      qc.invalidateQueries({ queryKey })
    } catch {
      addToast('Не удалось удалить материал', 'error')
    }
  }

  return (
    <div>
      <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
        Материалы предмета (методички, чертежи, конспекты — PDF / Word)
      </label>

      {!isLoading && materials.length > 0 && (
        <div className="mb-2 border border-border rounded-md divide-y divide-border overflow-hidden">
          {materials.map((m) => (
            <div key={m.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-xs font-sans text-ink">{m.fileName}</span>
                <span className="text-[10px] font-sans text-ink-tertiary flex-shrink-0">{STATUS_LABEL[m.status]}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(m.id, m.fileName)}
                  className="text-[11px] font-sans text-danger hover:underline flex-shrink-0"
                >
                  Удалить
                </button>
              </div>
              {m.status === 'ready' && <SharePrompt doc={m} />}
            </div>
          ))}
        </div>
      )}

      {/* Remounts after every successful upload (list length changes) so the
          dropzone resets to idle instead of staying stuck on "готово" —
          DocumentUpload has no controlled reset of its own. */}
      <DocumentUpload
        key={materials.length}
        documentType="material"
        courseId={courseId}
        hint="Будет проиндексировано для подготовки лекций и тестов"
        onReady={() => qc.invalidateQueries({ queryKey })}
      />
    </div>
  )
}
