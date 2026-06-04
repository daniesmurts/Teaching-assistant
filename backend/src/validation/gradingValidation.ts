import { body } from 'express-validator'

export const gradeRules = [
  body('submission_text')
    .trim()
    .isLength({ min: 50 })    .withMessage('Текст работы слишком короткий (минимум 50 символов)')
    .isLength({ max: 50_000 }).withMessage('Текст работы слишком длинный (максимум 50 000 символов)'),

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

export const approveRules = [
  body('approved_score')
    .isInt({ min: 0, max: 100 }).withMessage('Оценка должна быть числом от 0 до 100'),

  body('approved_grade')
    .isIn(['A', 'B', 'C', 'D', 'F']).withMessage('Неверная буквенная оценка'),

  body('approved_feedback')
    .trim()
    .notEmpty().withMessage('Отзыв обязателен')
    .isLength({ max: 10_000 }).withMessage('Отзыв слишком длинный'),
]
