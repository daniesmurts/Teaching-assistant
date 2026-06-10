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
    .isUUID().withMessage('Неверный идентификатор курса'),

  body('rubric_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор рубрики'),

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

  body('assignment_type')
    .optional()
    .isIn(['essay', 'calculation']).withMessage('Неверный тип задания'),
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
    .isUUID().withMessage('Неверный идентификатор курса'),

  body('rubric_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор рубрики'),

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
]
