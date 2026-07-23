// Seeds N throwaway teacher accounts for load testing and mints JWTs for them
// directly (bypassing /api/auth/login), so a k6 run doesn't trip authLimiter
// (10 attempts/15min/IP) just spinning up virtual users.
//
// Refuses to run against anything that doesn't look like a staging/test DB —
// this creates real rows with real UUIDs against production data otherwise.
//
// Usage:
//   DATABASE_URL=... JWT_SECRET=... node --env-file=../../.env \
//     $(npm root)/.bin/tsx scripts/loadtest/seedLoadTestTeachers.ts [count] [institutionId]
//
// Writes backend/scripts/loadtest/tokens.json — an array of {id, email, token}.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { pool } from '../../src/db/connection'
import { createTeacher } from '../../src/db/queries/teachers'
import { signToken } from '../../src/lib/jwt'

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL is not set')
  if (!/staging|test|loadtest/i.test(dbUrl)) {
    throw new Error(
      `Refusing to seed — DATABASE_URL does not look like staging/test: ${dbUrl}\n` +
      `(matched against /staging|test|loadtest/i on the connection string)`
    )
  }

  const count = Number(process.argv[2] ?? 450)
  const institutionId = process.argv[3] || null

  console.log(`Seeding ${count} load-test teachers${institutionId ? ` under institution ${institutionId}` : ''}...`)

  // One shared bcrypt hash — these accounts are never logged into via
  // password, so a real per-account hash would just be wasted CPU.
  const dummyHash = await bcrypt.hash('loadtest-not-a-real-password', 4)

  const tokens: Array<{ id: string; email: string; token: string }> = []

  for (let i = 0; i < count; i++) {
    const email = `loadtest-teacher-${i}@loadtest.ispum.internal`
    const teacher = await createTeacher(
      email,
      dummyHash,
      `Loadtest Teacher ${i}`,
      undefined,
      undefined,
      institutionId ?? undefined
    )
    const token = signToken({ id: teacher.id, email: teacher.email })
    tokens.push({ id: teacher.id, email: teacher.email, token })

    if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${count}`)
  }

  const outPath = resolve(__dirname, 'tokens.json')
  writeFileSync(outPath, JSON.stringify(tokens, null, 2))
  console.log(`Wrote ${tokens.length} tokens to ${outPath}`)

  await pool.end()
}

main().catch((err) => {
  console.error('Seed failed:', err.message)
  process.exit(1)
})
