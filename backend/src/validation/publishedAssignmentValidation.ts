import { body } from 'express-validator'
import { SUBMISSION_TELEMETRY_KEYS } from '../../../shared/types'

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

// Adding a whole group at once, pasted one student per line. Capped at 300:
// larger than any real учебная группа, small enough that a paste accident
// can't insert an unbounded number of rows.
export const MAX_BULK_INVITES = 300

export const addInvitesBulkRules = [
  body('names')
    .isArray({ min: 1, max: MAX_BULK_INVITES })
    .withMessage(`Список студентов: от 1 до ${MAX_BULK_INVITES} строк`),
  body('names.*').isString().trim().isLength({ min: 1, max: 200 }).withMessage('Слишком длинное имя студента'),
]

// ─── Public writing surface (token-authed) ────────────────────────────────────

// draft_content is a TipTap JSON document; cap the serialised size to bound
// storage and reject abuse. telemetry is an aggregates object (§5.1.2) —
// the platform promises teachers only ever see aggregate process metrics,
// never raw keystroke/paste content, so the allowed keys are enforced here
// rather than trusted from the client.
//
// Derived from the shared type, NOT hand-listed. The hand-written version
// omitted `paste_count`, which the client has always sent, so every draft save
// and every submit 400'd — see SUBMISSION_TELEMETRY_KEYS in shared/types.ts
// for why this shape makes that drift a compile error.
const TELEMETRY_KEYS = new Set<string>(SUBMISSION_TELEMETRY_KEYS)

/**
 * Exported so the rule below and its regression test check the same thing —
 * the bug this replaces was invisible precisely because nothing on the server
 * side ever asserted against a real client payload.
 */
export function isAllowedTelemetry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.keys(value as Record<string, unknown>).every((k) => TELEMETRY_KEYS.has(k))
}

export const saveDraftRules = [
  body('draft_content').exists().withMessage('Нет содержимого')
    .custom((v) => JSON.stringify(v).length <= 2_000_000).withMessage('Документ слишком большой'),
  body('telemetry').optional({ nullable: true }).isObject()
    .custom(isAllowedTelemetry).withMessage('Недопустимые поля телеметрии'),
  body('snapshot').optional().isBoolean(),
]

export const consentRules = [
  body('version').optional().isString().isLength({ max: 50 }),
]
