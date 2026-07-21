// One-shot correction for the РПД Monitor's кафедра → институт mapping at a
// single institution (КНИТУ), against the authoritative registry the head of
// УМЦ sent («Области кафедр КНИТУ.docx», реестр подразделений на 08.05.2026).
// She had mis-assigned some кафедры to the wrong институт via the in-app
// mapping editor; rather than have her manually drag ~70 кафедры across 8
// groups, this applies the corrected list directly.
//
// Safe to re-run — assignDeptsToGroup is a pure upsert (a dept_code belongs
// to at most one group; ON CONFLICT moves it), createDeptGroup is
// find-or-create by name.
//
// Usage (from backend/):
//   npx tsx scripts/fixRpdDeptMapping.ts --dry-run   # prints the diff only
//   npx tsx scripts/fixRpdDeptMapping.ts             # applies it

import { pool } from '../src/db/connection'
import { listDeptGroups, createDeptGroup, assignDeptsToGroup } from '../src/db/queries/rpdMonitor'

// Extracted verbatim from the docx she sent — «Реестр подразделений ФГБОУ ВО «КНИТУ» на 08.05.2026».
const AUTHORITATIVE_MAPPING: Record<string, string[]> = {
  'ИХТИ':    ['ТТХВ', 'ХТВМС', 'ТИПиКМ', 'ХТОСА', 'ИЭ', 'ОХЗ'],
  'ИХНМ':    ['ВТЭУ', 'МАХП', 'ПАХТ', 'ТОТ', 'ИКГАП', 'ОКПМ', 'ПДМ', 'ТКМ', 'АрД', 'НКТТ'],
  'ИУИ':     ['БСЭ', 'ГУИС', 'ПрК', 'ЛиУ', 'ПМ', 'УЧР', 'ФизВС', 'ИнП'],
  'ИНХН':    ['ТООНС', 'ХТПНГ', 'АХСМК', 'ОХТ', 'ОХ', 'ТНВМ', 'НХ', 'ПБ', 'Физика', 'ПТНиП'],
  'ИП':      ['ТСК', 'ХТПЭ', 'ФКХ', 'ТКС', 'ИХТ', 'ТПМ', 'ТППКМ', 'МИ', 'ХТПВР'],
  'ИППБТ':   ['ТПП', 'ПБТ', 'ХК', 'БПС', 'ОПП', 'ПищБТ'],
  'ИТЛПМД':  ['Дизайн', 'КОиО', 'МТЛП', 'СерТех', 'ТХНВИ'],
  'ИУАИТ':   ['САУТП', 'АССОИ', 'ВМ', 'ЭЭ', 'СТ', 'ИСУИР', 'ИПМ', 'ИБ'],
}

async function resolveInstitutionId(): Promise<string> {
  const explicit = process.argv.find((a) => a.startsWith('--institution='))?.split('=')[1]
  if (explicit) return explicit

  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM institutions WHERE name ILIKE '%КНИТУ%'`
  )
  if (rows.length === 1) return rows[0].id
  if (rows.length === 0) {
    throw new Error('No institution matching "КНИТУ" found — pass --institution=<uuid> explicitly.')
  }
  console.error('Multiple institutions match "КНИТУ" — pass --institution=<uuid> explicitly:')
  for (const r of rows) console.error(`  ${r.id}  ${r.name}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const institutionId = await resolveInstitutionId()

  const currentGroups = await listDeptGroups(institutionId)
  const currentGroupOf = new Map<string, string>()
  for (const g of currentGroups) {
    for (const code of g.dept_codes) currentGroupOf.set(code, g.name)
  }

  const authoritativeDeptCodes = new Set(Object.values(AUTHORITATIVE_MAPPING).flat())
  let moves = 0

  for (const [groupName, deptCodes] of Object.entries(AUTHORITATIVE_MAPPING)) {
    let group = currentGroups.find((g) => g.name === groupName)
    if (!group) {
      console.log(`[create group] ${groupName}`)
      if (!dryRun) group = await createDeptGroup(institutionId, groupName)
    }

    const misplaced = deptCodes.filter((code) => currentGroupOf.get(code) !== groupName)
    if (misplaced.length === 0) continue

    for (const code of misplaced) {
      const from = currentGroupOf.get(code)
      console.log(`  ${code}: ${from ? `«${from}»` : '(unassigned)'} → «${groupName}»`)
      moves++
    }
    if (!dryRun && group) {
      await assignDeptsToGroup(group.id, institutionId, misplaced)
    }
  }

  // Кафедры currently mapped somewhere but absent from the authoritative registry entirely —
  // flagged, not touched (could be a code spelling mismatch, not necessarily wrong).
  const unrecognised = [...currentGroupOf.keys()].filter((code) => !authoritativeDeptCodes.has(code))
  if (unrecognised.length > 0) {
    console.log(`\nКафедры assigned in the app but not found in the authoritative list (left untouched):`)
    for (const code of unrecognised) console.log(`  ${code} (currently in «${currentGroupOf.get(code)}»)`)
  }

  console.log(`\n${dryRun ? 'Would move' : 'Moved'}: ${moves} кафедра assignment(s).`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
