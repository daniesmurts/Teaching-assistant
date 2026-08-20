import { body, param } from 'express-validator'
import { ALL_CHECK_KEYS } from '../services/methodist/checks'

export const createMethodistRunRules = [
  body('program_id').isUUID().withMessage('Некорректная программа'),
  body('discipline_id').isUUID().withMessage('Некорректная дисциплина'),
  body('checks')
    .isArray({ min: 1, max: ALL_CHECK_KEYS.length }).withMessage('Выберите хотя бы одну проверку'),
  body('checks.*')
    .isIn(ALL_CHECK_KEYS).withMessage('Неизвестная проверка'),
]

export const methodistRunIdRules = [
  param('id').isUUID().withMessage('Некорректный идентификатор проверки'),
]
