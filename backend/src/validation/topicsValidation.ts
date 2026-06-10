import { body } from 'express-validator'

export const generateTopicsRules = [
  body('level')
    .isIn(['bachelor', 'specialist', 'master', 'postgraduate']).withMessage('Укажите уровень обучения'),
  body('work_type')
    .isIn(['coursework', 'thesis', 'internship', 'pre_diploma', 'article']).withMessage('Укажите тип работы'),
  body('field').optional().trim().isLength({ max: 300 }),
  body('interests').optional().trim().isLength({ max: 2000 }),
  body('practice_site').optional().trim().isLength({ max: 500 }),
  body('student_name').optional().trim().isLength({ max: 200 }).escape(),
  body('student_group').optional().trim().isLength({ max: 100 }).escape(),
  body('course_id').optional({ nullable: true, checkFalsy: true }).isUUID(),
  body('count').optional().isInt({ min: 1, max: 5 }),
]
