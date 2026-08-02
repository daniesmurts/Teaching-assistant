import { body } from 'express-validator'

export const contactMessageRules = [
  body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Укажите имя'),
  body('email').trim().isEmail().withMessage('Некорректный email').normalizeEmail(),
  body('organization').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body('topic').optional().isIn(['support', 'demo', 'research', 'billing']).withMessage('Неверная тема обращения'),
  body('message').trim()
    .isLength({ min: 3 }).withMessage('Сообщение слишком короткое')
    .isLength({ max: 5000 }).withMessage('Сообщение слишком длинное (максимум 5000 символов)'),
  body('sourcePage').isIn(['contact', 'research', 'priority2030']).withMessage('Неверный источник обращения'),
]
