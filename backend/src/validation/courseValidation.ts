import { body } from 'express-validator'

const VALID_LEVELS = [
  'undergraduate_1', 'undergraduate_2', 'postgraduate', 'professional',
]

export const createCourseRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Название предмета обязательно')
    .isLength({ max: 200 }).withMessage('Название предмета слишком длинное')
    .escape(),

  body('code')
    .optional()
    .trim()
    .isLength({ max: 20 }).withMessage('Код предмета слишком длинный')
    .escape(),

  body('level')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(VALID_LEVELS).withMessage('Неверный уровень предмета'),

  body('syllabus_text')
    .optional()
    .trim()
    .isLength({ max: 200_000 }).withMessage('Текст программы слишком длинный'),
]

export const updateCourseRules = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 }).withMessage('Название предмета: от 1 до 200 символов')
    .escape(),

  body('code')
    .optional()
    .trim()
    .isLength({ max: 20 }).withMessage('Код предмета слишком длинный')
    .escape(),

  body('level')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(VALID_LEVELS).withMessage('Неверный уровень предмета'),

  body('syllabus_text')
    .optional()
    .trim()
    .isLength({ max: 200_000 }).withMessage('Текст программы слишком длинный'),
]
