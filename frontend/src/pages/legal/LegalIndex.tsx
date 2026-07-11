import { Link } from 'react-router-dom'
import LegalLayout from '../../components/layout/LegalLayout'
import { LEGAL_DOCS } from './legalDocs'

export default function LegalIndex() {
  return (
    <LegalLayout title="Правовые документы">
      <p>
        Здесь собраны все документы, регулирующие использование сервиса ИСПУМ: пользовательское соглашение,
        публичная оферта, условия оплаты, политика конфиденциальности, cookie и этическая политика ИИ.
      </p>

      <ul>
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.path}>
            <Link
              to={doc.path}
              className="flex items-center justify-between gap-4 py-4 border-b border-border group"
            >
              <div>
                <div className="text-ink font-medium group-hover:text-amber transition-colors">{doc.title}</div>
                <div className="text-sm text-ink-tertiary mt-0.5">{doc.description}</div>
              </div>
              <span className="shrink-0 text-ink-tertiary group-hover:text-amber group-hover:translate-x-0.5 transition-all">→</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-sm text-ink-tertiary">
        Заметили ошибку или неточность в документах? Напишите нам:{' '}
        <a href="mailto:daniel@boadtech.com" className="underline hover:text-ink">daniel@boadtech.com</a>.
      </p>
    </LegalLayout>
  )
}
