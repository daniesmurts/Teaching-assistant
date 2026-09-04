import { body } from 'express-validator'
import { MAX_SLIDE_COUNT } from '../../../shared/types'
import { OUTLINE_BRIEF_MAX_CHARS, OUTLINE_TITLE_MAX_CHARS } from '../services/presentations'

export const generatePresentationRules = [
  body('topic')
    .trim()
    .notEmpty().withMessage('Тема лекции обязательна')
    .isLength({ max: 300 }).withMessage('Тема лекции слишком длинная'),

  body('duration_minutes')
    .isInt({ min: 10, max: 240 })
    .withMessage('Продолжительность: от 10 до 240 минут'),

  body('course_id')
    .optional({ nullable: true, checkFalsy: true })
    .isUUID().withMessage('Неверный идентификатор предмета'),

  body('lecture_number')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1, max: 200 }).withMessage('Номер лекции: от 1 до 200'),

  // Was capped at 30 to fit the old single-call generation's 8192-token
  // ceiling (2026-07-15 incident). Generation now runs as outline +
  // parallel expansion batches (services/presentations.ts) — each batch has
  // its own full token budget regardless of total deck size, so the cap is
  // now a product/cost decision, not a technical wall.
  //
  // Kept in lockstep with MAX_SLIDE_COUNT rather than hardcoded: a manual
  // target validation accepts but the generator then clamps would silently
  // hand back fewer slides than requested.
  body('slide_count_target')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 3, max: MAX_SLIDE_COUNT })
    .withMessage(`Количество слайдов: от 3 до ${MAX_SLIDE_COUNT}`),

  body('depth')
    .optional()
    .isIn(['standard', 'deep', '']).withMessage('Неверная глубина проработки'),

  body('learning_goals')
    .optional()
    .isArray({ max: 10 }).withMessage('Максимум 10 целей обучения'),

  body('learning_goals.*')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Цель обучения слишком длинная'),

  body('audience_level')
    .optional()
    .isIn(['undergraduate_1', 'undergraduate_2', 'postgraduate', 'professional', ''])
    .withMessage('Неверный уровень аудитории'),

  body('style')
    .optional()
    .isIn(['theory_heavy', 'case_study', 'discussion_based', ''])
    .withMessage('Неверный стиль подачи'),

  body('source_text')
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ max: 20000 }).withMessage('Конспект слишком длинный (макс. 20000 символов)'),

  // "Строго по конспекту" — only meaningful alongside source_text; the
  // service ignores it otherwise (see isStrictSource in services/presentations.ts).
  body('strict_source')
    .optional({ nullable: true })
    .isBoolean().withMessage('Неверное значение режима «строго по конспекту»'),

  // Outline approval gate (TODO.md "### AO" Phase 0). Absent means true —
  // an older cached frontend bundle that doesn't send the field would
  // otherwise land in a gate it has no UI for, so the route reads it as
  // "false only when explicitly false" and the client sends it explicitly.
  body('review_outline')
    .optional({ nullable: true })
    .isBoolean().withMessage('Неверное значение режима предварительного плана'),
]

// Confirming an edited plan. Shape only — normaliseEditedOutline() in
// services/presentations.ts does the trimming, unknown-type coercion and
// blank-row dropping, so these rules exist to reject what a normaliser
// shouldn't quietly repair: a missing array, or one long enough to be an
// attack rather than a lecture.
export const confirmOutlineRules = [
  body('outline')
    .isArray({ min: 1, max: MAX_SLIDE_COUNT })
    .withMessage(`План должен содержать от 1 до ${MAX_SLIDE_COUNT} слайдов`),

  body('outline.*.title')
    .isString().withMessage('Заголовок слайда обязателен')
    .isLength({ max: OUTLINE_TITLE_MAX_CHARS })
    .withMessage(`Заголовок слайда слишком длинный (макс. ${OUTLINE_TITLE_MAX_CHARS} символов)`),

  body('outline.*.brief')
    .optional({ nullable: true })
    .isString().withMessage('Неверное описание слайда')
    .isLength({ max: OUTLINE_BRIEF_MAX_CHARS })
    .withMessage(`Описание слайда слишком длинное (макс. ${OUTLINE_BRIEF_MAX_CHARS} символов)`),
]
