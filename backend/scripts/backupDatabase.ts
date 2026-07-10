// Nightly database backup — pg_dump (custom format, compressed) → a dedicated
// Object Storage bucket, with a Telegram report either way. Run via cron:
//   0 3 * * * cd /var/www/gradeassist/backend && npm run backup:db >> /var/log/gradeassist/backup.log 2>&1
//
// Deliberately does NOT prune old backups from the app itself — the upload
// credentials should be write-only (no s3:DeleteObject) so a compromised VM
// can't destroy backup history along with the live data. Retention is a
// bucket lifecycle rule configured once in the Yandex Cloud console (see
// docs/support/runbooks/restore-database.md) — object-storage-side expiry,
// not application logic.

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { sendTelegramMessage } from '../src/lib/telegramAlert'

function backupBucketClient(): S3Client {
  const accessKey = process.env.BACKUP_STORAGE_ACCESS_KEY ?? process.env.YANDEX_STORAGE_ACCESS_KEY
  const secretKey = process.env.BACKUP_STORAGE_SECRET_KEY ?? process.env.YANDEX_STORAGE_SECRET_KEY
  if (!accessKey || !secretKey) {
    throw new Error('BACKUP_STORAGE_ACCESS_KEY/SECRET_KEY (or YANDEX_STORAGE_*) not set')
  }
  return new S3Client({
    region:      'ru-central1',
    endpoint:    process.env.BACKUP_STORAGE_ENDPOINT ?? process.env.YANDEX_STORAGE_ENDPOINT ?? 'https://storage.yandexcloud.net',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  })
}

function runPgDump(databaseUrl: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -Fc = custom format: compressed, and restorable with pg_restore
    // --no-owner/--no-privileges: dump is portable to a fresh restore target
    // that doesn't have the exact same role names (e.g. a scratch DB for a
    // restore drill) without failing on GRANT/OWNER statements.
    const child = spawn('pg_dump', [
      databaseUrl, '-Fc', '--no-owner', '--no-privileges', '-f', outFile,
    ])
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pg_dump exited ${code}: ${stderr.trim()}`))
    })
  })
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `ispum-${stamp}.dump`
  const tmpFile = path.join(os.tmpdir(), fileName)

  try {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('DATABASE_URL is not set')

    const bucket = process.env.BACKUP_STORAGE_BUCKET
    if (!bucket) throw new Error('BACKUP_STORAGE_BUCKET is not set')

    await runPgDump(databaseUrl, tmpFile)

    const buffer = await fs.readFile(tmpFile)
    const client = backupBucketClient()
    await client.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         fileName,
      Body:        buffer,
      ContentType: 'application/octet-stream',
    }))

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(0)
    const mb = (buffer.length / (1024 * 1024)).toFixed(1)
    console.log(`✓ Backed up ${fileName} (${mb} MB, ${seconds}s) → ${bucket}`)
    await sendTelegramMessage(`✅ ИСПУМ — резервная копия БД\n${fileName}\n${mb} МБ · ${seconds}с`)
  } catch (err) {
    const message = (err as Error).message
    console.error(`✗ Backup failed: ${message}`)
    await sendTelegramMessage(`🔴 ИСПУМ — резервная копия БД НЕ создана\n${message}`)
    process.exitCode = 1
  } finally {
    await fs.unlink(tmpFile).catch(() => null)
  }
}

main()
