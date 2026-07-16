import { body, param } from 'express-validator'

export const createLiveSessionRules = [
  body('quiz_id').isUUID().withMessage('Неверный идентификатор теста'),
]

export const liveSessionIdRules = [
  param('id').isUUID().withMessage('Неверный идентификатор сессии'),
]

export const joinSessionRules = [
  param('code').isLength({ min: 6, max: 6 }).withMessage('Неверный код'),
  body('nickname').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 40 }).escape(),
]

export const joinCodeRules = [
  param('code').isLength({ min: 6, max: 6 }).withMessage('Неверный код'),
]

export const answerRules = [
  param('code').isLength({ min: 6, max: 6 }).withMessage('Неверный код'),
  body('participant_token').isString().isLength({ min: 10, max: 100 }),
  body('choice_index').isInt({ min: 0, max: 3 }).withMessage('Неверный вариант ответа'),
]
