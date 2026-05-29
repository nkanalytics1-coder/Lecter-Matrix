/**
 * Smoke test – end-to-end happy path.
 *
 * Pre-carica dati con scripts/try-detection.ts prima di lanciare lo smoke:
 *   npx tsx --conditions react-server scripts/try-detection.ts
 *
 * Required env vars:
 *   PLAYWRIGHT_EMAIL        – Supabase user e-mail
 *   PLAYWRIGHT_PASSWORD     – Supabase user password
 *   PLAYWRIGHT_PROJECT_ID   – ID of the pre-loaded test project
 */

import { test, expect } from '@playwright/test'

const EMAIL      = process.env['PLAYWRIGHT_EMAIL']      ?? ''
const PASSWORD   = process.env['PLAYWRIGHT_PASSWORD']   ?? ''
const PROJECT_ID = process.env['PLAYWRIGHT_PROJECT_ID'] ?? ''

// ── Skipped: onboarding → OAuth → GSC sync ────────────────────────────────────
// TODO(wave-oauth): skipped — OAuth GSC not yet implemented.
// When ready: navigate to /onboarding, connect GSC property, wait for first sync,
// then verify that gsc_metric rows are present.
test.skip('onboard → OAuth → sync', async () => { /* noop */ })

// ── Typed shape for /api/projects/:id/groups response ─────────────────────────
interface GroupItem {
  id: number
  inversion: boolean
}
interface GroupListData {
  data: { items: GroupItem[]; nextCursor: string | null }
  error: null
}

// ── Main smoke suite ──────────────────────────────────────────────────────────
test.describe('smoke – happy path', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', EMAIL)
    await page.fill('#password', PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('/')
  })

  test('login → overview → groups → drill → triage → export', async ({ page }) => {
    // ── Overview ──────────────────────────────────────────────────────────────
    await page.goto(`/p/${PROJECT_ID}/overview`)

    // SeverityDistribution renders a role=img bar
    await expect(
      page.getByRole('img', { name: /Barra di distribuzione severity/i }),
    ).toBeVisible()

    // ── Groups list ───────────────────────────────────────────────────────────
    await page.goto(`/p/${PROJECT_ID}/groups`)

    const grid = page.getByRole('grid')
    await expect(grid).toBeVisible()

    // At least one data row must exist beyond the header row (index 0)
    await expect(grid.getByRole('row').nth(1)).toBeVisible()

    // ── Drill ─────────────────────────────────────────────────────────────────
    // Rows are not yet linked in the grid; navigate via API to get the first group ID.
    const listResp = await page.request.get(
      `/api/projects/${PROJECT_ID}/groups?limit=1&sort=severity:desc`,
    )
    expect(listResp.ok()).toBeTruthy()

    const listJson = (await listResp.json()) as GroupListData
    const firstGroup = listJson.data.items[0]
    if (firstGroup === undefined) {
      throw new Error('No groups returned — run scripts/try-detection.ts first')
    }

    await page.goto(`/p/${PROJECT_ID}/groups/${firstGroup.id}`)

    // ActionPanel always renders on the drill page
    await expect(
      page.getByRole('heading', { name: /Azione raccomandata/i }),
    ).toBeVisible()

    // InversionBanner only renders when inversion=true
    if (firstGroup.inversion) {
      await expect(page.getByRole('alert')).toBeVisible()
    }

    // ── Triage status – optimistic update ────────────────────────────────────
    const statusSelect = page.locator('#triage-status')
    await expect(statusSelect).toBeVisible()

    await statusSelect.selectOption('in_progress')

    // TanStack Query's optimistic update applies synchronously; the select
    // should reflect the new value before the server round-trip completes.
    await expect(statusSelect).toHaveValue('in_progress')

    // ── Back to groups ────────────────────────────────────────────────────────
    await page.goto(`/p/${PROJECT_ID}/groups`)
    await expect(grid).toBeVisible()

    // ── CSV export ────────────────────────────────────────────────────────────
    // No UI export button in the current release; verify the endpoint directly.
    const exportResp = await page.request.get(
      `/api/projects/${PROJECT_ID}/export`,
    )
    expect(exportResp.status()).toBe(200)
    expect(exportResp.headers()['content-type'] ?? '').toContain('text/csv')
    expect(exportResp.headers()['content-disposition'] ?? '').toContain('attachment')
  })
})
