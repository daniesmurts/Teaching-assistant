import Icon from '../ui/Icon'

// Data-driven partner registry for the /research page. Add a new university or
// publication by appending to PARTNERS — no layout changes needed. A partner
// with `confirmed: false` is kept out of the public list until its agreement
// is signed (see the note on the КНИТУ entry below).

export interface ResearchPublication {
  title: string
  url?: string
}

export interface ResearchPartner {
  id: string
  name: string
  fullName: string
  role: string
  confirmed: boolean
  blurb: string
  publications?: ResearchPublication[]
}

export const PARTNERS: ResearchPartner[] = [
  {
    id: 'knitu',
    name: 'КНИТУ',
    fullName: 'Казанский национальный исследовательский технологический университет',
    role: 'Партнёр-основатель',
    // Соглашение о сотрудничестве обсуждается, но формально ещё не подписано.
    // Не показываем публично, пока стороны не подтвердят партнёрство.
    confirmed: false,
    blurb:
      'Первый вуз-партнёр программы: пилот с учебно-методическим центром КНИТУ охватывает руководителей образовательных программ.',
    publications: [],
  },
]

export default function ResearchPartners() {
  const confirmed = PARTNERS.filter((p) => p.confirmed)

  return (
    <section className="py-24 border-t border-border">
      <div className="max-w-[1000px] mx-auto px-6">
        <h2 className="font-display text-3xl font-bold text-center mb-4 text-[#101B33]">Партнёры программы</h2>
        <p className="text-ink-secondary text-center mb-14 max-w-[600px] mx-auto">
          Вузы и кафедры, которые участвуют в исследовании вместе с нами — с совместными данными, отчётами и публикациями.
        </p>

        {confirmed.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-6">
            {confirmed.map((partner) => (
              <PartnerCard key={partner.id} partner={partner} />
            ))}
          </div>
        ) : (
          <div className="bg-surface border border-dashed border-border-mid rounded-xl p-8 text-center max-w-[560px] mx-auto">
            <div className="w-10 h-10 rounded-full bg-amber-light flex items-center justify-center text-amber mx-auto mb-4">
              <Icon name="building" size={18} />
            </div>
            <div className="text-xs font-bold text-amber uppercase tracking-wider mb-3">Программа открыта</div>
            <p className="text-ink-secondary leading-relaxed">
              Список партнёров пока пуст — программа только начинается. Если ваша кафедра готова стать первой,
              напишите нам: заявку рассматриваем в приоритетном порядке.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function PartnerCard({ partner }: { partner: ResearchPartner }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-6 transition-shadow hover:shadow-md">
      <div className="text-xs font-bold text-amber uppercase tracking-wider mb-2">{partner.role}</div>
      <h3 className="font-display text-xl font-bold mb-1">{partner.name}</h3>
      <div className="text-sm text-ink-tertiary mb-4">{partner.fullName}</div>
      <p className="text-sm text-ink-secondary leading-relaxed">{partner.blurb}</p>
      {partner.publications && partner.publications.length > 0 && (
        <div className="mt-5 pt-5 border-t border-border">
          <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide mb-2">Публикации</div>
          <ul className="space-y-1.5">
            {partner.publications.map((pub) => (
              <li key={pub.title} className="text-sm">
                {pub.url ? (
                  <a href={pub.url} target="_blank" rel="noreferrer" className="text-amber hover:underline">
                    {pub.title}
                  </a>
                ) : (
                  <span className="text-ink-secondary">{pub.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
