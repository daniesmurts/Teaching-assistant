import { body } from 'express-validator'

export const generateQuizRules = [
  body('topic')
    .trim()
    .notEmpty().withMessage('Тема обязательна')
    .isLength({ max: 200 }).withMessage('Тема слишком длинная')
    .escape(),

  body('question_count')
    .isInt({ min: 5, max: 20 }).withMessage('Количество вопросов: от 5 до 20'),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('level')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(['recall', 'understanding', 'application']).withMessage('Неверный уровень'),

  body('source_text')
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ max: 20000 }).withMessage('Конспект слишком длинный (макс. 20000 символов)'),
]
