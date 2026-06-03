// Diagnostic script — one-time, NOT part of the MVP, no tests required.
// Usage: npx tsx scripts/try-detection.ts
//
// Reads scripts/eurofides.csv (Italian CSV: ; separator, . thousands, , decimal),
// persists all rows as a single synthetic date, runs detection, and prints results.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CannibalizationGroupRow, CannibalizationMemberRow } from '../server/db/types'

// ── env setup ──────────────────────────────────────────────────────────────
// Must execute at module level before any dynamic server-module import so that
// serviceClient() picks up DATABASE_URL_TEST as SUPABASE_DB_URL on first load.
function loadEnv(): void {
  const content = readFileSync(join(process.cwd(), '.env.local'), 'utf-8')
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
  const url = process.env['DATABASE_URL_TEST']
  if (!url) throw new Error('DATABASE_URL_TEST not found in .env.local')
  process.env['SUPABASE_DB_URL'] = url // serviceClient() reads this key
}

loadEnv()

// ── CSV / number helpers ───────────────────────────────────────────────────
// Italian format: '.' is thousands separator, ',' is decimal separator.
function parseItalianInt(raw: string): number {
  return parseInt(raw.replaceAll('.', ''), 10)
}

function parseItalianFloat(raw: string): number {
  return parseFloat(raw.replaceAll('.', '').replace(',', '.'))
}

interface CsvRow {
  query: string
  page: string
  clicks: number
  impressions: number
  position: number
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim())
  const [headerLine, ...dataLines] = lines
  if (!headerLine) throw new Error('CSV is empty')

  const cols    = headerLine.split(';').map(c => c.trim().toLowerCase())
  const iQuery  = cols.indexOf('query')
  const iPage   = cols.indexOf('page')
  const iClicks = cols.indexOf('clicks')
  const iImpr   = cols.indexOf('impressions')
  const iPos    = cols.indexOf('position')

  if (iQuery === -1 || iPage === -1 || iClicks === -1 || iImpr === -1 || iPos === -1) {
    throw new Error(`Cannot locate required columns in header: ${headerLine}`)
  }

  const rows: CsvRow[] = []
  for (const line of dataLines) {
    if (!line.trim()) continue
    const cells = line.split(';')
    const query = cells[iQuery]?.trim() ?? ''
    const page  = cells[iPage]?.trim() ?? ''
    if (!query || !page) continue
    const clicks      = parseItalianInt(cells[iClicks]?.trim() ?? '')
    const impressions = parseItalianInt(cells[iImpr]?.trim() ?? '')
    const position    = parseItalianFloat(cells[iPos]?.trim() ?? '')
    rows.push({
      query,
      page,
      clicks:      Number.isFinite(clicks)      ? clicks      : 0,
      impressions: Number.isFinite(impressions) ? impressions : 0,
      position:    Number.isFinite(position)    ? position    : 0,
    })
  }
  return rows
}

// ── display helpers ────────────────────────────────────────────────────────
function col(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w - 1) + '…' : s.padEnd(w)
}

// ── Eurofides-specific intent config (diagnostic only — never in engine defaults) ──

const EUROFIDES_TRANSACTIONAL_EXTRA = [
  'packaging', 'buste', 'busta', 'sacchetti', 'sacchetto',
  'scatole', 'scatola', 'nastri', 'nastro', 'shopper',
  'carta', 'contenitori', 'confezioni', 'confezione',
  'astucci', 'cartellini', 'etichette', 'cesti',
  'tovaglie', 'bicchieri', 'coppette',
] as const

const EUROFIDES_BRAND_TERMS = [
  'eurofides', 'euro fides', 'eurofodes', 'eurofidea',
  'eurofides.com', 'eurofides srl', 'eurofides roma',
] as const

// ── constants ──────────────────────────────────────────────────────────────
const TEST_PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const MIGRATIONS = [
  '0001_extensions.sql',
  '0002_projects.sql',
  '0003_fact.sql',
  '0004_results.sql',
] as const

