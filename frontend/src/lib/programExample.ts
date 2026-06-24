import type { ProgramDiscipline, ProgramCompetency } from '../types'

// A realistic bachelor track (09.03.01 «Информатика и вычислительная техника»)
// used by the «Загрузить пример» button so a demo never depends on prior data
// entry. Deliberately seeded with findings the analysis should surface:
//   • an inversion — «Машинное обучение» (сем. 3) depends on «Теория вероятностей
//     и математическая статистика» (сем. 5), i.e. it is taught before its basis;
//   • an uncovered competency — ПК-4 (эксплуатация ИС) has no delivering discipline;
//   • an orphan — «Физическая культура» serves no program competency.

export interface ProgramExample {
  program: { name: string; code: string; level: string; duration_semesters: number; description: string }
  disciplines: ProgramDiscipline[]
  competencies: ProgramCompetency[]
}

const d = (
  name: string, semester: number, credits: number, competency_codes: string[], sort_order: number
): ProgramDiscipline => ({ course_id: null, name, semester, credits, control_form: null, competency_codes, sort_order })

const c = (kind: 'goal' | 'competency', code: string | null, title: string, sort_order: number): ProgramCompetency =>
  ({ kind, code, title, sort_order })

export const EXAMPLE_PROGRAM: ProgramExample = {
  program: {
    name: 'Информатика и вычислительная техника',
    code: '09.03.01',
    level: 'bachelor',
    duration_semesters: 8,
    description: 'Бакалавриат, профиль «Программная инженерия». Пример учебного плана для демонстрации анализа архитектуры.',
  },
  disciplines: [
    // Семестр 1 — фундамент
    d('Введение в программирование', 1, 6, ['ОПК-1'], 0),
    d('Математический анализ', 1, 5, ['УК-1'], 1),
    d('Дискретная математика', 1, 4, ['УК-1', 'ОПК-1'], 2),
    d('Физическая культура', 1, 2, [], 3),                       // orphan candidate
    // Семестр 2
    d('Объектно-ориентированное программирование', 2, 6, ['ОПК-1', 'ПК-1'], 0),
    d('Структуры данных и алгоритмы', 2, 5, ['ОПК-1', 'ПК-1'], 1),
    d('Линейная алгебра', 2, 4, ['УК-1'], 2),
    // Семестр 3
    d('Машинное обучение', 3, 5, ['ПК-2'], 0),                   // inversion: depends on сем. 5
    d('Базы данных', 3, 5, ['ОПК-2', 'ПК-1'], 1),
    d('Операционные системы', 3, 4, ['ОПК-2'], 2),
    // Семестр 4
    d('Веб-разработка', 4, 5, ['ПК-1', 'ПК-3'], 0),
    d('Компьютерные сети', 4, 4, ['ОПК-2'], 1),
    // Семестр 5
    d('Теория вероятностей и математическая статистика', 5, 5, ['УК-1', 'ПК-2'], 0),
    d('Проектирование информационных систем', 5, 5, ['ПК-3'], 1),
    // Семестр 6
    d('Разработка мобильных приложений', 6, 5, ['ПК-1', 'ПК-3'], 0),
    d('Технологии больших данных', 6, 4, ['ПК-2'], 1),
    // Семестр 7
    d('Информационная безопасность', 7, 4, ['ОПК-2'], 0),
    d('Управление IT-проектами', 7, 4, ['УК-2'], 1),
    // Семестр 8
    d('Преддипломная практика', 8, 6, ['ПК-3'], 0),
  ],
  competencies: [
    c('goal', null, 'Подготовить выпускника к проектированию и разработке программного обеспечения и информационных систем', 0),
    c('competency', 'УК-1', 'Способен осуществлять поиск, критический анализ и синтез информации', 1),
    c('competency', 'УК-2', 'Способен управлять проектом на всех этапах жизненного цикла', 2),
    c('competency', 'ОПК-1', 'Способен применять основы математики и программирования при решении задач', 3),
    c('competency', 'ОПК-2', 'Способен использовать современные ИКТ и системное ПО', 4),
    c('competency', 'ПК-1', 'Способен разрабатывать программные компоненты и приложения', 5),
    c('competency', 'ПК-2', 'Способен применять методы анализа данных и машинного обучения', 6),
    c('competency', 'ПК-3', 'Способен проектировать архитектуру информационных систем', 7),
    c('competency', 'ПК-4', 'Способен обеспечивать эксплуатацию и сопровождение информационных систем', 8), // uncovered
  ],
}
