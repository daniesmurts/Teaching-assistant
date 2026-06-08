import { body } from 'express-validator'

export const inviteRules = [
  body('email')
    .isEmail().withMessage('Укажите корректный адрес эл. почты')
    .normalizeEmail()
    .isLength({ max: 255 }),
]

export const bulkInviteRules = [
  body('emails')
    .isArray({ min: 1, max: 200 }).withMessage('Укажите от 1 до 200 адресов'),
  body('emails.*')
    .isEmail().withMessage('Один из адресов некорректен')
    .isLength({ max: 255 }),
]
