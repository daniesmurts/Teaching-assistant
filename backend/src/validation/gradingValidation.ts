import { body } from 'express-validator'
import { SINGLE_PASS_CHAR_LIMIT, MAX_REVIEW_CHARS } from '../../../shared/types'

export const gradeRules = [
  body('submission_text')
    .trim()
    .isLength({ min: 50 }).withMessage('Текст работы слишком короткий (минимум 50 символов)')
    .isLength({ max: SINGLE_PASS_CHAR_LIMIT })
      .withMessage('Работа слишком объёмная для обычной проверки. Загрузите её в режиме рецензирования больших работ.'),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  // Criteria selection — optional. Empty/absent → holistic grading (no rubric).
  body('criterion_ids')
    .optional({ nullable: true })
    .isArray({ max: 10 }).withMessage('Можно выбрать не более 10 критериев'),
  body('criterion_ids.*')
    .isUUID().withMessage('Неверный идентификатор критерия'),

  body('weights')
    .optional({ nullable: true })
    .isArray({ max: 10 }).withMessage('Слишком много весов'),
  body('weights.*')
    .isInt({ min: 0, max: 100 }).withMessage('Вес критерия: целое число 0–100'),

  // Cross-field: if criteria are picked, weights must match in length and sum to 100.
  body('criterion_ids').custom((ids: unknown, { req }) => {
    const idsArr = Array.isArray(ids) ? ids : []
    const weights = (req.body as { weights?: unknown }).weights
    const weightsArr = Array.isArray(weights) ? (weights as number[]) : []
    if (idsArr.length === 0) return true
    if (idsArr.length !== weightsArr.length) {
      throw new Error('Каждому критерию должен соответствовать вес')
    }
    const sum = weightsArr.reduce((s: number, w: number) => s + Number(w || 0), 0)
    if (sum !== 100) {
      throw new Error(`Сумма весов должна быть равна 100 (сейчас ${sum})`)
    }
    return true
  }),

  body('student_name')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Имя студента слишком длинное')
    .escape(),

  body('student_email')
    .optional({ nullable: true, checkFalsy: true })
    .isEmail().withMessage('Неверный адрес эл. почты студента')
    .normalizeEmail(),

  body('reference_solution')
    .optional()
    .isLength({ max: 50_000 }).withMessage('Эталонное решение слишком длинное'),

  body('assignment_context')
    .optional()
    .isLength({ max: 20_000 }).withMessage('Описание задания слишком длинное'),

  body('assignment_type')
    .optional()
    .isIn(['essay', 'calculation']).withMessage('Неверный тип задания'),

  body('parent_assignment_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предыдущей версии'),

  body('thorough')
    .optional()
    .isBoolean().withMessage('Неверное значение thorough'),
]

// Long-document review pipeline — accepts much larger submissions (chunked).
export const reviewRules = [
  body('submission_text')
    .trim()
    .isLength({ min: SINGLE_PASS_CHAR_LIMIT })
      .withMessage('Для режима рецензирования работа должна быть объёмной. Короткие работы проверяйте обычным способом.')
    .isLength({ max: MAX_REVIEW_CHARS })
      .withMessage('Работа слишком большая. Разделите её на части (максимум ~300 страниц).'),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('criterion_ids')
    .optional({ nullable: true })
    .isArray({ max: 10 }).withMessage('Можно выбрать не более 10 критериев'),
  body('criterion_ids.*')
    .isUUID().withMessage('Неверный идентификатор критерия'),

  body('weights')
    .optional({ nullable: true })
    .isArray({ max: 10 }).withMessage('Слишком много весов'),
  body('weights.*')
    .isInt({ min: 0, max: 100 }).withMessage('Вес критерия: целое число 0–100'),

  body('criterion_ids').custom((ids: unknown, { req }) => {
    const idsArr = Array.isArray(ids) ? ids : []
    const weights = (req.body as { weights?: unknown }).weights
    const weightsArr = Array.isArray(weights) ? (weights as number[]) : []
    if (idsArr.length === 0) return true
    if (idsArr.length !== weightsArr.length) {
      throw new Error('Каждому критерию должен соответствовать вес')
    }
    const sum = weightsArr.reduce((s: number, w: number) => s + Number(w || 0), 0)
    if (sum !== 100) {
      throw new Error(`Сумма весов должна быть равна 100 (сейчас ${sum})`)
    }
    return true
  }),

  body('student_name')
    .optional().trim()
    .isLength({ max: 200 }).withMessage('Имя студента слишком длинное')
    .escape(),

  body('student_email')
    .optional({ nullable: true, checkFalsy: true })
    .isEmail().withMessage('Неверный адрес эл. почты студента')
    .normalizeEmail(),
]

export const approveRules = [
  body('approved_score')
    .isInt({ min: 0, max: 100 }).withMessage('Оценка должна быть числом от 0 до 100'),

  body('approved_grade')
    .isIn(['5', '4', '3', '2']).withMessage('Неверная оценка (5, 4, 3 или 2)'),

  body('approved_feedback')
    .trim()
    .notEmpty().withMessage('Отзыв обязателен')
    .isLength({ max: 10_000 }).withMessage('Отзыв слишком длинный'),

  // Bullet lists are arrays of {text, quote?, page?} objects (see BulletItem).
  // We validate the array shape + size; per-item text length is bounded.
  body('approved_strengths').optional().isArray({ max: 20 })
    .withMessage('Слишком много пунктов сильных сторон'),
  body('approved_strengths.*.text').optional().isString()
    .isLength({ max: 500 }).withMessage('Пункт слишком длинный'),
  body('approved_strengths.*.quote').optional({ nullable: true }).isString()
    .isLength({ max: 500 }),
  body('approved_strengths.*.page').optional({ nullable: true }).isInt({ min: 1, max: 10_000 }),

  body('approved_improvements').optional().isArray({ max: 20 })
    .withMessage('Слишком много пунктов «что улучшить»'),
  body('approved_improvements.*.text').optional().isString()
    .isLength({ max: 500 }).withMessage('Пункт слишком длинный'),
  body('approved_improvements.*.quote').optional({ nullable: true }).isString()
    .isLength({ max: 500 }),
  body('approved_improvements.*.page').optional({ nullable: true }).isInt({ min: 1, max: 10_000 }),
  body('approved_improvements.*.question').optional({ nullable: true }).isString()
    .isLength({ max: 500 }),
  body('approved_strengths.*.criterion_id').optional({ nullable: true }).isUUID(),
  body('approved_improvements.*.criterion_id').optional({ nullable: true }).isUUID(),

  // Per-criterion approved scores. Same shape as ai_criteria_scores; the
  // citation fields are echo-through for consistency with the AI output.
  body('approved_criteria_scores').optional().isArray({ max: 20 }),
  body('approved_criteria_scores.*.name').optional().isString().isLength({ max: 200 }),
  body('approved_criteria_scores.*.score').optional().isInt({ min: 0, max: 100 }),
  body('approved_criteria_scores.*.feedback').optional().isString().isLength({ max: 2000 }),
  body('approved_criteria_scores.*.quote').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('approved_criteria_scores.*.page').optional({ nullable: true }).isInt({ min: 1, max: 10_000 }),

  body('approved_edit_reason').optional({ nullable: true })
    .isIn(['fact_check', 'tone', 'criterion_weight', 'scale', 'scope', 'other'])
    .withMessage('Неверная причина редактирования'),
]
