import { body } from 'express-validator'

export const analyzeOverlapRules = [
  body('course_ids')
    .isArray({ min: 2, max: 12 }).withMessage('Выберите от 2 до 12 дисциплин'),
  body('course_ids.*')
    .isUUID().withMessage('Некорректный идентификатор дисциплины'),
]

// Either a course_id (resolve text + targets server-side) or raw syllabus_text
// (re-checking an edited draft). Presence is enforced in the handler.
export const syllabusReviewRules = [
  body('course_id').optional().isUUID().withMessage('Некорректная дисциплина'),
  body('syllabus_text').optional().isString().isLength({ max: 20000 }),
  body('competencies').optional().isArray({ max: 30 }),
  body('goals').optional().isArray({ max: 30 }),
]

export const syllabusDraftRules = [
  body('course_id').optional().isUUID().withMessage('Некорректная дисциплина'),
  body('discipline_name').optional().isString().trim().isLength({ max: 300 }),
  body('level').optional().isString().trim().isLength({ max: 100 }),
  body('competencies').optional().isArray({ max: 30 }),
  body('goals').optional().isArray({ max: 30 }),
  body('current_content').optional().isString().isLength({ max: 20000 }),
  body('gaps').optional().isArray({ max: 30 }),
]

// Persist a РПД-студия draft's current state (initial generation or a later
// edit/recheck) — course_id required, this is the only path that saves.
export const syllabusStudioSaveRules = [
  body('course_id').isUUID().withMessage('Некорректная дисциплина'),
  body('discipline_name').isString().trim().isLength({ min: 1, max: 300 }),
  body('sections').isArray({ min: 1, max: 20 }),
  body('sections.*.heading').isString().isLength({ min: 1, max: 300 }),
  body('sections.*.content').isString().isLength({ min: 1, max: 20000 }),
  body('competencies').optional().isArray({ max: 30 }),
  body('goals').optional().isArray({ max: 30 }),
  body('review').optional(),
]
