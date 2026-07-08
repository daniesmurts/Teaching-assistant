import { Request, Response, NextFunction } from 'express'
import { getLimits, canUseFeature } from '../config/planLimits'
import { getOrCreateCounter } from '../db/queries/usageCounters'
import { pool } from '../db/connection'

// ─── Monthly usage limits (grades, presentations) ─────────────────────────────

export function checkMonthlyLimit(
  feature: 'gradesPerMonth' | 'presentationsPerMonth' | 'criteriaImprovePerMonth'
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tier   = req.teacher.plan_tier
      const limits = getLimits(tier)
      const limit  = limits[feature]

      // Unlimited plans skip the counter lookup entirely
      if (limit === Infinity) { next(); return }

      const counter      = await getOrCreateCounter(req.teacher.id)
      const currentMonth = new Date().toISOString().slice(0, 7)
      const used         = counter.month_year !== currentMonth
        ? 0
        : feature === 'gradesPerMonth'
          ? counter.grades_this_month
          : feature === 'presentationsPerMonth'
            ? counter.presentations_this_month
            : counter.criteria_improve_this_month

      if (used >= limit) {
        res.status(403).json({
          error:   feature === 'gradesPerMonth'
            ? `Вы использовали все ${limit} бесплатных проверок в этом месяце.`
            : feature === 'presentationsPerMonth'
              ? `Вы использовали все ${limit} бесплатных презентации в этом месяце.`
              : `Вы использовали все ${limit} бесплатных улучшений описания в этом месяце.`,
          code:    'PLAN_LIMIT_REACHED',
          feature,
          limit,
          used,
          upgrade: true,
        })
        return
      }

      next()
    } catch (err) { next(err) }
  }
}

// ─── Boolean feature gates ────────────────────────────────────────────────────

export function checkFeatureAccess(
  feature: 'documentUpload' | 'ragFlywheel' | 'emailGeneration' | 'presentationHistory' | 'verificationQuestions' | 'handout' | 'publishedAssignments' | 'feedbackCritic' | 'cohortSynthesis' | 'calcVerification'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!canUseFeature(req.teacher.plan_tier, feature)) {
      res.status(403).json({
        error:   'Эта функция недоступна на вашем тарифном плане.',
        code:    'FEATURE_NOT_IN_PLAN',
        feature,
        upgrade: true,
      })
      return
    }
    next()
  }
}

// ─── Resource count limits (courses, criteria, rubrics) ──────────────────────

const RESOURCE_LABEL: Record<'courses' | 'criteria' | 'rubrics', string> = {
  courses:  'предметов',
  criteria: 'критериев',
  rubrics:  'рубрик',
}

export function checkResourceLimit(
  resource: 'courses' | 'criteria' | 'rubrics',
  limitKey:  'maxCourses' | 'maxCriteria' | 'maxRubrics'
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tier   = req.teacher.plan_tier
      const limits = getLimits(tier)
      const limit  = limits[limitKey]

      if (limit === Infinity) { next(); return }

      // Personal-resource count (institution-shared / global templates don't
      // count against the teacher's own cap — they're authored by admins).
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${resource} WHERE teacher_id = $1`,
        [req.teacher.id]
      )
      const count = parseInt(rows[0].count, 10)

      if (count >= limit) {
        res.status(403).json({
          error:    `Достигнут лимит ${RESOURCE_LABEL[resource]} для вашего тарифа (${limit}).`,
          code:     'RESOURCE_LIMIT_REACHED',
          resource,
          limit,
          current:  count,
          upgrade:  true,
        })
        return
      }

      next()
    } catch (err) { next(err) }
  }
}
