import { useUIStore } from '../../store/uiStore'

const PRO_FEATURES = [
  'Неограниченная проверка работ',
  'Неограниченные презентации',
  'ИИ улучшается с каждой проверкой',
  'Загрузка документов (PDF, Word, изображения)',
  'Генерация писем с обратной связью',
  'Полная история проверок',
]

export default function UpgradeModal() {
  const { upgradeModalOpen, hideUpgradeModal } = useUIStore()

  if (!upgradeModalOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={hideUpgradeModal}
      />

      {/* Modal */}
      <div className="relative bg-surface rounded-xl border border-border shadow-lg max-w-sm w-full p-6 animate-[resultAppear_250ms_ease_forwards]">
        {/* Close */}
        <button
          onClick={hideUpgradeModal}
          className="absolute top-4 right-4 text-ink-tertiary hover:text-ink transition-colors text-lg leading-none"
        >
          ×
        </button>

        <h2 className="font-display text-xl font-bold text-ink mb-1">
          Перейти на Pro
        </h2>
        <p className="font-sans text-sm text-ink-secondary mb-5">
          Снимите ограничения и получите полный доступ к GradeAssist.
        </p>

        {/* Feature list */}
        <ul className="space-y-2 mb-6">
          {PRO_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm font-sans text-ink">
              <span className="text-success mt-0.5 flex-shrink-0 text-base leading-none">✓</span>
              {f}
            </li>
          ))}
        </ul>

        {/* Pricing options */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button className="flex flex-col items-center px-3 py-3 rounded-lg border border-border hover:border-amber/40 transition-colors text-center">
            <span className="font-display text-lg font-bold text-ink">₽990</span>
            <span className="text-xs font-sans text-ink-secondary mt-0.5">в месяц</span>
          </button>
          <button className="flex flex-col items-center px-3 py-3 rounded-lg border-2 border-amber bg-amber-light text-center">
            <span className="font-display text-lg font-bold text-amber">₽7 900</span>
            <span className="text-xs font-sans text-amber mt-0.5">в год · −33%</span>
          </button>
        </div>

        <button
          onClick={hideUpgradeModal}
          className="w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Перейти к оплате
        </button>

        <p className="text-center text-xs font-sans text-ink-tertiary mt-3">
          Оплата картой или через СБП · Отмена в любое время
        </p>
      </div>
    </div>
  )
}
