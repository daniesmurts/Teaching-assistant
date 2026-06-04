import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'fs'
import path from 'path'
import { logger } from '../lib/logger'

// Yandex Object Storage is S3-compatible. In dev (no credentials) we fall
// back to the local filesystem so the upload pipeline stays testable.

const LOCAL_DIR = path.resolve(process.cwd(), '../uploads')

function s3(): S3Client | null {
  const accessKey = process.env.YANDEX_STORAGE_ACCESS_KEY
  const secretKey = process.env.YANDEX_STORAGE_SECRET_KEY
  if (!accessKey || !secretKey) return null

  return new S3Client({
    region:   'ru-central1',
    endpoint: process.env.YANDEX_STORAGE_ENDPOINT ?? 'https://storage.yandexcloud.net',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  })
}

export async function uploadObject(
  buffer: Buffer,
  storagePath: string,
  contentType: string
): Promise<void> {
  const client = s3()

  if (!client) {
    // Local fallback
    const full = path.join(LOCAL_DIR, storagePath)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, buffer)
    logger.info({ message: '[storage] saved locally (no Yandex creds)', storagePath })
    return
  }

  await client.send(new PutObjectCommand({
    Bucket:      process.env.YANDEX_STORAGE_BUCKET!,
    Key:         storagePath,
    Body:        buffer,
    ContentType: contentType,
  }))
}

/** Delete an object. Best-effort — never throws (used during account erasure). */
export async function deleteObject(storagePath: string): Promise<void> {
  try {
    const client = s3()
    if (!client) {
      await fs.unlink(path.join(LOCAL_DIR, storagePath)).catch(() => null)
      return
    }
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.YANDEX_STORAGE_BUCKET!,
      Key:    storagePath,
    }))
  } catch (err) {
    logger.warn({ message: '[storage] delete failed', storagePath, error: (err as Error).message })
  }
}

export async function downloadObject(storagePath: string): Promise<Buffer> {
  const client = s3()

  if (!client) {
    const full = path.join(LOCAL_DIR, storagePath)
    return fs.readFile(full)
  }

  const res = await client.send(new GetObjectCommand({
    Bucket: process.env.YANDEX_STORAGE_BUCKET!,
    Key:    storagePath,
  }))
  const bytes = await res.Body!.transformToByteArray()
  return Buffer.from(bytes)
}
