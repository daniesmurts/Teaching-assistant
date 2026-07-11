import { body } from 'express-validator'

const SOURCE_TYPES = ['grading_bullet', 'grading_criterion', 'grading_question', 'syllabus_coverage']

export const challengeRules = [
  body('source_type')
    .isIn(SOURCE_TYPES).withMessage('Неверный тип оспариваемого элемента'),
  body('assignment_id')
    .optional({ nullable: true })
    .isUUID().withMessage('Неверный идентификатор работы'),
  body('item_ref')
    .optional({ nullable: true })
    .isLength({ max: 200 }),
  body('claim_text')
    .trim()
    .isLength({ min: 3, max: 2000 }).withMessage('Текст утверждения некорректен'),
  body('claim_quote')
    .optional({ nullable: true })
    .isLength({ max: 500 }),
  body('source_text')
    .trim()
    .isLength({ min: 20, max: 200_000 }).withMessage('Исходный текст слишком короткий или отсутствует'),
  body('objection')
    .trim()
    .isLength({ min: 3, max: 1200 }).withMessage('Опишите, в чём проблема (3–1200 символов)'),
]
