export interface LegalDoc {
  path: string
  title: string
  shortTitle: string
  description: string
}

// Single source of truth for the legal-docs section (sidebar nav + hub
// listing). "Условия оплаты и возврата" lives inside the Offer page as a
// section rather than its own route — it deep-links via the hash.
export const LEGAL_DOCS: LegalDoc[] = [
  {
    path: '/terms',
    title: 'Пользовательское соглашение',
    shortTitle: 'Пользовательское соглашение',
    description: 'Условия использования Сервиса: регистрация, тарифы, ответственность сторон.',
  },
  {
    path: '/acceptable-use',
    title: 'Политика допустимого использования',
    shortTitle: 'Допустимое использование',
    description: 'Что можно и нельзя делать в Сервисе, запрещённые действия, использование результатов ИИ.',
  },
  {
    path: '/offer',
    title: 'Публичная оферта',
    shortTitle: 'Публичная оферта',
    description: 'Официальное предложение заключить договор на оказание услуг ИСПУМ, включая условия оплаты.',
  },
  {
    path: '/offer#payment',
    title: 'Условия оплаты и возврата',
    shortTitle: 'Оплата и возврат',
    description: 'Порядок оплаты подписки, продления и возврата средств.',
  },
  {
    path: '/privacy',
    title: 'Политика конфиденциальности',
    shortTitle: 'Конфиденциальность',
    description: 'Как мы собираем, храним и обрабатываем персональные данные пользователей и студентов.',
  },
  {
    path: '/cookies',
    title: 'Политика использования Cookie',
    shortTitle: 'Cookie',
    description: 'Какие файлы cookie и локальные хранилища использует Сервис и как ими управлять.',
  },
  {
    path: '/ethics',
    title: 'Этическая политика ИИ',
    shortTitle: 'Этика ИИ',
    description: 'Принципы применения искусственного интеллекта: человек всегда принимает итоговое решение.',
  },
]
