import { Request, Response, NextFunction } from 'express'
import { recordAudit } from '../db/queries/audit'

// ─── Catch-all activity logging ──────────────────────────────────────────────
//
// Records every *successful state-changing* request from an authenticated user
// into audit_log, so the institution/platform activity views cover the whole
// app — not just the admin routes that call recordAudit explicitly.
//
// Registered globally (before the routers). It attaches a `finish` listener up
// front; by the time that fires the route has run, so req.teacher is populated
// and res.statusCode is final. We only write when:
//   • the method mutates state (POST/PUT/PATCH/DELETE),
//   • the request was authenticated (req.teacher set),
//   • the response succeeded (2xx),
//   • the route did not already record a richer audit row itself
//     (res.locals.selfAudited — set by institution.ts / orgUnits.ts, which own
//     their audit metadata). Any mutation added to those routers MUST keep
//     calling recordAudit or it will go unlogged.
//
// Reads (GET) are deliberately not logged: they would bury the security-
// relevant events. Log a specific sensitive read explicitly if ever needed.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const VERB: Record<string, string> = {
  POST:   'create',
  PUT:    'update',
  PATCH:  'update',
  DELETE: 'delete',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isId = (seg: string) => UUID_RE.test(seg) || /^\d+$/.test(seg)

/**
 * Derive a stable `resource.action` name + target id from the request. The
 * resource is the dotted path of the leading name segments (so nested mounts
 * keep their context); the target is the first id (the primary object being
 * acted on); a trailing name after the id becomes a named sub-action, else the
 * HTTP method maps to create/update/delete.
 *   POST   /api/courses                          → courses.create              (target null)
 *   PATCH  /api/courses/:id                       → courses.update              (target id)
 *   DELETE /api/courses/:id                       → courses.delete              (target id)
 *   POST   /api/grading/grade                     → grading.grade               (target null)
 *   POST   /api/grading/:id/approve               → grading.approve             (target id)
 *   PATCH  /api/institution/programs/:id          → institution.programs.update (target program id)
 *   POST   /api/institution/programs/:id/analyze  → institution.programs.analyze(target program id)
 */
export function deriveAction(method: string, path: string): { action: string; target: string | null } {
  const segments = path.split('?')[0].split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()

  const verb = VERB[method] ?? method.toLowerCase()
  if (segments.length === 0) return { action: `unknown.${verb}`, target: null }

  const firstIdIdx = segments.findIndex(isId)

  if (firstIdIdx === -1) {
    // No id in the path. A single segment is the resource (verb from method);
    // multiple segments treat the last as the named action (e.g. grading.grade).
    if (segments.length === 1) return { action: `${segments[0]}.${verb}`, target: null }
    const resource = segments.slice(0, -1).join('.')
    return { action: `${resource}.${segments[segments.length - 1]}`, target: null }
  }

  const resource = segments.slice(0, firstIdIdx).join('.')
  const target = segments[firstIdIdx]
  const tail = segments.slice(firstIdIdx + 1).filter((s) => !isId(s))
  const action = tail.length ? `${resource}.${tail[tail.length - 1]}` : `${resource}.${verb}`

  return { action, target }
}

export function auditLog(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) return next()

  res.on('finish', () => {
    if (res.locals.selfAudited) return
    if (!req.teacher) return
    if (res.statusCode < 200 || res.statusCode >= 300) return

    const { action, target } = deriveAction(req.method, req.originalUrl)

    recordAudit({
      institutionId:  req.teacher.institution_id,
      actorTeacherId: req.teacher.id,
      actorEmail:     req.teacher.email,
      action,
      target,
      ipAddress:      req.ip ?? null,
      // Cap the UA so a hostile client can't bloat the row.
      userAgent:      (req.get('user-agent') ?? null)?.slice(0, 400) ?? null,
    })
  })

  next()
}
