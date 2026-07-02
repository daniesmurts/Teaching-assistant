import { body } from 'express-validator'

// Creatable types — 'institution' is excluded: roots come from the migration /
// institution creation, never from the tree-builder.
const CREATABLE_TYPES = ['governance', 'admin_office', 'cluster', 'division', 'program', 'program_direction', 'department']

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

// Bulk create: one parent + type, many child units in a single transaction.
// Cap the batch — a paste of thousands would block the connection and is almost
// certainly a paste accident, not a real org structure.
export const BULK_UNITS_MAX = 200

export const bulkCreateOrgUnitsRules = [
  body('parentId')
    .isUUID().withMessage('Некорректный идентификатор родителя'),
  body('typeCode')
    .isIn(CREATABLE_TYPES).withMessage('Недопустимый тип подразделения'),
  body('units')
    .isArray({ min: 1, max: BULK_UNITS_MAX })
    .withMessage(`Список подразделений должен содержать от 1 до ${BULK_UNITS_MAX} элементов`),
  body('units.*.name')
    .isString().trim()
    .isLength({ min: 2, max: 200 }).withMessage('Каждое название — от 2 до 200 символов'),
  body('units.*.shortName')
    .optional({ nullable: true })
    .isString().trim()
    .isLength({ max: 50 }).withMessage('Сокращение не длиннее 50 символов'),
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
