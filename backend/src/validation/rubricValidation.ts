import { body } from 'express-validator'

export const createRubricRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Название рубрики обязательно')
    .isLength({ max: 200 }).withMessage('Название рубрики слишком длинное')
    .escape(),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор курса'),

  body('criteria')
    .isArray({ min: 1 }).withMessage('Рубрика должна содержать хотя бы один критерий')
    .isArray({ max: 20 }).withMessage('Максимум 20 критериев'),

  body('criteria.*.name')
    .trim()
    .notEmpty().withMessage('Название критерия обязательно')
    .isLength({ max: 100 }).withMessage('Название критерия слишком длинное')
    .escape(),

  body('criteria.*.weight')
    .isFloat({ min: 0, max: 100 }).withMessage('Вес критерия: от 0 до 100'),

  body('criteria.*.max_score')
    .isFloat({ min: 1, max: 100 }).withMessage('Максимальный балл: от 1 до 100'),
]

export const updateRubricRules = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 }).withMessage('Название рубрики: от 1 до 200 символов')
    .escape(),

  body('criteria')
    .optional()
    .isArray({ min: 1, max: 20 }).withMessage('Рубрика должна содержать от 1 до 20 критериев'),
]
