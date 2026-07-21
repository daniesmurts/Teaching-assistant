// One-shot sweep: find teachers whose legacy `role` enum says admin
// (institution_admin or platform_admin) but whose §7 org-tree grant is
// missing, and repair them via the same syncRoleToTree() the live PATCH
// handler uses.
//
// Root cause (fixed in routes/admin.ts): PATCH /api/admin/teachers/:id used
// to call clearOrgTiesOutsideInstitution() on an institution move but only
// called syncRoleToTree() when `role` was explicitly part of that same
// request. A move-only PATCH (institution_id changed, role omitted) wiped
// the admin-on-root grant in the old institution and never re-granted it in
// the new one — teachers.role stayed 'institution_admin' (so the Teachers-
// list badge kept showing «админ»), but is_institution_admin came back false
// (so «Организация» and every /institution route stayed blocked). Any
// teacher moved between institutions before that fix landed can be stuck
// in this state; this script finds and repairs all of them in one pass.
//
// Safe to re-run — syncRoleToTree is a pure upsert/set, never additive-only.
//
// Usage (from backend/):
//   npm run repair:role-tree              # prints the plan, makes the changes
//   npm run repair:role-tree -- --dry-run  # prints only, no writes

import { pool } from '../src/db/connection'
import { syncRoleToTree, isInstitutionAdmin } from '../src/db/queries/orgUnits'

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  const { rows: candidates } = await pool.query<{
    id: string; email: string; role: string; institution_id: string | null; is_platform_admin: boolean
  }>(
    `SELECT id, email, role, institution_id, is_platform_admin
       FROM teachers
      WHERE role IN ('institution_admin', 'platform_admin')
      ORDER BY email`
  )

  console.log(`Scanning ${candidates.length} teacher(s) with an admin role...`)
  let fixed = 0
  let skipped = 0

  for (const t of candidates) {
    let driftDetected = false
    let reason = ''

    if (t.role === 'platform_admin' && !t.is_platform_admin) {
      driftDetected = true
      reason = 'role=platform_admin but is_platform_admin=false'
    }
    if (t.role === 'institution_admin' && t.institution_id) {
      const hasGrant = await isInstitutionAdmin(t.id, t.institution_id)
      if (!hasGrant) {
        driftDetected = true
        reason = `role=institution_admin but no admin-on-root grant in institution ${t.institution_id}`
      }
    }
    if (t.role === 'institution_admin' && !t.institution_id) {
      // Nothing to grant — matches syncRoleToTree's own no-op for a detached teacher.
      continue
    }

    if (!driftDetected) { skipped++; continue }

    console.log(`  ${t.email} (${t.id}) — ${reason}`)
    if (!dryRun) {
      await syncRoleToTree(t.id, t.role, t.institution_id)
    }
    fixed++
  }

  console.log(`\n${dryRun ? 'Would fix' : 'Fixed'}: ${fixed}. Already in sync: ${skipped}.`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
