import { body } from 'express-validator'

export const createPublishedAssignmentRules = [
  body('title')
    .trim()
    .isLength({ min: 2, max: 300 }).withMessage('Название должно быть от 2 до 300 символов'),
  body('instructions')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 20000 }).withMessage('Задание слишком длинное'),
  body('course_id').optional({ nullable: true }).isUUID().withMessage('Некорректный курс'),
  body('rubric_id').optional({ nullable: true }).isUUID().withMessage('Некорректная рубрика'),
  body('due_at').optional({ nullable: true }).isISO8601().withMessage('Некорректный срок сдачи'),
]

export const updatePublishedAssignmentRules = [
  body('title').optional().trim().isLength({ min: 2, max: 300 }),
  body('instructions').optional({ nullable: true }).trim().isLength({ max: 20000 }),
  body('due_at').optional({ nullable: true }).isISO8601(),
  body('status').optional().isIn(['draft', 'open', 'closed']).withMessage('Недопустимый статус'),
]

export const addInviteRules = [
  body('student_name').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('student_email').optional({ nullable: true }).trim().isEmail().withMessage('Некорректный email').normalizeEmail(),
]

// ─── Public writing surface (token-authed) ────────────────────────────────────

// draft_content is a TipTap JSON document; cap the serialised size to bound
// storage and reject abuse. telemetry is an aggregates object (§5.1.2).
export const saveDraftRules = [
  body('draft_content').exists().withMessage('Нет содержимого')
    .custom((v) => JSON.stringify(v).length <= 2_000_000).withMessage('Документ слишком большой'),
  body('telemetry').optional({ nullable: true }).isObject(),
  body('snapshot').optional().isBoolean(),
]

export const consentRules = [
  body('version').optional().isString().isLength({ max: 50 }),
]
