import multer from 'multer'
import { Request, Response, NextFunction } from 'express'
import { DocumentProcessingError } from '../errors/AppError'

// ─── Allowed MIME types ───────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

export async function verifyFileContent(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const file = req.file
  if (!file) { next(); return }

  const header       = file.buffer.subarray(0, 4).toString('hex').toLowerCase()
  const detectedMime = MAGIC_BYTES[header]

  if (detectedMime && detectedMime !== file.mimetype) {
    return next(
      new DocumentProcessingError(
        'Содержимое файла не соответствует его расширению.'
      )
    )
  }

  next()
}
