import { test, expect } from '@playwright/test'

async function clickWorkspaceButton(page, view) {
  const labels = { Operacion: 'Operación', Facturacion: 'Facturación' }
  const visibleLabel = labels[view] || view
  const titles = { Agenda: 'Agenda', Equipo: 'Equipo', Mensajes: 'Mensajes', Clientes: 'Clientes', Notas: 'Notas', Estadísticas: 'Estadísticas', Operacion: 'Operación', Configuración: 'Configuración del negocio', Facturacion: 'Facturación' }
  const targetHeading = titles[view] ? page.getByRole('heading', { name: titles[view], exact: true }) : null
  if (targetHeading) {
    try {
      await expect(targetHeading).toBeVisible({ timeout: 1_000 })
      return
    } catch {
      // The workspace is still on its default summary view; navigate below.
    }
  }
  // After a reload the demo restores the last persisted view, so the
  // summary heading is not a reliable readiness signal. The demo banner is
  // present on every workspace view and confirms that the shell is mounted.
  await expect(page.getByText('Modo demostración', { exact: true })).toBeVisible({ timeout: 30_000 })
  const directButton = page.getByRole('button', { name: visibleLabel, exact: true }).filter({ visible: true })
  if (await directButton.count()) return directButton.first().click()
  const desktopSidebar = page.locator('.sidebar')
  if (await desktopSidebar.isVisible().catch(() => false)) {
    const directButton = desktopSidebar.locator('.nav-item').filter({ hasText: visibleLabel }).first()
    await directButton.scrollIntoViewIfNeeded()
    return directButton.click()
  }
  await page.getByRole('button', { name: 'Más', exact: true }).click()
  return page.locator('.mobile-mas-sheet').getByRole('button', { name: visibleLabel, exact: true }).click()
}

async function openDemo(page, view = null) {
  await page.goto('/demo', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible({ timeout: 30_000 })
  if (view) {
    await clickWorkspaceButton(page, view)
    const titles = { Facturacion: 'Facturación', Operacion: 'Configuración de agenda', Configuración: 'Configuración del negocio' }
    if (view !== 'Operacion') await expect(page.getByRole('heading', { name: titles[view] || view })).toBeVisible({ timeout: 10_000 })
  }
}

async function resetDemo(page) {
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /reiniciar demo/i }).click()
  await expect(page.getByText('Modo demostración')).toBeVisible({ timeout: 30_000 })
}

async function selectFirstAvailableTime(page) {
  const time = page.getByRole('dialog').locator('button:not([disabled])').filter({ hasText: /^\d{2}:\d{2}$/ }).first()
  await expect(time).toBeVisible()
  await time.click()
}

