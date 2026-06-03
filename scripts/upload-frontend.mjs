#!/usr/bin/env node
// Uploads a built frontend (frontend/dist) to a Yandex Object Storage bucket
// using the S3-compatible static access keys. No `yc` / OAuth required.
//
//   node --env-file=.env scripts/upload-frontend.mjs <distDir> <bucket>
//
// Reads YANDEX_STORAGE_* from the environment (loaded via --env-file).
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, extname } from 'node:path'

const distDir = process.argv[2] || 'frontend/dist'
const bucket  = process.argv[3] || process.env.YANDEX_FRONTEND_BUCKET || 'gradeassist-frontend'

const {
  YANDEX_STORAGE_ACCESS_KEY: AK,
  YANDEX_STORAGE_SECRET_KEY: SK,
  YANDEX_STORAGE_ENDPOINT:   ENDPOINT = 'https://storage.yandexcloud.net',
} = process.env

if (!AK || !SK) {
  console.error('❌ Missing YANDEX_STORAGE_ACCESS_KEY / SECRET_KEY (load via --env-file=.env)')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'ru-central1',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: AK, secretAccessKey: SK },
  maxAttempts: 5,                 // SDK-level retries for transient errors
  requestHandler: { requestTimeout: 60_000, connectionTimeout: 15_000 },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retry a single upload through transient network drops (TLS timeouts, socket resets).
async function putWithRetry(params, label, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await s3.send(new PutObjectCommand(params))
      return
    } catch (err) {
      if (i === attempts) throw err
      const wait = 1000 * i
      process.stdout.write(`  … retry ${i}/${attempts - 1} for ${label} (${err.name}) in ${wait}ms\n`)
      await sleep(wait)
    }
  }
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json',
}

// Files that must never be cached aggressively, or PWA users get stuck on old versions.
const NO_CACHE = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js'])

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

async function main() {
  try {
    await stat(distDir)
  } catch {
    console.error(`❌ Dist directory not found: ${distDir}  (run "npm run build --workspace=frontend" first)`)
    process.exit(1)
  }

  let count = 0
  console.log(`▶ Uploading ${distDir} → s3://${bucket}/`)
  for await (const file of walk(distDir)) {
    const key  = relative(distDir, file).split('\\').join('/')   // POSIX keys
    const body = await readFile(file)
    const ext  = extname(file).toLowerCase()
    const base = key.split('/').pop()

    await putWithRetry({
      Bucket:       bucket,
      Key:          key,
      Body:         body,
      ContentType:  CONTENT_TYPES[ext] ?? 'application/octet-stream',
      CacheControl: NO_CACHE.has(base)
        ? 'no-cache, must-revalidate'
        : 'public, max-age=31536000, immutable',   // hashed assets — cache forever
    }, key)
    count++
    process.stdout.write(`  ✓ ${key}\n`)
  }
  console.log(`\n✅ Uploaded ${count} file(s) to s3://${bucket}/`)
}

main().catch((err) => {
  console.error('\n❌ Upload failed:', err.name, '-', err.message)
  process.exit(1)
})
