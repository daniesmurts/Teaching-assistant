import { body, param, query } from 'express-validator'

export const createFosRules = [
  body('course_id').isUUID().withMessage('Неверный идентификатор предмета'),

  body('topics')
    .optional({ nullable: true })
    .isArray({ max: 40 }).withMessage('Слишком много тем'),
  body('topics.*').optional().isString().trim().isLength({ max: 200 }).escape(),

  body('competencies')
    .optional({ nullable: true })
    .isArray({ max: 40 }).withMessage('Слишком много компетенций'),
  body('competencies.*').optional().isString().trim().isLength({ max: 50 }).escape(),

  body('ticket_count')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 10, max: 30 }).withMessage('Количество билетов: от 10 до 30'),
]

export const listFosRules = [
  query('course_id').isUUID().withMessage('Неверный идентификатор предмета'),
]

export const fosIdRules = [
  param('id').isUUID().withMessage('Неверный идентификатор ФОС'),
]

export const updateFosRules = [
  param('id').isUUID().withMessage('Неверный идентификатор ФОС'),
  body('sections').isObject().withMessage('Некорректные данные ФОС'),
]
