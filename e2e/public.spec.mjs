import { test, expect } from '@playwright/test'

test.describe('superficies públicas sin efectos externos', () => {
  test('landing muestra CTA, planes y FAQ sin desborde horizontal', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('a[href="/registro"]').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('el hero crítico permanece visible durante el ciclo de vida', async ({ page }) => {
    test.setTimeout(45_000)
    await page.route('**/assets/Landing-*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.abort()
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const hero = page.locator('[data-hero-critical="true"]')
    await expect(hero.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(hero.getByRole('link', { name: /probar gratis/i })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(30_000)
    await expect(hero.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(hero).toHaveCSS('visibility', 'visible')
  })

  test('registro expone sólo los datos iniciales y validación de contraseña', async ({ page }) => {
    await page.goto('/registro')
    await expect(page.getByRole('heading', { name: /creá tu cuenta/i })).toBeVisible()
    await expect(page.getByLabel('Nombre')).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('Contraseña').first()).toHaveAttribute('minlength', '8')
    await expect(page.getByLabel('Repetir contraseña')).toBeVisible()
  })

  test('recuperación de contraseña tiene un flujo visible y accesible', async ({ page }) => {
    await page.goto('/recuperar')
    await expect(page.getByRole('heading', { name: /recuperar contraseña/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /enviar enlace/i })).toBeEnabled()
    await page.goto('/auth/confirm?error=access_denied&error_code=otp_expired&error_description=technical-detail')
    await expect(page.getByRole('heading', { name: /enlace.*v[aá]lido/i })).toBeVisible()
    await expect(page.getByText('technical-detail')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /enviar un nuevo enlace/i })).toBeVisible()
  })

  test('demo comercial abre el panel real, mantiene su sesión y puede reiniciarse', async ({ page }) => {
    await page.goto('/demo')
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
    await expect(page.getByText('Modo demostración')).toBeVisible()
    const sidebar = page.locator('.sidebar')
    if (await sidebar.isVisible().catch(() => false)) await expect(page.getByText('Barbería Demo Austral')).toBeVisible()
    else await expect(page.getByRole('button', { name: 'Más', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Agenda' }).click()
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /reiniciar demo/i }).click()
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
  })

  test('rutas de reserva e invitación fallan de forma controlada', async ({ page }) => {
    await page.goto('/reservar/__e2e_missing__')
    await expect(page.getByText(/no encontramos esta barbería/i)).toBeVisible()
    await page.goto('/invitacion/__e2e_missing__')
    await expect(page.getByRole('heading', { name: /invitación de equipo/i })).toBeVisible()
  })

  test('recarga directa de rutas funciona como fallback de Cloudflare', async ({ page }) => {
    test.setTimeout(90_000)
    for (const route of ['/registro', '/recuperar', '/demo', '/para/barberia']) {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 })
      await expect(page.locator('#root')).toBeVisible()
    }
  })

  async function mockBookingBackend(page, { createError = false } = {}) {
    let createCalls = 0
    await page.route('**/rest/v1/rpc/catalogo_reserva_publica', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ barberia: { nombre: 'Demo Booking', moneda: 'ARS', zona_horaria: 'America/Argentina/Buenos_Aires', color_principal: '#9b6a2f', direccion: 'Calle Demo 123' }, servicios: [{ id: 1, nombre: 'Corte clásico', descripcion: 'Corte y terminación', precio: 15000, duracion_min: 30 }, { id: 2, nombre: 'Barba', descripcion: 'Perfilado completo', precio: 10000, duracion_min: 30 }] }) }))
    await page.route('**/rest/v1/rpc/horarios_disponibles_reserva_publica', async (route) => {
      const request = route.request()
      const body = request.postDataJSON?.() || {}
      const slots = body.p_fecha === '2099-01-02' ? [] : [{ barbero_id: 7, barbero_nombre: 'Marta Demo', barbero_color: '#2d9464', duracion_min: 30, hora: '10:00:00' }, { barbero_id: 7, barbero_nombre: 'Marta Demo', barbero_color: '#2d9464', duracion_min: 30, hora: '10:30:00' }]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(slots) })
    })
    await page.route('**/rest/v1/rpc/crear_reserva_publica', async (route) => {
      createCalls += 1
      if (createError) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '23P01', message: 'Ese horario acaba de ocuparse. Elegí otro horario.' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ turno_id: 99, fecha: '2026-08-10', hora: '10:00:00', duracion_min: 30 }]) })
    })
    return () => createCalls
  }

  async function openMockBooking(page, options) {
    const createCalls = await mockBookingBackend(page, options)
    await page.goto('/reservar/barberia-central')
    const title = page.getByRole('heading', { name: /elegí tu próximo turno/i })
    await page.waitForTimeout(1000)
    if (!(await title.count())) test.skip(true, 'Requiere VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para montar la reserva pública.')
    await expect(title).toBeVisible()
    return createCalls
  }

  test('reserva pública guiada cubre selección, validación, dark mode y confirmación mock', async ({ page }) => {
    const createCalls = await openMockBooking(page)
    await expect(page.getByRole('button', { name: /barba.*ARS 10\.000/i })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: /barba.*ARS 10\.000/i }).click()
    await expect(page.getByRole('button', { name: /barba.*ARS 10\.000/i })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: /marta demo/i }).click()
    await page.getByRole('button', { name: '10:00' }).click()
    await page.getByLabel('Nombre y apellido').fill('Cliente Demo')
    await page.getByLabel('Teléfono').fill('1234')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(page.getByText(/ingresá tu número completo/i)).toBeVisible()
    await page.getByLabel('Teléfono').fill('11223344')
    await page.getByRole('button', { name: 'Activar modo oscuro' }).click()
    await expect(page.locator('main.public-booking')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(page.getByRole('heading', { name: /turno reservado/i })).toBeVisible()
    expect(createCalls()).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('reserva pública comunica ausencia de disponibilidad y error de ocupación', async ({ page }) => {
    await openMockBooking(page, { createError: true })
    await page.getByLabel('Fecha elegida').fill('2099-01-02')
    await expect(page.getByRole('heading', { name: /no hay profesionales disponibles/i })).toBeVisible()
    await page.getByLabel('Fecha elegida').fill('2026-08-10')
    await expect(page.getByRole('button', { name: /marta demo/i })).toBeVisible()
    await page.getByRole('button', { name: /marta demo/i }).click()
    await page.getByRole('button', { name: '10:00' }).click()
    await page.getByLabel('Nombre y apellido').fill('Cliente Demo')
    await page.getByLabel('Teléfono').fill('11223344')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(page.getByText(/horario acaba de ocuparse/i)).toBeVisible()
  })
})
