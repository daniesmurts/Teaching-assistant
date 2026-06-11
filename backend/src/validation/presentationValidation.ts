import { body } from 'express-validator'

export const generatePresentationRules = [
  body('topic')
    .trim()
    .notEmpty().withMessage('Тема лекции обязательна')
    .isLength({ max: 300 }).withMessage('Тема лекции слишком длинная'),

  body('duration_minutes')
    .isInt({ min: 10, max: 240 })
    .withMessage('Продолжительность: от 10 до 240 минут'),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('lecture_number')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1, max: 200 }).withMessage('Номер лекции: от 1 до 200'),

  body('slide_count_target')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 3, max: 40 }).withMessage('Количество слайдов: от 3 до 40'),

  body('learning_goals')
    .optional()
    .isArray({ max: 10 }).withMessage('Максимум 10 целей обучения'),

  body('learning_goals.*')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Цель обучения слишком длинная'),

  body('audience_level')
    .optional()
    .isIn(['undergraduate_1', 'undergraduate_2', 'postgraduate', 'professional', ''])
    .withMessage('Неверный уровень аудитории'),

  body('style')
    .optional()
    .isIn(['theory_heavy', 'case_study', 'discussion_based', ''])
    .withMessage('Неверный стиль подачи'),
]
