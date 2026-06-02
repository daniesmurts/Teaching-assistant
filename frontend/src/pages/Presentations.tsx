import TopBar from '../components/layout/TopBar'

export default function Presentations() {
  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Презентации" />
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div>
          <div className="font-display text-5xl text-ink-tertiary mb-3">▤</div>
          <p className="font-sans text-sm text-ink-secondary">
            Генератор презентаций — в фазе 4.
          </p>
        </div>
      </div>
    </div>
  )
}
