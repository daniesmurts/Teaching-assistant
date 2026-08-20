import { body } from 'express-validator'

// Academic-program (учебный план) request validation. Disciplines/competencies
// are bulk-replaced, so the array shapes are validated here; deeper per-item
// normalisation happens in the queries layer.

export const createProgramRules = [
  body('name').isString().trim().isLength({ min: 2, max: 300 }).withMessage('Укажите название программы'),
  body('code').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body('level').optional({ nullable: true }).isIn(['bachelor', 'master', 'specialist']).withMessage('Некорректный уровень'),
  body('duration_semesters').optional().isInt({ min: 1, max: 16 }).withMessage('Семестров: от 1 до 16'),
  body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('org_unit_id').optional({ nullable: true }).isUUID().withMessage('Некорректный идентификатор подразделения'),
]

export const updateProgramRules = [
  body('name').optional().isString().trim().isLength({ min: 2, max: 300 }),
  body('code').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body('level').optional({ nullable: true }).isIn(['bachelor', 'master', 'specialist']),
  body('duration_semesters').optional().isInt({ min: 1, max: 16 }),
  body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('org_unit_id').optional({ nullable: true }).isUUID().withMessage('Некорректный идентификатор подразделения'),
  // Official ФГОС header fields (intake form) — a mistyped code or misspelt
  // specialty name at intake had no way to be corrected afterwards, which
  // then silently broke sveden-page discipline matching (matchDiscipline)
  // and the ФГОС-code lookups keyed on `code`. Same length caps as the
  // create-time form; no create-time validation existed to mirror exactly.
  body('specialty_name').optional({ nullable: true }).isString().trim().isLength({ max: 300 }),
  body('education_level').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('profile').optional({ nullable: true }).isString().trim().isLength({ max: 300 }),
  body('forms_of_study').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
]

export const replaceDisciplinesRules = [
  body('disciplines').isArray({ max: 80 }).withMessage('Слишком много дисциплин'),
  // Present for existing disciplines (the client round-trips it) — required so
  // replaceDisciplines can UPDATE in place instead of delete+reinsert, which
  // would regenerate the id and cascade-delete any uploaded РПД for it.
  body('disciplines.*.id').optional({ nullable: true }).isUUID(),
  body('disciplines.*.name').isString().trim().isLength({ min: 1, max: 300 }),
  body('disciplines.*.semester').isInt({ min: 1, max: 16 }),
  body('disciplines.*.course_id').optional({ nullable: true }).isUUID(),
  body('disciplines.*.credits').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body('disciplines.*.control_form').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('disciplines.*.competency_codes').optional().isArray({ max: 30 }),
  body('disciplines.*.sort_order').optional().isInt({ min: 0 }),
]

export const replaceCompetenciesRules = [
  body('competencies').isArray({ max: 60 }).withMessage('Слишком много компетенций'),
  body('competencies.*.kind').isIn(['goal', 'competency']),
  body('competencies.*.title').isString().trim().isLength({ min: 1, max: 600 }),
  body('competencies.*.code').optional({ nullable: true }).isString().trim().isLength({ max: 30 }),
  body('competencies.*.sort_order').optional().isInt({ min: 0 }),
  body('competencies.*.profstandard_otf_id').optional({ nullable: true }).isUUID(),
  body('competencies.*.indicators').optional().isArray({ max: 20 }).withMessage('Слишком много индикаторов'),
  body('competencies.*.indicators.*.code').optional().isString().trim().isLength({ min: 1, max: 30 }),
  body('competencies.*.indicators.*.title').optional().isString().trim().isLength({ min: 1, max: 600 }),
  body('competencies.*.indicators.*.sort_order').optional().isInt({ min: 0 }),
]
