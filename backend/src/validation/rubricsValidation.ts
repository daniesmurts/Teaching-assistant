import { body } from 'express-validator'

const SUBJECTS = ['business', 'economics', 'law', 'medicine', 'engineering', 'humanities', 'general']

// Shared item rules — used by both create and update. Each item is
// {criterion_id: UUID, weight: int 1–100}. The 0–100-sum check is applied in
// the route handler, not here, so we can return a friendlier message.
const itemRules = [
  body('items')
    .isArray({ min: 1, max: 20 })
    .withMessage('Рубрика должна содержать от 1 до 20 критериев'),
  body('items.*.criterion_id')
    .isUUID().withMessage('Неверный идентификатор критерия'),
  body('items.*.weight')
    .isInt({ min: 1, max: 100 }).withMessage('Вес критерия — целое число от 1 до 100'),
]

export const createRubricRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Название рубрики обязательно')
    .isLength({ max: 100 }).withMessage('Название рубрики слишком длинное')
    .escape(),

  body('description')
    .optional({ nullable: true, checkFalsy: false })
    .trim()
    .isLength({ max: 500 }).withMessage('Описание рубрики слишком длинное')
    .escape(),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('subject')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(SUBJECTS).withMessage('Неверная предметная область'),

  ...itemRules,
]

export const updateRubricRules = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Название рубрики: от 1 до 100 символов')
    .escape(),

  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 }).withMessage('Описание рубрики слишком длинное')
    .escape(),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('subject')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(SUBJECTS).withMessage('Неверная предметная область'),

  // Items optional on update (e.g. rename only). When present, must validate.
  body('items')
    .optional()
    .isArray({ min: 1, max: 20 })
    .withMessage('Рубрика должна содержать от 1 до 20 критериев'),
  body('items.*.criterion_id')
    .optional()
    .isUUID().withMessage('Неверный идентификатор критерия'),
  body('items.*.weight')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Вес критерия — целое число от 1 до 100'),
]
