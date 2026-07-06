export interface HelpVideo {
  slug:        string          // referenced by ?video= deep links and FeatureIntro videoSlug
  category:    string
  title:       string
  vkVideoUrl:  string | null   // vkvideo.ru/video-*_* link — null until recorded
  articleSlug?: string         // optional matching HelpArticle slug for "читать подробнее"
}

export const VIDEO_CATEGORIES = ['Старт', 'Проверка работ', 'Дополнительные инструменты', 'Для вузов'] as const

export const HELP_VIDEOS: HelpVideo[] = [
  // ─── Старт ──────────────────────────────────────────────────────────────────
  {
    slug: 'auth',
    category: 'Старт',
    title: 'Регистрация и вход (в т.ч. по приглашению вуза)',
    vkVideoUrl: 'https://vkvideo.ru/video-240080860_456239020',
  },
  {
    slug: 'first-steps',
    category: 'Старт',
    title: 'Первые шаги: чек-лист и создание первого предмета',
    vkVideoUrl: 'https://vkvideo.ru/video-240080860_456239019',
    articleSlug: 'getting-started',
  },

  // ─── Проверка работ ─────────────────────────────────────────────────────────
  {
    slug: 'grading',
    category: 'Проверка работ',
    title: 'Проверка работы по критериям',
    vkVideoUrl: 'https://vkvideo.ru/video-240080860_456239018',
    articleSlug: 'grading',
  },
  {
    slug: 'criteria',
    category: 'Проверка работ',
    title: 'Создание собственных критериев оценивания',
    vkVideoUrl: null,
    articleSlug: 'criteria',
  },
  {
    slug: 'stem-mode',
    category: 'Проверка работ',
    title: 'Режим STEM: проверка расчётных заданий',
    vkVideoUrl: null,
  },
  {
    slug: 'documents',
    category: 'Проверка работ',
    title: 'Загрузка документов: PDF, DOCX и фото с распознаванием',
    vkVideoUrl: null,
    articleSlug: 'documents',
  },
  {
    slug: 'vkr-review',
    category: 'Проверка работ',
    title: 'Проверка ВКР: анализ по главам и вопросы к защите',
    vkVideoUrl: null,
  },
  {
    slug: 'history',
    category: 'Проверка работ',
    title: 'Журнал: история проверок, фильтры и выгрузка в CSV',
    vkVideoUrl: null,
    articleSlug: 'history',
  },
  {
    slug: 'feedback-email',
    category: 'Проверка работ',
    title: 'Письмо студенту с обратной связью',
    vkVideoUrl: null,
  },

  // ─── Дополнительные инструменты ─────────────────────────────────────────────
  {
    slug: 'presentations',
    category: 'Дополнительные инструменты',
    title: 'Генератор презентаций к лекциям',
    vkVideoUrl: null,
    articleSlug: 'presentations',
  },
  {
    slug: 'students',
    category: 'Дополнительные инструменты',
    title: 'Студенты и группы: динамика оценок по каждому студенту',
    vkVideoUrl: null,
  },

  // ─── Для вузов ──────────────────────────────────────────────────────────────
  {
    slug: 'institution-teachers',
    category: 'Для вузов',
    title: 'Панель администратора вуза: приглашение преподавателей',
    vkVideoUrl: null,
  },
  {
    slug: 'institution-criteria',
    category: 'Для вузов',
    title: 'Общевузовские критерии оценивания',
    vkVideoUrl: null,
  },
  {
    slug: 'institution-usage',
    category: 'Для вузов',
    title: 'Статистика использования и выгрузка отчётов',
    vkVideoUrl: null,
  },
]

export function findVideo(slug: string): HelpVideo | undefined {
  return HELP_VIDEOS.find((v) => v.slug === slug)
}
