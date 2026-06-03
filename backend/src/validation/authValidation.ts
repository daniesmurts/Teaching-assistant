import { body } from 'express-validator'

export const registerRules = [
  body('email')
    .isEmail()         .withMessage('Введите действительный адрес эл. почты')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Адрес эл. почты слишком длинный'),

  body('password')
    .isLength({ min: 8 })  .withMessage('Пароль должен содержать не менее 8 символов')
    .isLength({ max: 128 }).withMessage('Пароль слишком длинный')
    .matches(/[A-Z]/)      .withMessage('Пароль должен содержать хотя бы одну заглавную букву')
    .matches(/[0-9]/)      .withMessage('Пароль должен содержать хотя бы одну цифру'),

  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Имя: от 2 до 100 символов')
    .escape(),

  body('university')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Название организации слишком длинное')
    .escape(),

  body('phone')
    .optional()
    .trim()
    .isLength({ max: 30 }).withMessage('Номер телефона слишком длинный'),
]

export const loginRules = [
  body('email')
    .isEmail().withMessage('Введите действительный адрес эл. почты')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Введите пароль')
    .isLength({ max: 128 }).withMessage('Пароль слишком длинный'),
]

export const forgotPasswordRules = [
  body('email')
    .isEmail().withMessage('Введите действительный адрес эл. почты')
    .normalizeEmail(),
]

export const resetPasswordRules = [
  body('token')
    .isLength({ min: 64, max: 64 }).withMessage('Недействительный токен'),

  body('password')
    .isLength({ min: 8 })  .withMessage('Пароль должен содержать не менее 8 символов')
    .isLength({ max: 128 }).withMessage('Пароль слишком длинный')
    .matches(/[A-Z]/)      .withMessage('Пароль должен содержать хотя бы одну заглавную букву')
    .matches(/[0-9]/)      .withMessage('Пароль должен содержать хотя бы одну цифру'),
]
