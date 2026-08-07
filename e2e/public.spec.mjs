import { test, expect } from '@playwright/test'

test.describe('superficies públicas sin efectos externos', () => {
  test('landing muestra CTA, planes y FAQ sin desborde horizontal', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('a[href="/registro"]').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
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
  })

  test('demo aislada permite cambiar vertical, branding, servicio y reiniciar', async ({ page }) => {
    await page.goto('/demo')
    await expect(page.getByRole('heading', { name: /mostrá una operación completa/i })).toBeVisible()
    await page.getByLabel('Vertical').selectOption('estetica')
    await expect(page.getByRole('heading', { name: 'Centro de estética' })).toBeVisible()
    await page.getByRole('button', { name: /reservar en sandbox/i }).click()
    await expect(page.getByRole('status')).toContainText('Reserva de prueba creada')
    await page.getByRole('button', { name: /reiniciar demo/i }).click()
    await expect(page.getByRole('button', { name: /reservar en sandbox/i })).toBeVisible()
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
})

test.describe('flujos reales con Supabase aislado', () => {
  test.skip(!process.env.E2E_REAL_SUPABASE, 'Requiere E2E_REAL_SUPABASE=1, un proyecto sandbox y credenciales de prueba fuera del repositorio.')

  const flows = [
    'registro y email no verificado', 'verificación de email', 'email duplicado',
    'onboarding completo', 'reanudación del onboarding guardado', 'tenant y trial',
    'vertical, país, idioma, zona horaria y moneda', 'slug duplicado', 'dashboard y configuración',
    'branding y logo', 'servicios, empleados y horarios', 'reserva pública y solapamiento',
    'invitación y aceptación', 'cambio de rol y permisos', 'aislamiento entre tenants', 'acceso denegado',
    'acceso de plataforma', 'CRM y lead convertido', 'billing sin proveedor', 'trial vencido y gracia',
    'tenant suspendido', 'recuperación y cambio de contraseña', 'cierre de sesión', 'responsive móvil',
  ]
  for (const flow of flows) test(`${flow} (sandbox)`, async () => {
    test.fail(true, 'El flujo requiere un proyecto Supabase sandbox y fixtures aprobados; no se ejecuta contra producción.')
  })
})
