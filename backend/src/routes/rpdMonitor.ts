import { Router } from 'express'
import multer from 'multer'
import { authenticate } from '../middleware/authenticate'
import { requireInstitutionAdmin } from '../middleware/requireRole'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError, DocumentProcessingError } from '../errors/AppError'
import { repairUploadFilename } from '../middleware/fileValidation'
import {
  parseAsuExport, computeOverview, learnDeptCodesFromWorkbook,
} from '../services/rpdMonitor'
import { generateRpdMasterWorkbook, generateRpdGroupWorkbook } from '../services/rpdReportXlsx'
import { generateRpdReminderDocx, generateRpdReminderText } from '../services/rpdReminders'
import {
  createSnapshot, listSnapshots, getSnapshot, updateSnapshotCapturedAt, deleteSnapshot,
  getSnapshotRows, getLatestSnapshot,
  listDeptGroups, getDeptGroup, createDeptGroup, renameDeptGroup, deleteDeptGroup,
  assignDeptsToGroup, unassignDepts, getDeptGroupMap,
} from '../db/queries/rpdMonitor'

const router = Router()
router.use(authenticate)
router.use(requireInstitutionAdmin)
router.use(checkFeatureAccess('rpdMonitor'))

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|doc)$/i.test(file.originalname)
    if (!ok) return cb(new DocumentProcessingError('Загружайте выгрузку АСУ Университет в формате .xlsx или .doc'))
    file.originalname = repairUploadFilename(file.originalname)
    cb(null, true)
  },
})

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// ─── Upload → snapshot ──────────────────────────────────────────────────────

router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('Файл не передан')
  const instId = institutionId(req)

  const parsed = await parseAsuExport(req.file.buffer, req.file.originalname)
  const snapshot = await createSnapshot({
    institutionId:  instId,
    uploadedBy:     req.teacher.id,
    capturedAt:     parsed.capturedAt,
    periodLabel:    parsed.periodLabel,
    sourceFilename: req.file.originalname,
    rows:           parsed.rows,
  })

  const overview = await computeOverview(instId, snapshot.id)
  res.status(201).json({ snapshot, flags: parsed.flags, overview })
}))

// ─── Snapshots ──────────────────────────────────────────────────────────────

router.get('/snapshots', asyncHandler(async (req, res) => {
  res.json(await listSnapshots(institutionId(req)))
}))

router.patch('/snapshots/:id', asyncHandler(async (req, res) => {
  const capturedAt = req.body?.capturedAt ? new Date(req.body.capturedAt) : null
  if (!capturedAt || Number.isNaN(capturedAt.getTime())) throw new ValidationError('Некорректная дата')
  const updated = await updateSnapshotCapturedAt(req.params.id, institutionId(req), capturedAt)
  if (!updated) throw new NotFoundError('Снимок')
  res.json(updated)
}))

router.delete('/snapshots/:id', asyncHandler(async (req, res) => {
  const ok = await deleteSnapshot(req.params.id, institutionId(req))
  if (!ok) throw new NotFoundError('Снимок')
  res.status(204).end()
}))

// ─── Overview ───────────────────────────────────────────────────────────────

router.get('/overview', asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const snapshotId = typeof req.query.snapshotId === 'string'
    ? req.query.snapshotId
    : (await getLatestSnapshot(instId))?.id

  if (!snapshotId) { res.json(null); return }
  res.json(await computeOverview(instId, snapshotId))
}))

// ─── Mapping (кафедра → институт) ───────────────────────────────────────────

router.get('/mapping', asyncHandler(async (req, res) => {
  res.json(await listDeptGroups(institutionId(req)))
}))

router.post('/mapping/groups', asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) throw new ValidationError('Укажите название института/группы')
  res.status(201).json(await createDeptGroup(institutionId(req), name, Number(req.body?.sortOrder) || 0))
}))

router.patch('/mapping/groups/:id', asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) throw new ValidationError('Укажите название института/группы')
  const ok = await renameDeptGroup(req.params.id, institutionId(req), name)
  if (!ok) throw new NotFoundError('Группа')
  res.json(await getDeptGroup(req.params.id, institutionId(req)))
}))

