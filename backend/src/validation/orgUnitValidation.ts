import { body } from 'express-validator'

// Creatable types — 'institution' is excluded: roots come from the migration /
// institution creation, never from the tree-builder.
const CREATABLE_TYPES = ['governance', 'admin_office', 'cluster', 'division', 'department']

export const createOrgUnitRules = [
  body('parentId')
    .isUUID().withMessage('Некорректный идентификатор родителя'),
  body('typeCode')
    .isIn(CREATABLE_TYPES).withMessage('Недопустимый тип подразделения'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 200 }).withMessage('Название должно быть от 2 до 200 символов'),
  body('shortName')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 50 }).withMessage('Сокращение не длиннее 50 символов'),
  body('externalCode')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 }).withMessage('Внешний код не длиннее 100 символов'),
]

const UNIT_ROLES = ['admin', 'head', 'viewer']

export const grantRoleRules = [
  body('teacherId').isUUID().withMessage('Некорректный идентификатор преподавателя'),
  body('unitId').isUUID().withMessage('Некорректный идентификатор подразделения'),
  body('role').isIn(UNIT_ROLES).withMessage('Недопустимая роль'),
]

export const setPrimaryRules = [
  body('unitId').isUUID().withMessage('Некорректный идентификатор подразделения'),
]

export const updateOrgUnitRules = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 }).withMessage('Название должно быть от 2 до 200 символов'),
  body('shortName')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 50 }).withMessage('Сокращение не длиннее 50 символов'),
  body('externalCode')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 }).withMessage('Внешний код не длиннее 100 символов'),
]