async function createDemoTurn(page, name = 'Cliente E2E Demo') {
  await openDemo(page, 'Agenda')
  await page.getByRole('button', { name: 'Nuevo turno', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Corte clásico 35 min/i }).click()
  await selectFirstAvailableTime(page)
  await page.getByPlaceholder('Buscar por nombre o teléfono...').fill(name)
  await page.getByRole('button', { name: 'Crear nuevo cliente' }).click()
  await page.getByRole('textbox', { name: 'Nombre y apellido', exact: true }).fill(name)
  await page.getByPlaceholder('0000-0000').fill('12345678')
  await page.getByRole('button', { name: 'Agendar turno', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo turno' })).toHaveCount(0)
  await expect.poll(() => page.evaluate((expectedName) => Object.values(localStorage).some((raw) => raw?.includes(expectedName)), name)).toBe(true)
}

test.describe('experiencia de producto demo', () => {
  test.describe.configure({ timeout: 60_000 })
  test('DEMO-01 landing → probar demo', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /ver cómo funciona/i }).click()
    await expect(page).toHaveURL(/\/demo$/)
    // The demo shell is a lazy route. Use the same readiness window as the
    // shared openDemo helper so a cold CI chunk load is not mistaken for a
    // product failure.
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible({ timeout: 30_000 })
  })

  test('DEMO-02 entra sin login', async ({ page }) => {
    await openDemo(page)
    await expect(page.getByRole('heading', { name: /iniciar sesión|ingresar/i })).toHaveCount(0)
  })

  test('DEMO-03 muestra el panel real y la marca demo', async ({ page }) => {
    await openDemo(page)
    if (await page.locator('.sidebar').isVisible().catch(() => false)) {
      await expect(page.getByText('Barbería Demo Austral')).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: 'Más', exact: true })).toBeVisible()
    }
    await expect(page.getByRole('navigation')).toBeVisible()
    await expect(page.getByText('Modo demostración')).toBeVisible()
  })

  test('DEMO-04 Agenda tiene datos relativos a hoy', async ({ page }) => {
    await openDemo(page, 'Agenda')
    await expect(page.getByText(/turnos en total/i)).toBeVisible()
    const desktopCalendar = page.locator('.calendar-grid')
    if (await desktopCalendar.isVisible().catch(() => false)) {
      await expect(page.getByRole('gridcell').filter({ hasText: /^\d+$/ }).first()).toBeVisible()
    } else {
      await expect(page.locator('.calendar-mobile-days .calendar-mobile-day').first()).toBeVisible()
    }
    expect(await page.evaluate(() => document.body.innerText.includes(String(new Date().getFullYear())))).toBe(true)
  })

  test('DEMO-05 permite crear un turno temporal', async ({ page }) => {
    await createDemoTurn(page)
  })

  test('DEMO-06 permite editar un turno temporal', async ({ page }) => {
    await openDemo(page, 'Agenda')
    const edit = page.getByRole('article', { name: /Elena Sosa/ }).getByRole('button', { name: 'Editar turno' })
    await edit.click()
    await page.getByPlaceholder('Opcional (ej: con tijera, sin lavar)').fill('Nota editada en demo')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await expect(page.getByText('Nota editada en demo', { exact: true })).toBeVisible()
  })

  test('DEMO-07 permite cancelar un turno sin borrar datos reales', async ({ page }) => {
    await openDemo(page, 'Agenda')
    await page.getByRole('button', { name: /Marcar como faltó o cancelado/ }).first().click()
    await expect(page.getByRole('article').first()).toContainText(/No asistió|Cancelado/i)
  })

  test('DEMO-08 permite crear clientes ficticios', async ({ page }) => {
    await openDemo(page, 'Clientes')
    await page.getByRole('button', { name: 'Agregar', exact: true }).click()
    await page.getByPlaceholder('Ej: Juan Pérez').fill('Cliente creado E2E')
    await page.getByPlaceholder('0000-0000').fill('12345678')
    await page.getByRole('button', { name: 'Agregar cliente', exact: true }).click()
    const desktopRow = page.getByRole('row', { name: /Cliente creado E2E/ })
    if (await desktopRow.isVisible().catch(() => false)) {
      await expect(desktopRow).toBeVisible()
    } else {
      await expect(page.locator('.client-mobile-card').filter({ hasText: 'Cliente creado E2E' })).toBeVisible()
    }
  })

  test('DEMO-09 permite editar clientes ficticios', async ({ page }) => {
    await openDemo(page, 'Clientes')
    const row = page.getByRole('row', { name: /Agustín Molina/ })
    const card = page.locator('.client-mobile-card').filter({ hasText: 'Agustín Molina' })
    if (await row.isVisible().catch(() => false)) await row.getByRole('button', { name: 'Editar cliente' }).click()
    else await card.getByRole('button', { name: 'Editar cliente' }).click()
    const dialog = page.locator('.modal-box').last()
    await dialog.locator('input').first().fill('Agustín Demo Editado')
    await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    const editedRow = page.getByRole('row', { name: /Agustín Demo Editado/ })
    if (await editedRow.isVisible().catch(() => false)) await expect(editedRow).toBeVisible()
    else await expect(page.locator('.client-mobile-card').filter({ hasText: 'Agustín Demo Editado' })).toBeVisible()
  })

  test('DEMO-10 permite editar un servicio ficticio', async ({ page }) => {
    await openDemo(page, 'Operacion')
    const field = page.getByRole('textbox', { name: 'Nombre del servicio *', exact: true }).first()
    await field.fill('Corte clásico demo')
    await field.press('Tab')
    await page.reload()
    await clickWorkspaceButton(page, 'Operacion')
    await expect(page.getByRole('textbox', { name: 'Nombre del servicio *', exact: true }).first()).toHaveValue('Corte clásico demo')
  })

  test('DEMO-11 permite cambiar configuración local', async ({ page }) => {
    await openDemo(page, 'Configuración')
    await page.getByLabel('Nombre comercial').fill('Barbería Demo Personalizada')
    await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /Configuración demo guardada/i })).toBeVisible()
    await expect(page.getByLabel('Nombre comercial')).toHaveValue('Barbería Demo Personalizada')
  })

  test('DEMO-12 conserva cambios al recargar', async ({ page }) => {
    await openDemo(page, 'Configuración')
    await page.getByLabel('Nombre comercial').fill('Demo Persistente')
    await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click()
    await page.reload()
    await clickWorkspaceButton(page, 'Configuración')
    await expect(page.getByLabel('Nombre comercial')).toHaveValue('Demo Persistente')
  })

  test('DEMO-13 reset restaura el seed', async ({ page }) => {
    await openDemo(page, 'Configuración')
    await page.getByLabel('Nombre comercial').fill('Cambio temporal')
    await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click()
    await resetDemo(page)
    await clickWorkspaceButton(page, 'Configuración')
    await expect(page.getByLabel('Nombre comercial')).toHaveValue('Barbería Demo Austral')
  })

  test('DEMO-14 Billing es informativo y no inicia checkout', async ({ page }) => {
    await openDemo(page, 'Facturacion')
    await expect(page.getByText(/15 días de prueba/i)).toBeVisible()
    await expect(page.locator('.billing-plan')).toHaveCount(1)
    await expect(page.locator('.billing-plan h3', { hasText: 'Austral' })).toHaveCount(1)
    await expect(page.getByText(/ARS 50\.000/)).toBeVisible()
    await expect(page.getByText(/\b(?:Starter|Pro|Premium)\b/i)).toHaveCount(0)
    await expect(page.locator('.billing-notice').filter({ hasText: /continuidad se coordina manualmente por WhatsApp/i })).toBeVisible()
    await expect(page.getByText(/Elegí cómo pagar/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Empezar prueba gratuita con Starter/i })).toHaveCount(0)
  })

  test('DEMO-15 WhatsApp queda bloqueado con CTA comercial', async ({ page }) => {
    await openDemo(page)
    const whatsappToggle = page.getByRole('button', { name: /WhatsApp disponible al crear tu cuenta/i })
    if (!(await whatsappToggle.isVisible().catch(() => false))) test.skip(true, 'El control de WhatsApp vive en el sidebar desktop.')
    await whatsappToggle.click()
    await expect(page.getByRole('heading', { name: 'Facturación' })).toBeVisible()
    await expect(page.getByText(/WhatsApp está disponible al crear tu cuenta/i)).toBeVisible()
  })

  test('DEMO-16 Plataforma no abre un workspace autenticado', async ({ page }) => {
    await page.goto('/plataforma', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /panel de plataforma/i })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Resumen' })).toHaveCount(0)
  })

  test('DEMO-17 no realiza mutaciones a Supabase', async ({ page }) => {
    const mutations = []
    page.on('request', (request) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && /supabase/i.test(request.url())) mutations.push(request.url())
    })
    await createDemoTurn(page, 'Cliente sin Supabase')
    await expect.poll(() => mutations.length).toBe(0)
  })

  test('DEMO-18 mobile 390 mantiene navegación y no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDemo(page)
    await expect(page.getByRole('button', { name: 'Más', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('DEMO-19 soporta dark mode', async ({ page }) => {
    await openDemo(page)
    const themeButton = page.getByRole('button', { name: /Modo (oscuro|claro)/ })
    if (await themeButton.isVisible().catch(() => false)) await themeButton.click()
    else {
      await page.getByRole('button', { name: 'Más', exact: true }).click()
      await page.getByRole('button', { name: /Modo (oscuro|claro)/ }).click()
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
  })

  test('DEMO-20 CTA Crear mi cuenta lleva al registro', async ({ page }) => {
    await openDemo(page)
    await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click()
    await expect(page).toHaveURL(/\/registro\?source=demo$/)
    await expect(page.getByRole('heading', { name: /creá tu cuenta/i })).toBeVisible()
  })

  test('DEMO-21 sesiones demo separadas no comparten cambios', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()
    await openDemo(pageA, 'Configuración')
    await pageA.getByLabel('Nombre comercial').fill('Demo Visitante A')
    await pageA.getByRole('button', { name: 'Guardar configuración', exact: true }).click()
    await openDemo(pageB, 'Configuración')
    await expect(pageB.getByLabel('Nombre comercial')).toHaveValue('Barbería Demo Austral')
    await contextA.close()
    await contextB.close()
  })

  test('DEMO-22 conserva la vista al recargar y permite volver con el navegador', async ({ page }) => {
    await openDemo(page, 'Agenda')
    await expect(page).toHaveURL(/\/demo\?view=agenda$/)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/demo$/)
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
  })
})
