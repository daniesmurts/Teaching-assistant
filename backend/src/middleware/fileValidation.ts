import multer from 'multer'
import { Request, Response, NextFunction } from 'express'
import { DocumentProcessingError } from '../errors/AppError'

// ─── Filename encoding repair ─────────────────────────────────────────────────
//
// Browsers send multipart filenames with raw UTF-8 bytes in the Content-
// Disposition header. Multer (and Express more generally) decode the header
// as Latin-1 by default, so a file called "Расчёт.docx" arrives as
// "Đ Đ°Ñ Ñ‘Ñ‚.docx". We round-trip latin1→utf8 to recover the original
// bytes, but only when the string looks like it could be latin1-encoded
// UTF-8 (every codepoint ≤ 0xFF) and the round-trip produces valid UTF-8
// (no replacement chars). Filenames that already contain real high-plane
// characters, or pure ASCII, pass through untouched.
//
// Exported so the one-off backfill script (scripts/repairFilenames.ts) can
// use the exact same heuristic the upload path uses.

export function repairUploadFilename(name: string): string {
  if (!name) return name
  // Already contains real Cyrillic/CJK/emoji etc. — trust it.
  if (/[^\x00-\xFF]/.test(name)) return name
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    // Replacement chars mean the bytes weren't valid UTF-8 — this string
    // was genuinely Latin-1 (e.g. "café.pdf"), not mojibake. Leave alone.
    if (decoded.includes('�')) return name
    return decoded
  } catch {
    return name
  }
}

// ─── Allowed MIME types ───────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // .pptx — «Загрузить свою презентацию» (TODO.md "### AO" Phase 4). Like
  // .docx it is a zip, so detectMimeFromBuffer sees no known signature and
  // the content check passes through, exactly as it has for Word all along.
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
])

export const MAX_FILE_SIZE = 20 * 1024 * 1024  // 20 MB

// ─── Multer config — validates MIME declared by client ────────────────────────

export const uploadConfig = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new DocumentProcessingError(
        'Неподдерживаемый формат файла. Загружайте PDF, Word-документ или изображение.'
      ))
    }
    // Repair Cyrillic filenames mangled by the Latin-1 header decode. Mutate
    // here so every downstream consumer (route handler, storage path, DB)
    // sees the correct name without each having to remember.
    file.originalname = repairUploadFilename(file.originalname)
    cb(null, true)
  },
})

// ─── Multi-file intake with clean error mapping ───────────────────────────────
// Multer reports oversize/limit problems as a MulterError mid-stream — without
// mapping, those reach the global handler as a generic 500. This wrapper turns
// them into a DocumentProcessingError (422) with a Russian message so the user
// sees what went wrong. Used by the program-import route (описание + учебный план).

export function uploadFields(fields: { name: string; maxCount?: number }[]) {
  const middleware = uploadConfig.fields(fields)
  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          const msg = err.code === 'LIMIT_FILE_SIZE'
            ? `Файл слишком большой. Максимум ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} МБ на документ.`
            : 'Не удалось загрузить файл. Проверьте формат и размер.'
          return next(new DocumentProcessingError(msg))
        }
        return next(err)
      }
      next()
    })
  }
}

// ─── Magic bytes — verifies actual file content matches declared MIME type ────
// Prevents disguised files (e.g. .exe renamed to .pdf).

const MAGIC_BYTES: Record<string, string> = {
  '25504446': 'application/pdf',       // %PDF
  '504b0304': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // PK zip
  'ffd8ffe0': 'image/jpeg',
  'ffd8ffe1': 'image/jpeg',
  'ffd8ffe2': 'image/jpeg',
  'ffd8ffdb': 'image/jpeg',
  '89504e47': 'image/png',
}

// Detect a file's real MIME type from its leading magic bytes, or null when
// the signature isn't one we recognise. Exported so the URL-fetch path
// (services/documentFetch.ts) can validate a downloaded buffer the same way
// uploads are validated — a server that lies in its Content-Type header
// shouldn't get a disguised file past us.
export function detectMimeFromBuffer(buffer: Buffer): string | null {
  const header = buffer.subarray(0, 4).toString('hex').toLowerCase()
  return MAGIC_BYTES[header] ?? null
}

function contentMatchesDeclaredType(file: Express.Multer.File): boolean {
  const detectedMime = detectMimeFromBuffer(file.buffer)
  return !detectedMime || detectedMime === file.mimetype
}

// Covers both `uploadConfig.single()` (req.file) and `uploadFields()`
// (req.files, keyed by field name) — the latter previously went unchecked,
// so a disguised file sent through e.g. POST /programs/import would only be
// caught by its client-declared MIME type.
export async function verifyFileContent(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const single = req.file
  if (single && !contentMatchesDeclaredType(single)) {
    return next(new DocumentProcessingError('Содержимое файла не соответствует его расширению.'))
  }

  const grouped = req.files as Record<string, Express.Multer.File[]> | Express.Multer.File[] | undefined
  if (grouped) {
    const files = Array.isArray(grouped) ? grouped : Object.values(grouped).flat()
    for (const file of files) {
      if (!contentMatchesDeclaredType(file)) {
        return next(new DocumentProcessingError('Содержимое файла не соответствует его расширению.'))
      }
    }
  }

  next()
}
