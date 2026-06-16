import { body } from 'express-validator'

export const analyzeOverlapRules = [
  body('course_ids')
    .isArray({ min: 2, max: 12 }).withMessage('Выберите от 2 до 12 дисциплин'),
  body('course_ids.*')
    .isUUID().withMessage('Некорректный идентификатор дисциплины'),
]
