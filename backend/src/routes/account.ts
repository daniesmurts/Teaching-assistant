import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate } from '../middleware/authenticate'
import { authLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, UnauthorizedError } from '../errors/AppError'
import { logger } from '../lib/logger'
import { findTeacherByEmail, deleteTeacher } from '../db/queries/teachers'
import { getStoragePathsByTeacher } from '../db/queries/documents'
import { deleteObject } from '../services/objectStorage'
import { buildAccountExport } from '../services/accountExport'

const router = Router()
router.use(authenticate)

// ─── GET /api/account/export — download a JSON copy of your data ──────────────
//
// Both sensitive payload toggles (submissions, syllabuses) default OFF — the
// teacher must opt in via query params. Submission texts are the teacher's own
// data but contain student writing; the explicit opt-in keeps consent in the
// teacher's hands. Student names are anonymised regardless.

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const includeSubmissions = req.query.include_submissions === 'true'
    const includeSyllabuses  = req.query.include_syllabuses  === 'true'

    const data = await buildAccountExport(req.teacher.id, {
      include_submissions: includeSubmissions,
      include_syllabuses:  includeSyllabuses,
    })

    const stamp = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="ispum-export-${stamp}.json"`)
    res.send(JSON.stringify(data, null, 2))
  })
)

// ─── DELETE /api/account ─ permanently erase the account (152-ФЗ) ─────────────
// Requires the current password to confirm — destructive and irreversible.

router.delete(
  '/',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { password } = req.body as { password?: string }
    if (!password) throw new ValidationError('Введите пароль для подтверждения удаления')

    // Re-authenticate by password (defence against a stolen/forgotten session)
    const row = await findTeacherByEmail(req.teacher.email)
    if (!row) throw new UnauthorizedError()
    const valid = await bcrypt.compare(password, row.password_hash)
    if (!valid) throw new ValidationError('Неверный пароль')

    // 1. Wipe uploaded files from object storage (best-effort, before the DB rows go)
    const paths = await getStoragePathsByTeacher(row.id)
    await Promise.all(paths.map((p) => deleteObject(p)))

    // 2. Delete the teacher — FK cascades remove all associated data
    await deleteTeacher(row.id)

    logger.info({ message: 'Account deleted (152-FZ erasure)', teacherId: row.id, filesWiped: paths.length })
    res.json({ message: 'Аккаунт и все связанные данные удалены.' })
  })
)

export default router
