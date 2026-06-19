import { body } from 'express-validator'

export const generateTasksRules = [
  body('kind')
    .isIn(['assignment', 'case', 'project']).withMessage('Укажите тип материала'),
  body('topic')
    .trim()
    .isLength({ min: 3, max: 300 }).withMessage('Укажите тему (3–300 символов)'),
  body('difficulty')
    .isIn(['basic', 'intermediate', 'advanced']).withMessage('Укажите уровень сложности'),
  body('course_id').optional({ nullable: true, checkFalsy: true }).isUUID(),
  body('count').optional().isInt({ min: 1, max: 10 }),
]
