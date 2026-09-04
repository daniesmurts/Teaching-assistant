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

// ─── Per-slide editing (TODO.md "### AO" Phase 1) ───────────────────────────

// The teacher's steer on a rewrite. Capped because it lands in the prompt
// (sanitised there — CLAUDE.md invariant 1); a paragraph is a remark, a novel
// is someone using the field as a content channel.
export const REGENERATE_INSTRUCTION_MAX_CHARS = 500

export const regenerateSlideRules = [
  body('instruction')
    .optional({ nullable: true, checkFalsy: true })
    .isString().withMessage('Некорректное замечание')
    .isLength({ max: REGENERATE_INSTRUCTION_MAX_CHARS })
    .withMessage(`Замечание слишком длинное (макс. ${REGENERATE_INSTRUCTION_MAX_CHARS} символов)`),
]

export const insertSlideRules = [
  body('after_index')
    .isInt({ min: -1 }).withMessage('Некорректная позиция слайда'),

  body('type')
    .isIn(['title', 'bullets', 'concept', 'formula', 'comparison', 'diagram', 'discussion', 'summary'])
    .withMessage('Неверный тип слайда'),

  body('title')
    .optional({ nullable: true })
    .isString().withMessage('Некорректный заголовок')
    .isLength({ max: 300 }).withMessage('Заголовок слайда слишком длинный'),
]
