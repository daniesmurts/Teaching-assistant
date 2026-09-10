import { body } from 'express-validator'

export const satisfactionCheckRules = [
  body('feature').isIn(['grading']).withMessage('Неизвестная функция'),
  body('artifactId').optional({ nullable: true }).isUUID().withMessage('Неверный идентификатор'),
]

export const satisfactionAnswerRules = [
  // 1 = плохо, 2 = нормально, 3 = хорошо.
  body('score').isInt({ min: 1, max: 3 }).withMessage('Неверная оценка'),
  body('comment').optional({ nullable: true }).trim().isLength({ max: 2000 }),
]

export const satisfactionCommentRules = [
  body('comment')
    .trim()
    .isLength({ min: 2 }).withMessage('Слишком короткий комментарий')
    .isLength({ max: 2000 }).withMessage('Слишком длинный комментарий (максимум 2000 символов)'),
]
