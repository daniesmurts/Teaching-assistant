import { body } from 'express-validator'

const SUBJECTS = ['business', 'economics', 'law', 'medicine', 'engineering', 'humanities', 'general']

export const createCriterionRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Название критерия обязательно')
    .isLength({ max: 100 }).withMessage('Название критерия слишком длинное')
    .escape(),

  body('description')
    .optional({ nullable: true, checkFalsy: false })
    .trim()
    .isLength({ max: 500 }).withMessage('Описание критерия слишком длинное')
    .escape(),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('subject')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(SUBJECTS).withMessage('Неверная предметная область'),
]

export const improveDescriptionRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Название критерия обязательно')
    .isLength({ max: 100 }).withMessage('Название критерия слишком длинное')
    .escape(),

  body('description')
    .trim()
    .notEmpty().withMessage('Описание критерия обязательно')
    .isLength({ max: 500 }).withMessage('Описание критерия слишком длинное')
    .escape(),
]

export const updateCriterionRules = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Название критерия: от 1 до 100 символов')
    .escape(),

  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 }).withMessage('Описание критерия слишком длинное')
    .escape(),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('subject')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(SUBJECTS).withMessage('Неверная предметная область'),
]
