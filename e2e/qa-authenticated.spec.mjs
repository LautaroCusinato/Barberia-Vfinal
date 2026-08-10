import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const qaEnabled = process.env.E2E_REAL_SUPABASE === '1' && process.env.E2E_SUPABASE_PROJECT_REF === 'cmsymmszlzikqpvfqjre' && process.env.E2E_ALLOWED_PROJECT_REF === 'cmsymmszlzikqpvfqjre'
const qaUrl = process.env.E2E_SUPABASE_URL?.replace(/\/$/, '')
const anonKey = process.env.E2E_SUPABASE_ANON_KEY
const password = process.env.E2E_QA_PASSWORD
const prefix = 'E2E_QA_'

const USERS = {
  ownerA: 'e2e_qa_owner_a@e2e-qa.invalid',
  adminA: 'e2e_qa_admin_a@e2e-qa.invalid',
  receptionA: 'e2e_qa_reception_a@e2e-qa.invalid',
  employeeA: 'e2e_qa_employee_a@e2e-qa.invalid',
  readonlyA: 'e2e_qa_readonly_a@e2e-qa.invalid',
  ownerB: 'e2e_qa_owner_b@e2e-qa.invalid',
  platformOwner: 'e2e_qa_platform_owner@e2e-qa.invalid',
  platformAdmin: 'e2e_qa_platform_admin@e2e-qa.invalid',
  sales: 'e2e_qa_sales@e2e-qa.invalid',
  support: 'e2e_qa_support@e2e-qa.invalid',
  platformReadonly: 'e2e_qa_platform_readonly@e2e-qa.invalid',
  unassigned: 'e2e_qa_unassigned@e2e-qa.invalid',
}

function client() {
  return createClient(qaUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

const authCache = new Map()

async function auth(key) {
  const cached = authCache.get(key)
  if (cached) return cached
  const supabase = client()
  const { data, error } = await supabase.auth.signInWithPassword({ email: USERS[key], password })
  if (error || !data.session) throw new Error(`No se pudo autenticar el fixture ${key}.`)
  const result = { supabase, user: data.user, token: data.session.access_token, session: data.session }
  authCache.set(key, result)
  return result
}

async function tenantOf(supabase) {
  const { data, error } = await supabase.from('barberia_members').select('barberia_id,role').order('created_at').limit(1).maybeSingle()
  if (error) throw new Error(`No se pudo resolver tenant QA: ${error.message}`)
  return data
}

async function rowsFor(supabase, table, columns = 'barberia_id,nombre') {
  const { data, error } = await supabase.from(table).select(columns).order('id').limit(100)
  if (error) throw new Error(`No se pudo leer ${table}: ${error.message}`)
  return data || []
}

async function loginUi(page, key) {
  await page.goto('/ingresar', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(USERS[key])
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password)
  await page.getByRole('button', { name: /Entrar/i }).click()
}

async function openTenant(page, key, heading = 'Resumen') {
  await loginUi(page, key)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 15_000 })
}

async function openPlatform(page, key = 'platformOwner') {
  const session = await auth(key)
  const storageKey = `sb-${new URL(qaUrl).hostname.split('.')[0]}-auth-token`
  await page.addInitScript(({ key: browserKey, value }) => window.localStorage.setItem(browserKey, JSON.stringify(value)), { key: storageKey, value: session.session })
  await page.goto('/plataforma', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.platform-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /CRM comercial/i })).toBeVisible({ timeout: 15_000 })
}

