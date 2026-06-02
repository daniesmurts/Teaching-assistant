import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { authLimiter } from '../middleware/rateLimits'
import {
  findTeacherByEmail,
  findTeacherById,
  createTeacher,
} from '../db/queries/teachers'

const router = Router()

// ─── POST /api/auth/register ──────────────────────────────────────────────────

router.post(
  '/register',
  authLimiter,
  validate([
    { field: 'email', type: 'string', required: true },
    { field: 'password', type: 'string', required: true, minLength: 8 },
  ]),
  async (req, res, next) => {
    try {
      const { email, password, name, university } = req.body as {
        email: string
        password: string
        name?: string
        university?: string
      }

      const existing = await findTeacherByEmail(email)
      if (existing) {
        res.status(400).json({ error: 'Этот адрес эл. почты уже зарегистрирован' })
        return
      }

      const passwordHash = await bcrypt.hash(password, 12)
      const teacher = await createTeacher(email, passwordHash, name, university)

      const secret = process.env.JWT_SECRET!
      const token = jwt.sign({ id: teacher.id, email: teacher.email }, secret, {
        expiresIn: '7d',
      })

      res.status(201).json({ token, teacher })
    } catch (err) {
      next(err)
    }
  }
)

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post(
  '/login',
  authLimiter,
  validate([
    { field: 'email', type: 'string', required: true },
    { field: 'password', type: 'string', required: true },
  ]),
  async (req, res, next) => {
    try {
      const { email, password } = req.body as {
        email: string
        password: string
      }

      const row = await findTeacherByEmail(email)
      if (!row) {
        res.status(401).json({ error: 'Неверный адрес эл. почты или пароль' })
        return
      }

      const valid = await bcrypt.compare(password, row.password_hash)
      if (!valid) {
        res.status(401).json({ error: 'Неверный адрес эл. почты или пароль' })
        return
      }

      const secret = process.env.JWT_SECRET!
      const token = jwt.sign({ id: row.id, email: row.email }, secret, {
        expiresIn: '7d',
      })

      const teacher = {
        id: row.id,
        email: row.email,
        name: row.name,
        university: row.university,
        created_at: row.created_at.toISOString(),
      }

      res.json({ token, teacher })
    } catch (err) {
      next(err)
    }
  }
)

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const teacher = await findTeacherById(req.teacher.id)
    if (!teacher) {
      res.status(404).json({ error: 'Пользователь не найден' })
      return
    }
    res.json({ teacher })
  } catch (err) {
    next(err)
  }
})

export default router