// ── main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Dynamic imports execute after loadEnv() → SUPABASE_DB_URL is already set
  const { serviceClient } = await import('../server/db/client')
  const { persistDate }   = await import('../server/ingest/persist')
  const { runDetection }  = await import('../server/engine/detect')

  const sql = serviceClient()

  try {
    // Ensure schema: if the results table is missing, apply all migrations
    const [schemaRow] = await sql<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'cannibalization_group'
      ) AS exists
    `
    if (!schemaRow?.exists) {
      process.stdout.write('Applying migrations… ')
      const migrDir = join(process.cwd(), 'supabase', 'migrations')
      for (const f of MIGRATIONS) {
        await sql.unsafe(readFileSync(join(migrDir, f), 'utf-8'))
      }
      console.log('done.')
    }

    // Create / upsert test project with Eurofides intent signals in config.
    // detect.ts reads intent_signals_extra + brand_terms from config and merges
    // them with DEFAULT_SIGNALS before calling detectIntent — so intent enters
    // scoring correctly rather than being recalculated after the fact.
    const eurConfig = {
      intent_signals_extra: [...EUROFIDES_TRANSACTIONAL_EXTRA],
      brand_terms:          [...EUROFIDES_BRAND_TERMS],
    }
    await sql`
      INSERT INTO project (id, name, gsc_property, property_type, config)
      VALUES (
        ${TEST_PROJECT_ID}::uuid,
        'eurofides-test',
        'eurofides-test',
        'url_prefix',
        ${sql.json(eurConfig)}
      )
      ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config
    `
    // Parse CSV and persist all rows under a single synthetic date (today)
    const today   = new Date().toISOString().slice(0, 10)
    const csvRows = parseCsv(
      readFileSync(join(process.cwd(), 'scripts', 'eurofides.csv'), 'utf-8'),
    )
    await persistDate(TEST_PROJECT_ID, today, csvRows)

    // Run detection over the single-day window
    const { groupsFound } = await runDetection(TEST_PROJECT_ID, today, today)

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\nRighe lette dal CSV : ${csvRows.length}`)
    console.log(`Righe persistite    : ${csvRows.length}`)
    console.log(`Gruppi trovati      : ${groupsFound}`)

    if (groupsFound === 0) {
      console.log('\nNessun gruppo rilevato — verificare soglie min_group_impressions / min_member_impressions.')
      return
    }

    // ── Group detail (severity DESC) ─────────────────────────────────────
    const groups = await sql<CannibalizationGroupRow[]>`
      SELECT * FROM cannibalization_group
      WHERE project_id = ${TEST_PROJECT_ID}
      ORDER BY severity DESC, id ASC
    `

    const W = 140
    console.log(`\n${'─'.repeat(W)}`)
    console.log(
      `  ${col('query_norm', 34)} ${col('cann_type', 30)} sev  ` +
      `${col('intent', 15)} inv  ${col('benign/reason', 22)} action`,
    )
    console.log('─'.repeat(W))

    for (const g of groups) {
      const members = await sql<CannibalizationMemberRow[]>`
        SELECT * FROM cannibalization_member
        WHERE group_id = ${g.id}
        ORDER BY impressions DESC
      `
      const inv    = g.inversion ? 'INV' : '   '
      const benign = g.benign ? `YES(${g.benign_reason ?? ''})` : 'no'

      console.log(
        `  ${col(g.query_norm, 34)} ${col(g.cann_type, 30)} ${g.severity.toFixed(1).padStart(4)} ` +
        `${col(g.query_intent, 15)} ${inv}  ${col(benign, 22)} ${g.recommended_action}`,
      )

      for (const m of members) {
        const role =
          m.is_winner              ? '[WINNER]   ' :
          m.page === g.dominant_page ? '[DOMINANT] ' : '           '
        console.log(
          `    ${role} ${col(m.page, 66)} ` +
          `${String(m.clicks).padStart(6)} clk ` +
          `${String(m.impressions).padStart(7)} impr ` +
          `pos ${m.position.toFixed(1)}`,
        )
      }
      console.log('')
    }
  } finally {
    await sql.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