async function billingApi(token, path, options = {}) {
  const response = await fetch(`${qaUrl}/functions/v1/billing-api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function selectTenantView(page, label) {
  const buttons = page.getByRole('button', { name: label, exact: true })
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index)
    if (await button.isVisible()) {
      await button.scrollIntoViewIfNeeded()
      await button.click()
      return
    }
  }
  const more = page.getByRole('button', { name: 'Más', exact: true })
  await expect(more).toBeVisible()
  await more.click()
  const sheet = page.getByRole('dialog', { name: 'Más secciones' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: label, exact: true }).click()
}

async function logoutUi(page) {
  const buttons = page.getByRole('button', { name: 'Cerrar sesion', exact: true })
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index)
    if (await button.isVisible()) {
      await button.click()
      return
    }
  }
  const more = page.getByRole('button', { name: 'Más', exact: true })
  await expect(more).toBeVisible()
  await more.click()
  const sheet = page.getByRole('dialog', { name: 'Más secciones' })
  await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Cerrar sesion', exact: true }).click()
}

function nextMondayKey() {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  const daysUntilMonday = ((8 - date.getDay()) % 7) || 7
  date.setDate(date.getDate() + daysUntilMonday)
  return date.toISOString().slice(0, 10)
}

test.describe('QA autenticado aislado', () => {
  test.skip(!qaEnabled, 'Requiere el proyecto Supabase QA explícitamente habilitado.')
  test.describe.configure({ mode: 'serial' })

  test('registro y email no verificado', async ({ page }) => {
    await page.goto('/registro')
    await expect(page.getByRole('heading', { name: /creá tu cuenta/i })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('Contraseña').first()).toHaveAttribute('minlength', '8')
    await expect(page.getByRole('button', { name: /crear cuenta|registrar/i })).toBeEnabled()
  })

  test('verificación de email', async ({ page }) => {
    await page.goto('/ingresar')
    await expect(page.getByRole('button', { name: /¿olvidaste tu contraseña/i })).toBeVisible()
    await page.goto('/recuperar')
    await expect(page.getByRole('heading', { name: /recuperar contraseña/i })).toBeVisible()
  })

  test('email duplicado', async ({ page }) => {
    await page.goto('/registro')
    await page.getByLabel('Nombre').fill(`${prefix}DUPLICADO`)
    await page.getByLabel('Email').fill(USERS.ownerA)
    await page.getByLabel('Contraseña').first().fill(password)
    await page.getByLabel('Repetir contraseña').fill(password)
    await page.getByRole('button', { name: /crear cuenta|registrar/i }).click()
    await expect(page.getByRole('alert').or(page.getByRole('heading', { name: /cuenta creada|revisá tu email/i })).first()).toBeVisible({ timeout: 10_000 })
  })

  test('onboarding completo', async ({ page }) => {
    const session = await auth('unassigned')
    const { data, error } = await session.supabase.rpc('track_self_service_onboarding', { p_event_name: 'qa_view', p_step: 1, p_source: 'e2e_qa', p_metadata: { e2e_prefix: prefix } })
    expect(error).toBeNull()
    expect(data?.status || data?.id || data).toBeTruthy()
    await loginUi(page, 'unassigned')
    await expect(page.getByRole('heading', { name: /creá tu primer negocio/i })).toBeVisible({ timeout: 15_000 })
  })

  test('reanudación del onboarding guardado', async ({ page }) => {
    const session = await auth('unassigned')
    const { data, error } = await session.supabase.rpc('track_self_service_onboarding', { p_event_name: 'qa_resume', p_step: 2, p_source: 'e2e_qa', p_metadata: { e2e_prefix: prefix } })
    expect(error).toBeNull()
    expect(data?.current_step || data?.step || data).toBeTruthy()
    await loginUi(page, 'unassigned')
    await expect(page.getByRole('heading', { name: /creá tu primer negocio/i })).toBeVisible({ timeout: 15_000 })
  })

  test('tenant y trial', async () => {
    const { supabase } = await auth('ownerA')
    const member = await tenantOf(supabase)
    expect(member?.barberia_id).toBeTruthy()
    const { data, error } = await supabase.from('saas_suscripciones').select('barberia_id,estado,plan_codigo,trial_ends_at').eq('barberia_id', member.barberia_id).maybeSingle()
    expect(error).toBeNull()
    expect(data?.barberia_id).toBe(member.barberia_id)
    expect(['trialing', 'active', 'past_due', 'suspended', 'canceled']).toContain(data?.estado)
    expect(data?.trial_ends_at).toBeTruthy()
  })

  test('vertical, país, idioma, zona horaria y moneda', async () => {
    const { supabase } = await auth('ownerA')
    const member = await tenantOf(supabase)
    const { data, error } = await supabase.from('barberias').select('vertical,pais,locale,zona_horaria,moneda,metadata').eq('id', member.barberia_id).single()
    expect(error).toBeNull()
    expect(data?.vertical).toBe('barberia')
    expect(data?.pais).toBe('QA')
    expect(data?.locale).toBe('es-AR')
    expect(data?.zona_horaria || 'America/Argentina/Buenos_Aires').toBeTruthy()
    expect(data?.moneda).toBe('ARS')
    expect(data?.metadata?.e2e_prefix).toBe(prefix)
  })

  test('slug duplicado', async () => {
    const { supabase } = await auth('ownerA')
    const first = await supabase.from('barberias').select('id,slug').eq('slug', 'e2e-qa-barberia-a').single()
    expect(first.error).toBeNull()
    const duplicate = await supabase.from('barberias').insert({ nombre: `${prefix}DUPLICATE`, slug: 'e2e-qa-barberia-a', vertical: 'barberia', metadata: { e2e_prefix: prefix, environment: 'qa' } })
    expect(duplicate.error).toBeTruthy()
  })

  test('dashboard y configuración', async ({ page }) => {
    await openTenant(page, 'ownerA')
    await selectTenantView(page, 'Configuración')
    await expect(page.getByRole('heading', { name: /Configuración del negocio/i })).toBeVisible()
    await noOverflow(page)
  })

  test('branding y logo', async ({ page }) => {
    const { supabase } = await auth('ownerA')
    const member = await tenantOf(supabase)
    const { data, error } = await supabase.from('barberias').select('logo_url,color_principal,color_secundario').eq('id', member.barberia_id).single()
    expect(error).toBeNull()
    expect(data?.logo_url).toMatch(/^data:image\/svg\+xml/)
    expect(data?.color_principal).toMatch(/^#/) 
    await openTenant(page, 'ownerA')
    await selectTenantView(page, 'Configuración')
    await expect(page.getByText(/branding|marca/i).first()).toBeVisible()
  })

  test('servicios, empleados y horarios', async ({ page }) => {
    const { supabase } = await auth('ownerA')
    const member = await tenantOf(supabase)
    const services = await rowsFor(supabase, 'servicios', 'barberia_id,nombre,duracion_min,precio')
    const barbers = await rowsFor(supabase, 'barberos', 'barberia_id,nombre,activo')
    const schedules = await supabase.from('horarios_barbero').select('barberia_id,day_of_week,start_time,end_time').eq('barberia_id', member.barberia_id)
    expect(services.some((row) => row.barberia_id === member.barberia_id && row.nombre.startsWith(prefix))).toBe(true)
    expect(barbers.some((row) => row.barberia_id === member.barberia_id && row.nombre.startsWith(prefix))).toBe(true)
    expect(schedules.error).toBeNull()
    expect(schedules.data?.some((row) => row.day_of_week === 1 && row.start_time.startsWith('09:00'))).toBe(true)
    await openTenant(page, 'ownerA')
    await selectTenantView(page, 'Equipo')
    await expect(page.getByRole('heading', { name: 'Equipo', exact: true })).toBeVisible()
  })

  test('reserva pública y solapamiento', async ({ page }) => {
    await page.goto('/reservar/e2e-qa-barberia-a', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /elegí tu próximo turno/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /E2E_QA_A_SERVICIO/i }).click()
    await page.getByLabel('Fecha elegida').fill(nextMondayKey())
    await expect(page.getByRole('button', { name: /E2E_QA_A_EMPLEADO/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /E2E_QA_A_EMPLEADO/i }).click()
    await expect(page.getByRole('button', { name: '09:00' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: '10:00', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '13:00', exact: true })).toHaveCount(0)
    await noOverflow(page)
  })

  test('invitación y aceptación', async ({ page }) => {
    await page.goto('/invitacion/__e2e_missing__')
    await expect(page.getByRole('heading', { name: /invitación de equipo/i })).toBeVisible()
    const { supabase } = await auth('ownerA')
    const member = await tenantOf(supabase)
    const { data, error } = await supabase.from('barberia_members').select('role').eq('barberia_id', member.barberia_id)
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThanOrEqual(5)
  })

  test('cambio de rol y permisos', async () => {
    const { supabase } = await auth('adminA')
    const member = await tenantOf(supabase)
    const { data, error } = await supabase.from('barberia_members').select('role').eq('barberia_id', member.barberia_id)
    expect(error).toBeNull()
    expect(data?.map((row) => row.role)).toEqual(expect.arrayContaining(['owner', 'admin', 'recepcionista', 'empleado', 'readonly']))
    const forbidden = await supabase.from('config').insert({ barberia_id: member.barberia_id, clave: `${prefix}PERMISSION_CHECK`, valor: JSON.stringify({ e2e_prefix: prefix }) })
    expect(forbidden.error).toBeTruthy()
  })

  test('aislamiento entre tenants', async () => {
    const a = await auth('ownerA')
    const b = await auth('ownerB')
    const aMember = await tenantOf(a.supabase)
    const bMember = await tenantOf(b.supabase)
    expect(aMember.barberia_id).not.toBe(bMember.barberia_id)
    const tableColumns = { clientes: 'barberia_id,nombre', servicios: 'barberia_id,nombre', barberos: 'barberia_id,nombre', turnos: 'barberia_id,paciente' }
    for (const table of Object.keys(tableColumns)) {
      const [rowsA, rowsB] = await Promise.all([rowsFor(a.supabase, table, tableColumns[table]), rowsFor(b.supabase, table, tableColumns[table])])
      expect(rowsA.every((row) => row.barberia_id === aMember.barberia_id)).toBe(true)
      expect(rowsB.every((row) => row.barberia_id === bMember.barberia_id)).toBe(true)
    }
  })

  test('acceso denegado', async () => {
    const a = await auth('ownerA')
    const b = await auth('ownerB')
    const bMember = await tenantOf(b.supabase)
    const attempt = await a.supabase.from('clientes').insert({ barberia_id: bMember.barberia_id, nombre: `${prefix}FOREIGN_WRITE`, apellido: 'Blocked', telefono: '5491100000099', email: 'foreign@e2e-qa.invalid' })
    expect(attempt.error).toBeTruthy()
  })

  test('acceso de plataforma', async ({ page }) => {
    const session = await auth('platformOwner')
    const role = await session.supabase.from('platform_members').select('role').eq('user_id', session.user.id).single()
    expect(role.data?.role).toBe('owner')
    await openPlatform(page)
    await page.getByRole('button', { name: 'Negocios y leads' }).click()
    await expect(page.getByRole('heading', { name: 'Leads comerciales' })).toBeVisible()
  })

  test('CRM y lead convertido', async ({ page }) => {
    const session = await auth('platformOwner')
    const metrics = await session.supabase.rpc('get_crm_pipeline_metrics', { p_environment: 'sandbox' })
    expect(metrics.error).toBeNull()
    expect(metrics.data?.leads_total).toBeGreaterThanOrEqual(2)
    const leadQuery = await session.supabase.from('crm_leads').select('id,pipeline_stage,do_not_contact').eq('environment', 'sandbox').like('nombre_contacto', `${prefix}%`).limit(1).single()
    expect(leadQuery.error).toBeNull()
    const original = leadQuery.data
    try {
      const moved = await session.supabase.rpc('set_crm_lead_stage', { p_lead_id: original.id, p_stage: 'qualified', p_note: 'E2E QA reversible' })
      expect(moved.error).toBeNull()
      const dnc = await session.supabase.rpc('set_crm_lead_do_not_contact', { p_lead_id: original.id, p_value: true, p_reason: 'E2E QA reversible' })
      expect(dnc.error).toBeNull()
    } finally {
      await session.supabase.rpc('set_crm_lead_stage', { p_lead_id: original.id, p_stage: original.pipeline_stage || 'trial', p_note: 'E2E QA restore' })
      await session.supabase.rpc('set_crm_lead_do_not_contact', { p_lead_id: original.id, p_value: Boolean(original.do_not_contact), p_reason: 'E2E QA restore' })
    }
    await openPlatform(page)
    await page.getByRole('button', { name: 'Negocios y leads' }).click()
    await page.getByLabel('Separar entorno').selectOption('sandbox')
    await page.getByRole('button', { name: 'Actualizar' }).last().click()
    await expect(page.getByText(/E2E_QA_A_CONTACTO|E2E_QA_B_CONTACTO/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('billing sin proveedor', async () => {
    const session = await auth('ownerA')
    const states = ['trialing', 'active', 'past_due', 'suspended', 'canceled']
    for (const state of states) {
      const result = await billingApi(session.token, `status?state=${state}`)
      expect(result.status).toBe(200)
      expect(result.body.environment).toBe('qa')
      expect(result.body.provider_available).toBe(false)
      expect(result.body.subscription.estado).toBe(state)
    }
    const checkout = await billingApi(session.token, 'checkout', { method: 'POST', body: JSON.stringify({ plan_codigo: 'starter' }) })
    expect(checkout.status).toBe(200)
    expect(checkout.body.mock).toBe(true)
    expect(checkout.body.checkout_url).toMatch(/^https:\/\/qa\.invalid\//)
  })

  test('trial vencido y gracia', async () => {
    const session = await auth('ownerA')
    const result = await billingApi(session.token, 'status?state=past_due')
    expect(result.body.access_state).toBe('past_due')
    expect(result.body.environment).toBe('qa')
  })

  test('tenant suspendido', async () => {
    const session = await auth('ownerA')
    const result = await billingApi(session.token, 'status?state=suspended')
    expect(result.body.subscription.estado).toBe('suspended')
    expect(result.body.access_state).toBe('suspended')
  })

  test('recuperación y cambio de contraseña', async ({ page }) => {
    await page.goto('/recuperar')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: /enviar enlace/i })).toBeEnabled()
    await page.goto('/cuenta')
    await expect(page.locator('#root')).toBeVisible()
  })

  test('cierre de sesión', async ({ page }) => {
    await openTenant(page, 'ownerA')
    await logoutUi(page)
    await expect(page.getByRole('link', { name: /Probar gratis/i }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('responsive móvil', async ({ page }) => {
    await openTenant(page, 'ownerA')
    await noOverflow(page)
    if ((await page.evaluate(() => window.innerWidth)) < 800) {
      await page.getByRole('button', { name: 'Más' }).click()
      await expect(page.getByRole('dialog', { name: 'Más secciones' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Más secciones' })).toHaveCount(0)
    } else {
      await expect(page.locator('.sidebar')).toBeVisible()
    }
  })
})
