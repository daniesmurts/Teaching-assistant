// Russian names for the artefact kinds produced by the backend's
// ARTIFACT_SOURCES (db/queries/artifactUsage.ts). Shared by the admin
// «Артефакты» and «Функции» views so one feature never appears under two
// different names on two pages.
export const ARTIFACT_LABEL: Record<string, string> = {
  grading:                 'Проверенные работы',
  long_review:             'Длинные работы (ВКР)',
  presentation:            'Презентации',
  quiz:                    'Тесты',
  task_set:                'Задания',
  topic_set:               'Темы работ',
  published_assignment:    'Опубликованные задания',
  live_session:            'Интерактивные сессии',
  course:                  'Курсы',
  document:                'Загруженные материалы',
  rubric:                  'Рубрики',
  criterion:               'Критерии',
  brs_scheme:              'Схемы БРС',
  fos_document:            'ФОС',
  feedback_challenge:      'Оспаривание оценки',
  methodist_run:           'Кабинет методиста',
  syllabus_draft:          'Черновики РПД (Студия)',
  program_document:        'Документы программ',
  rpd_submission:          'Сдача РПД',
  program_analysis:        'Анализ программ',
  program_document_review: 'Экспертиза РПД',
  program_mto_review:      'Проверка МТО',
  program_placement_review:'Проверка практик',
  cohort_synthesis:        'Сводка по группе',
  policy_memo:             'Памятки по курсу',
  // Reports rendered from live data — no artefact table behind them, so they
  // only ever show выгрузки.
  rpd_monitor:             'Мониторинг РПД (отчёт)',
  rpd_reminder:            'Напоминания по РПД',
  umc_dashboard:           'Готовность УМК (отчёт)',
  institution_usage:       'Выгрузка использования',
}
