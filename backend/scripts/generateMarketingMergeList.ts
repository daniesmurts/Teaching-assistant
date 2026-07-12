// Generates a CSV mail-merge list for a one-off feature-announcement
// broadcast sent externally (not through emailTransport.ts). Each row gets
// its own one-click unsubscribe link (services/marketingEmails.ts) so the
// send satisfies mail-tool unsubscribe-link requirements without wiring a
// full campaign system.
//
// Usage (from backend/):
//   npm run marketing:merge-list                        # pro + institution
//   npm run marketing:merge-list -- --tiers=pro,institution,free
//   npm run marketing:merge-list -- --out=/tmp/list.csv

import { pool } from '../src/db/connection'
import { findMarketingOptedInTeachers } from '../src/db/queries/teachers'
import { marketingUnsubUrl } from '../src/services/marketingEmails'
import { writeFileSync } from 'fs'

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

async function main(): Promise<void> {
  const tiersArg = process.argv.find((a) => a.startsWith('--tiers='))
  const outArg   = process.argv.find((a) => a.startsWith('--out='))
  const tiers    = tiersArg ? tiersArg.slice('--tiers='.length).split(',') : ['pro', 'institution']
  const outPath  = outArg ? outArg.slice('--out='.length) : 'marketing-merge-list.csv'

  const teachers = await findMarketingOptedInTeachers(tiers)

  const header = 'email,name,unsubscribe_link'
  const lines  = teachers.map((t) => {
    const name = t.name?.split(' ').find((w) => w.length > 1) ?? t.name ?? ''
    return [csvEscape(t.email), csvEscape(name), marketingUnsubUrl(t.id)].join(',')
  })

  writeFileSync(outPath, [header, ...lines].join('\n') + '\n', 'utf-8')

  console.log(`${teachers.length} teachers (tiers: ${tiers.join(', ')}) → ${outPath}`)
  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
