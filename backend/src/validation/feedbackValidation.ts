import { body } from 'express-validator'

export const feedbackRules = [
  body('message')
    .trim()
    .isLength({ min: 3 }).withMessage('Сообщение слишком короткое')
    .isLength({ max: 5000 }).withMessage('Сообщение слишком длинное (максимум 5000 символов)'),
  body('category')
    .optional()
    .isIn(['bug', 'idea', 'question', 'other', 'help_up', 'help_down', 'help_search']).withMessage('Неверная категория'),
  body('page')
    .optional()
    .isLength({ max: 200 }),
]