router.delete('/mapping/groups/:id', asyncHandler(async (req, res) => {
  const ok = await deleteDeptGroup(req.params.id, institutionId(req))
  if (!ok) throw new NotFoundError('Группа')
  res.status(204).end()
}))

router.post('/mapping/assign', asyncHandler(async (req, res) => {
  const groupId = String(req.body?.groupId ?? '')
  const deptCodes = Array.isArray(req.body?.deptCodes) ? req.body.deptCodes.map(String) : []
  if (!groupId || deptCodes.length === 0) throw new ValidationError('Укажите группу и хотя бы одну кафедру')
  const group = await getDeptGroup(groupId, institutionId(req))
  if (!group) throw new NotFoundError('Группа')
  await assignDeptsToGroup(groupId, institutionId(req), deptCodes)
  res.status(204).end()
}))

router.post('/mapping/unassign', asyncHandler(async (req, res) => {
  const deptCodes = Array.isArray(req.body?.deptCodes) ? req.body.deptCodes.map(String) : []
  await unassignDepts(institutionId(req), deptCodes)
  res.status(204).end()
}))

// Bootstrap: upload one of her existing per-institute files so we learn which
// кафедры belong together, without her typing anything out.
router.post('/mapping/learn', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('Файл не передан')
  const deptCodes = await learnDeptCodesFromWorkbook(req.file.buffer, req.file.originalname)
  res.json({ deptCodes })
}))

// ─── Exports ────────────────────────────────────────────────────────────────

async function resolveSnapshotId(instId: string, queryId: unknown): Promise<string> {
  const id = typeof queryId === 'string' ? queryId : (await getLatestSnapshot(instId))?.id
  if (!id) throw new NotFoundError('Снимок')
  return id
}

router.get('/export/master', asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const snapshotId = await resolveSnapshotId(instId, req.query.snapshotId)
  const snapshot = await getSnapshot(snapshotId, instId)
  if (!snapshot) throw new NotFoundError('Снимок')

  const [overview, rows, groupMap] = await Promise.all([
    computeOverview(instId, snapshotId),
    getSnapshotRows(snapshotId),
    getDeptGroupMap(instId),
  ])
  const buffer = await generateRpdMasterWorkbook(snapshot, rows, overview, groupMap)
  const fname = `РПД_сводка_${snapshot.captured_at.toString().slice(0, 10)}.xlsx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`)
  res.end(buffer)
}))

router.get('/export/group/:groupId', asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const snapshotId = await resolveSnapshotId(instId, req.query.snapshotId)
  const snapshot = await getSnapshot(snapshotId, instId)
  if (!snapshot) throw new NotFoundError('Снимок')
  const group = await getDeptGroup(req.params.groupId, instId)
  if (!group) throw new NotFoundError('Группа')

  const rows = await getSnapshotRows(snapshotId)
  const buffer = await generateRpdGroupWorkbook(snapshot, group, rows)
  const fname = `РПД_${group.name}_${snapshot.captured_at.toString().slice(0, 10)}.xlsx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`)
  res.end(buffer)
}))

router.get('/reminders/:groupId', asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const snapshotId = await resolveSnapshotId(instId, req.query.snapshotId)
  const snapshot = await getSnapshot(snapshotId, instId)
  if (!snapshot) throw new NotFoundError('Снимок')
  const group = await getDeptGroup(req.params.groupId, instId)
  if (!group) throw new NotFoundError('Группа')
  const rows = await getSnapshotRows(snapshotId)

  if (req.query.format === 'text') {
    res.json(await generateRpdReminderText(req.teacher.id, snapshot, group, rows))
    return
  }
  const buffer = await generateRpdReminderDocx(req.teacher.id, snapshot, group, rows)
  const fname = `Напоминание_${group.name}_${snapshot.captured_at.toString().slice(0, 10)}.docx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`)
  res.end(buffer)
}))

export default router
