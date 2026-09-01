import { test, expect } from '@playwright/test'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION = {
  access_token: 'stub',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'stub',
  user: {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'auth-bootstrap@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
  },
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function mockSupabase(page, { authenticated = true, sessionDelay = 0, membershipDelay = 0, membershipFailures = 0, failMembershipUntilRetry = false } = {}) {
  let membershipCalls = 0
  let membershipAvailable = !failMembershipUntilRetry

  if (authenticated) {
    await page.addInitScript((session) => {
      // supabase-js restores an authenticated session from this storage key
      // before asking the auth endpoint, making the bootstrap test deterministic.
      localStorage.setItem('sb-e2e-public-auth-token', JSON.stringify(session))
    }, SESSION)
  }

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.endsWith('/auth/v1/session')) {
      if (sessionDelay) await page.waitForTimeout(sessionDelay)
      return json(route, authenticated ? SESSION : null)
    }

    if (url.pathname.endsWith('/auth/v1/token')) {
      return json(route, SESSION)
    }

    if (url.pathname.endsWith('/auth/v1/logout')) {
      return route.fulfill({ status: 204 })
    }

    if (url.pathname.endsWith('/auth/v1/user')) {
      return json(route, SESSION.user)
    }

    if (url.pathname.endsWith('/rest/v1/barberia_members')) {
      membershipCalls += 1
      if (membershipDelay) await page.waitForTimeout(membershipDelay)
      if (!membershipAvailable || membershipCalls <= membershipFailures) {
        return json(route, { code: 'PGRST000', message: 'workspace lookup unavailable' }, 503)
      }
      return json(route, [{
        barberia_id: 42,
        role: 'owner',
        barberias: { nombre: 'Barbería E2E', onboarding_completed: true },
      }])
    }

    if (url.pathname.endsWith('/rest/v1/rpc/platform_role')) return json(route, null)
    if (url.pathname.includes('/functions/v1/whatsapp-provision')) return json(route, { connection: { state: 'NOT_CONFIGURED' } })

    if (url.pathname.startsWith('/rest/v1/')) {
      return json(route, [])
    }

    return route.continue()
  })

  const calls = () => membershipCalls
  calls.allowMembership = () => { membershipAvailable = true }
  return calls
}

test.describe('auth bootstrap y navegación segura', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.project.name === 'desktop-1366') await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('sesión anónima confirmada termina en landing pública', async ({ page }) => {
    await mockSupabase(page, { authenticated: false })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('[data-public-landing="true"]')).toBeVisible({ timeout: 5_000 })
  })

  for (const delay of [500, 1500]) {
    test(`sesión autenticada: mantiene estado neutral durante ${delay} ms`, async ({ page }) => {
      await mockSupabase(page, { membershipDelay: delay })
      await page.goto('/', { waitUntil: 'domcontentloaded' })

      await expect(page.locator('[data-public-landing="true"]')).toHaveCount(0)
      await expect(page.getByRole('status')).toBeVisible()
      await expect(page.getByRole('status')).toContainText(/cargando pantalla|preparando/i)
      await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('[data-public-landing="true"]')).toHaveCount(0)
    })
  }

  test('error de memberships: muestra error y no onboarding; retry sólo reintenta workspace', async ({ page }) => {
    const calls = await mockSupabase(page, { failMembershipUntilRetry: true })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /no pudimos cargar tu espacio de trabajo/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: /creá tu primer negocio/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeEnabled()

    const callsBeforeRetry = calls()
    calls.allowMembership()
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible({ timeout: 15_000 })
    expect(calls()).toBe(callsBeforeRetry + 1)
  })

  test('logout limpia la sesión antes de volver a la landing', async ({ page }) => {
    await mockSupabase(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible({ timeout: 15_000 })

    const logoutButton = page.getByRole('button', { name: 'Cerrar sesión' }).first()
    if (await logoutButton.isVisible().catch(() => false)) {
      await logoutButton.click()
    } else {
      await page.getByRole('button', { name: 'Más', exact: true }).click()
      await page.locator('.mobile-mas-sheet').getByRole('button', { name: 'Cerrar sesión' }).click()
    }

    await expect(page.locator('[data-public-landing="true"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Resumen' })).toHaveCount(0)
  })

  async function loginWithRedirect(page, redirect) {
    await mockSupabase(page, { authenticated: false })
    const query = redirect === undefined ? '' : `?redirect=${encodeURIComponent(redirect)}`
    await page.goto(`/ingresar${query}`)
    await page.getByLabel('Email').fill('auth-bootstrap@example.com')
    await page.locator('#login-password').fill('password-123')
    await page.getByRole('button', { name: 'Entrar' }).click()
  }

  test('redirect interno de invitación se preserva después del login', async ({ page }) => {
    await loginWithRedirect(page, '/invitacion/e2e-token')
    await expect(page).toHaveURL(/\/invitacion\/e2e-token$/)
  })

  test('redirect externo se rechaza y usa el destino normal', async ({ page }) => {
    await loginWithRedirect(page, 'https://example.com/phishing')
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  })

  test('sin redirect mantiene el destino normal', async ({ page }) => {
    await loginWithRedirect(page)
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  })
})
