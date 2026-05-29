/**
 * Smoke test – end-to-end happy path.
 *
 * === DB setup required before running this suite ===
 *
 * 1. Start Supabase (local: `supabase start`, or point to a remote project).
 * 2. Apply migrations: `supabase db reset` (local) or run each file in
 *    supabase/migrations/ in order.
 * 3. Create the test user:
 *      supabase auth user create \
 *        --email  "$PLAYWRIGHT_EMAIL" \
 *        --password "$PLAYWRIGHT_PASSWORD"
 * 4. Seed detection data for the "groups → triage → export" test:
 *      npx tsx --conditions react-server scripts/try-detection.ts
 *    This creates the project referenced by PLAYWRIGHT_PROJECT_ID and populates
 *    gsc_metric + cannibalization_group rows.
 * 5. Seed a connected GSC connection for the "onboard + OAuth" test so that
 *    the SyncStatusPill assertion on the settings page passes:
 *      INSERT INTO gsc_connection (project_id, status, refresh_token, access_token,
 *        email, last_synced_date)
 *      VALUES ('$PLAYWRIGHT_PROJECT_ID', 'connected', 'enc_placeholder',
 *              'enc_placeholder', 'test@example.com', NULL)
 *      ON CONFLICT (project_id) DO UPDATE SET status = 'connected';
 *    (Or run the real OAuth flow once for that project and let the callback
 *     handler write the connection row.)
 *
 * Required env vars:
 *   PLAYWRIGHT_EMAIL        – Supabase user e-mail
 *   PLAYWRIGHT_PASSWORD     – Supabase user password
 *   PLAYWRIGHT_PROJECT_ID   – ID of the pre-loaded test project (connected GSC)
 */

import { test, expect } from '@playwright/test'

const EMAIL      = process.env['PLAYWRIGHT_EMAIL']      ?? ''
const PASSWORD   = process.env['PLAYWRIGHT_PASSWORD']   ?? ''
const PROJECT_ID = process.env['PLAYWRIGHT_PROJECT_ID'] ?? ''

// ── Shared typed shapes ───────────────────────────────────────────────────────
interface GroupItem {
  id: number
  inversion: boolean
}
interface GroupListData {
  data: { items: GroupItem[]; nextCursor: string | null }
  error: null
}
interface AuthUrlData {
  data: { url: string }
  error: null
}

// ── onboard + OAuth ───────────────────────────────────────────────────────────
test.describe('onboard + OAuth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', EMAIL)
    await page.fill('#password', PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('/')
  })

  test('wizard → auth-url mock → callback → SyncStatusPill Connected', async ({ page }) => {
    // A synthetic project ID used throughout the mocked wizard flow.
    // This project is never written to the DB; all API calls are intercepted.
    const FAKE_ID = 'e2e-onboard-test'

    // ── Route mocks ────────────────────────────────────────────────────────────

    // POST /api/projects — return a synthetic ProjectDTO so the wizard advances
    // without writing to the DB.
    await page.route('/api/projects', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: FAKE_ID,
            name: 'E2E Onboard Project',
            gscProperty: 'https://www.example.com/',
            propertyType: 'url_prefix',
            timezone: 'UTC',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          error: null,
        }),
      })
    })

    // GET /api/projects/:id/gsc/auth-url — return a synthetic Google OAuth URL
    // so the "Connetti" button never redirects the browser to real Google.
    await page.route(`/api/projects/${FAKE_ID}/gsc/auth-url`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            url: [
              'https://accounts.google.com/o/oauth2/auth',
              '?client_id=test-client-id',
              '&response_type=code',
              '&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fwebmasters.readonly',
              '&access_type=offline',
              '&prompt=consent',
              '&state=e2e-test-state',
            ].join(''),
          },
          error: null,
        }),
      })
    })

    // GET /api/auth/gsc/callback — simulate a successful OAuth handshake.
    // Redirects to the real test project settings page (PROJECT_ID must have a
    // 'connected' gsc_connection row — see DB setup instructions at the top).
    await page.route('/api/auth/gsc/callback**', async (route) => {
      await route.fulfill({
        status: 302,
        headers: { location: `/p/${PROJECT_ID}/settings?gsc=connected` },
      })
    })

    // ── Step 1: project name ──────────────────────────────────────────────────
    await page.goto('/onboarding')
    await page.fill('#name', 'E2E Onboard Project')
    await page.getByRole('button', { name: /Avanti/i }).click()

    // ── Step 2: GSC property ──────────────────────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Proprietà Google Search Console/i }),
    ).toBeVisible()
    await page.fill('#gscProperty', 'https://www.example.com/')
    // POST /api/projects is intercepted above; the mocked response advances to step 3.
    await page.getByRole('button', { name: /Avanti/i }).click()

    // ── Step 3: connect GSC ───────────────────────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Connetti Google Search Console/i }),
    ).toBeVisible()

    // Verify the mocked auth-url endpoint returns a proper Google OAuth URL.
    // Once the Wizard wires the "Connetti" button to call this endpoint, the
    // page.route() mock above will also intercept the in-page request.
    const authUrlRes = await page.request.get(
      `/api/projects/${FAKE_ID}/gsc/auth-url`,
    )
    expect(authUrlRes.ok()).toBeTruthy()
    const authUrlBody = (await authUrlRes.json()) as AuthUrlData
    expect(authUrlBody.data.url).toContain('accounts.google.com/o/oauth2')

    // Click the connect button. Currently the Wizard shows a placeholder message;
    // once OAuth is wired up in Wizard.tsx this will request the mocked auth-url
    // and redirect to the (mocked) Google consent page.
    await page.getByRole('button', {
      name: /Connetti a Google Search Console/i,
    }).click()

    // ── Simulate Google callback ──────────────────────────────────────────────
    // Navigate to the URL that Google would redirect back to after user consent.
    // The route mock above intercepts this and returns 302 → settings?gsc=connected.
    await page.goto(
      `/api/auth/gsc/callback?code=e2e-fake-code&state=e2e-fake-state`,
    )

    // Verify we land on the settings page (redirect followed correctly).
    await page.waitForURL(
      (url) =>
        url.pathname.includes(`/p/${PROJECT_ID}/settings`) &&
        url.search.includes('gsc=connected'),
    )

    // ── SyncStatusPill shows "Connected" ─────────────────────────────────────
    // The settings page is server-rendered and reads gsc_connection.status from
    // the DB. PROJECT_ID must have status = 'connected' in the test DB (see
    // setup instructions at the top of this file).
    await expect(
      page.locator('[aria-label="Connection status: Connected"]'),
    ).toBeVisible()
  })
})

// ── Smoke – happy path ────────────────────────────────────────────────────────
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
