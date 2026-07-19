import { body, param } from 'express-validator'

export const createLiveSessionRules = [
  body('quiz_id').isUUID().withMessage('Неверный идентификатор теста'),
  body('mode').optional({ nullable: true }).isIn(['paced', 'self_paced']).withMessage('Неверный режим сессии'),
]

export const liveSessionIdRules = [
  param('id').isUUID().withMessage('Неверный идентификатор сессии'),
]

export const joinSessionRules = [
  param('code').isLength({ min: 6, max: 6 }).withMessage('Неверный код'),
  // Required — results are only meaningful to a teacher if they can tell
  // participants apart; an all-anonymous roster makes the score/reveal
  // screens useless for anything but a headcount.
  body('nickname').isString().trim().isLength({ min: 1, max: 40 }).withMessage('Введите имя').escape(),
]

export const joinCodeRules = [
  param('code').isLength({ min: 6, max: 6 }).withMessage('Неверный код'),
]

export const answerRules = [
  param('code').isLength({ min: 6, max: 6 }).withMessage('Неверный код'),
  body('participant_token').isString().isLength({ min: 10, max: 100 }),
  body('choice_index').isInt({ min: 0, max: 3 }).withMessage('Неверный вариант ответа'),
]

export const advanceRules = [
  param('code').isLength({ min: 6, max: 6 }).withMessage('Неверный код'),
  body('participant_token').isString().isLength({ min: 10, max: 100 }),
]

export const saveToJournalRules = [
  param('id').isUUID().withMessage('Неверный идентификатор сессии'),
  body('course_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Неверный идентификатор предмета'),
  body('entries').isArray({ min: 1 }).withMessage('Не выбрано ни одного участника'),
  body('entries.*.participant_id').isUUID().withMessage('Неверный идентификатор участника'),
  body('entries.*.student_name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Укажите имя студента').escape(),
  body('entries.*.student_group').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 50 }).escape(),
]
