import { body } from 'express-validator'

// Creatable types — 'institution' is excluded: roots come from the migration /
// institution creation, never from the tree-builder.
const CREATABLE_TYPES = ['governance', 'admin_office', 'cluster', 'division', 'program', 'program_direction', 'department']

// Programme-metadata fields — optional on any unit (the route only persists
// them for program / program_direction types). Shared by create + update.
const programmeMetaRules = [
  body('code')
    .optional({ nullable: true }).trim()
    .isLength({ max: 50 }).withMessage('Код не длиннее 50 символов'),
  body('specialtyName')
    .optional({ nullable: true }).trim()
    .isLength({ max: 300 }).withMessage('Наименование не длиннее 300 символов'),
  body('educationLevel')
    .optional({ nullable: true }).trim()
    .isLength({ max: 120 }).withMessage('Уровень образования не длиннее 120 символов'),
  body('formsOfStudy')
    .optional({ nullable: true }).trim()
    .isLength({ max: 120 }).withMessage('Формы обучения не длиннее 120 символов'),
]

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
  ...programmeMetaRules,
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

// Deliberate re-type: separate from the rename PATCH because type drives
// authorisation (governance/admin_office grant institution-wide programme
// access by type alone) — a type change must be an explicit, audited act.
export const retypeOrgUnitRules = [
  body('typeCode')
    .isIn(CREATABLE_TYPES).withMessage('Недопустимый тип подразделения'),
]

export const moveOrgUnitRules = [
  body('newParentId').isUUID().withMessage('Некорректный идентификатор нового родителя'),
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
  ...programmeMetaRules,
]
