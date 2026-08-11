import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { getQaConfig, printGuardError } from './e2e-sandbox-guards.mjs'

try {
  getQaConfig({ checkViteRuntime: true })
} catch (error) {
  printGuardError(error)
  process.exitCode = 2
  process.exit()
}

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4174'
const qaHost = new URL(process.env.E2E_SUPABASE_URL).hostname
const productionHost = 'ssagttjdgtypxjcgdnrw.supabase.co'
const screenshotsDir = 'docs/authenticated-qa'
await fs.mkdir(screenshotsDir, { recursive: true })

const browser = await chromium.launch()
const observations = []

async function runOwnerFlow(viewport, theme = 'light') {
  const page = await browser.newPage({ viewport })
  await page.emulateMedia({ colorScheme: theme })
  const consoleErrors = []
  const failedRequests = []
  const forbiddenRequests = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240))
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(new URL(request.url()).pathname)
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname === productionHost || (url.hostname.endsWith('.supabase.co') && url.hostname !== qaHost)) forbiddenRequests.push(url.hostname)
  })

  await page.goto(`${baseUrl}/ingresar`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill('e2e_qa_owner_a@e2e-qa.invalid')
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(process.env.E2E_QA_PASSWORD)
  await page.getByRole('button', { name: /^entrar$/i }).click()
  await page.getByRole('heading', { name: 'Resumen' }).waitFor({ state: 'visible' })
  await page.screenshot({ path: `${screenshotsDir}/owner-a-dashboard-${viewport.width}-${theme}.png`, fullPage: true })

  const openMoreIfMobile = async () => {
    const more = page.getByRole('button', { name: /^Más$/i })
    if (await more.count() && await more.first().isVisible()) await more.first().click()
  }
  const sections = [
    ['Agenda', 'Agenda'],
    ['Clientes', 'Clientes'],
    ['Equipo', 'Equipo'],
    ['Operacion', 'Operacion'],
    ['Configuración', 'Configuración del negocio'],
    ['Facturacion', 'Facturación'],
  ]
  const visited = []
  for (const [buttonLabel, heading] of sections) {
    const direct = page.getByRole('button', { name: new RegExp(`^${buttonLabel}$`, 'i') }).filter({ visible: true })
    if (await direct.count()) {
      await direct.first().click()
    } else {
      await openMoreIfMobile()
      await page.getByRole('button', { name: new RegExp(`^${buttonLabel}$`, 'i') }).click()
    }
    await page.getByRole('heading', { name: new RegExp(heading, 'i') }).waitFor({ state: 'visible' })
    visited.push(buttonLabel)
  }
  if (theme === 'dark') {
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    await page.screenshot({ path: `${screenshotsDir}/owner-a-settings-${viewport.width}-dark.png`, fullPage: true })
  }
  observations.push({ role: 'tenant owner A', viewport: `${viewport.width}x${viewport.height}`, visited, console_errors: consoleErrors, failed_requests: failedRequests, forbidden_supabase_hosts: forbiddenRequests })
  await page.close()
}

async function runPlatformFlow(viewport) {
  const page = await browser.newPage({ viewport })
  const consoleErrors = []
  const failedRequests = []
  const forbiddenRequests = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240)) })
  page.on('requestfailed', (request) => { failedRequests.push(new URL(request.url()).pathname) })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname === productionHost || (url.hostname.endsWith('.supabase.co') && url.hostname !== qaHost)) forbiddenRequests.push(url.hostname)
  })
  await page.goto(`${baseUrl}/ingresar`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill('e2e_qa_platform_owner@e2e-qa.invalid')
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(process.env.E2E_QA_PASSWORD)
  await page.getByRole('button', { name: /^entrar$/i }).click()
  await page.waitForTimeout(1_000)
  await page.goto(`${baseUrl}/plataforma`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /CRM comercial/i }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /negocios y leads/i }).click()
  await page.getByText(/Leads comerciales/i).waitFor({ state: 'visible' })
  await page.screenshot({ path: `${screenshotsDir}/platform-owner-${viewport.width}.png`, fullPage: true })
  await page.getByRole('button', { name: /cerrar sesión/i }).click().catch(() => {})
  observations.push({ role: 'platform owner QA', viewport: `${viewport.width}x${viewport.height}`, platform_checked: true, console_errors: consoleErrors, failed_requests: failedRequests, forbidden_supabase_hosts: forbiddenRequests })
  await page.close()
}

async function runBookingFlow(viewport) {
  const page = await browser.newPage({ viewport })
  const consoleErrors = []
  const failedRequests = []
  const forbiddenRequests = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240)) })
  page.on('requestfailed', (request) => { failedRequests.push(new URL(request.url()).pathname) })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname === productionHost || (url.hostname.endsWith('.supabase.co') && url.hostname !== qaHost)) forbiddenRequests.push(url.hostname)
  })
  await page.goto(`${baseUrl}/reservar/e2e-qa-barberia-a`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /elegí tu próximo turno/i }).waitFor({ state: 'visible' })
  await page.screenshot({ path: `${screenshotsDir}/booking-qa-${viewport.width}.png`, fullPage: true })
  observations.push({ role: 'public booking QA', viewport: `${viewport.width}x${viewport.height}`, booking_catalog_visible: true, console_errors: consoleErrors, failed_requests: failedRequests, forbidden_supabase_hosts: forbiddenRequests })
  await page.close()
}

await runOwnerFlow({ width: 1366, height: 768 })
await runOwnerFlow({ width: 390, height: 844 }, 'dark')
await runPlatformFlow({ width: 1366, height: 768 })
await runBookingFlow({ width: 390, height: 844 })
await browser.close()

const safeObservations = observations.map((item) => ({ ...item, console_errors: item.console_errors.slice(0, 8), failed_requests: item.failed_requests.slice(0, 8), forbidden_supabase_hosts: item.forbidden_supabase_hosts.slice(0, 8) }))
console.log(JSON.stringify({ qa_host: qaHost, production_host_contacted: safeObservations.some((item) => item.forbidden_supabase_hosts.includes(productionHost)), observations: safeObservations }, null, 2))
