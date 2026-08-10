import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PROD_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const root = process.cwd()
const outputPath = path.join(root, 'docs', 'performance-sprint8', process.env.PERF_OUTPUT || 'baseline.json')
const baseURL = process.env.PERF_BASE_URL || 'http://127.0.0.1:4173'
const viewport = { width: Number(process.env.PERF_WIDTH || 390), height: Number(process.env.PERF_HEIGHT || 844) }

function readLocalEnv() {
  const file = path.join(root, '.env.e2e.local')
  if (!fs.existsSync(file)) return {}
  const values = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/)
    if (!match) continue
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

function assertQA(env) {
  const projectRef = env.E2E_SUPABASE_PROJECT_REF || ''
  const url = env.E2E_SUPABASE_URL || ''
  if (projectRef !== QA_PROJECT_REF || projectRef === PROD_PROJECT_REF || !url.startsWith(`https://${QA_PROJECT_REF}.supabase.co`)) {
    throw new Error('Performance QA guard blocked: only the isolated QA project is allowed.')
  }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Performance server did not start at ${url}.`)
}

async function sessionForQA(env) {
  const client = createClient(env.E2E_SUPABASE_URL, env.E2E_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email: 'e2e_qa_owner_a@e2e-qa.invalid', password: env.E2E_QA_PASSWORD })
  if (error || !data.session) throw new Error(`Performance QA owner session could not be created (${error?.status || 'unknown'}).`)
  return data.session
}

async function measureRoute(browser, route, session, supabaseUrl) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  if (session) {
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: session })
  }
  const requests = []
  const responses = []
  page.on('request', (request) => requests.push({ url: request.url().split('?')[0], resource: request.resourceType(), method: request.method() }))
  page.on('response', async (response) => {
    const request = response.request()
    if (!['script', 'stylesheet', 'image', 'font'].includes(request.resourceType())) return
    const headers = response.headers()
    const length = Number(headers['content-length']) || null
    responses.push({ url: response.url().split('?')[0], resource: request.resourceType(), status: response.status(), bytes: length })
  })
  await page.addInitScript(() => {
    window.__perf = { lcp: null, cls: 0, inp: null, mutations: 0 }
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1]
        if (last) window.__perf.lcp = last.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__perf.cls += entry.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1)
        if (last) window.__perf.inp = last.duration
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
    } catch {
      // Older browsers may not expose every observer type.
    }
    new MutationObserver(() => { window.__perf.mutations += 1 }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  const navigationResponse = await page.goto(new URL(route.path, baseURL).toString(), { waitUntil: 'load' })
  await page.waitForTimeout(Number(process.env.PERF_SETTLE_MS || 1200))
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0]
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]))
    return {
      domContentLoaded: navigation?.domContentLoadedEventEnd || null,
      loadEvent: navigation?.loadEventEnd || null,
      ttfb: navigation?.responseStart || null,
      firstPaint: paints['first-paint'] || null,
      firstContentfulPaint: paints['first-contentful-paint'] || null,
      ...window.__perf,
    }
  })
  const urls = requests.map((request) => request.url)
  const duplicateRequests = urls.filter((url, index) => urls.indexOf(url) !== index)
  const assetBytes = responses.reduce((sum, response) => sum + (response.bytes || 0), 0)
  await context.close()
  return {
    route: route.name,
    path: route.path,
    authenticated: Boolean(session),
    status: navigationResponse?.status() || null,
    requests: requests.length,
    duplicate_requests: duplicateRequests.length,
    asset_bytes_from_headers: assetBytes || null,
    js_requests: requests.filter((request) => request.resource === 'script').length,
    css_requests: requests.filter((request) => request.resource === 'stylesheet').length,
    metrics,
  }
}

async function main() {
  const env = process.env.PERF_SKIP_LOCAL === '1' ? { ...process.env } : { ...process.env, ...readLocalEnv() }
  assertQA(env)
  if (!env.E2E_QA_PASSWORD || !env.E2E_SUPABASE_ANON_KEY) throw new Error('Performance QA credentials are missing from the local file.')
  const session = await sessionForQA(env)
  const routes = [
    { name: 'landing-barberia', path: '/para/barberia' },
    { name: 'public-booking', path: '/reservar/e2e-qa-barberia-a' },
    { name: 'login', path: '/ingresar' },
    { name: 'dashboard-authenticated', path: '/' },
  ].filter((route) => !process.env.PERF_ROUTES || process.env.PERF_ROUTES.split(',').includes(route.name))
  const viteEnv = { ...process.env, VITE_SUPABASE_URL: env.E2E_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: env.E2E_SUPABASE_ANON_KEY }
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const serverArgs = process.env.PERF_SERVER === 'dev'
    ? [viteBin, '--host', '127.0.0.1', '--port', '4173']
    : [viteBin, 'preview', '--host', '127.0.0.1', '--port', '4173']
  const server = spawn(process.execPath, serverArgs, { cwd: root, env: viteEnv, stdio: 'ignore' })
  try {
    await waitForServer(baseURL)
    const browser = await chromium.launch({ headless: true })
    const results = []
    for (const route of routes) results.push(await measureRoute(browser, route, route.name === 'dashboard-authenticated' ? session : null, env.E2E_SUPABASE_URL))
    await browser.close()
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, `${JSON.stringify({ generated_at: new Date().toISOString(), project_ref: QA_PROJECT_REF, viewport, results }, null, 2)}\n`)
    console.log(JSON.stringify({ output: path.relative(root, outputPath), routes: results.length, project_ref: QA_PROJECT_REF }, null, 2))
  } finally {
    server.kill()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Performance measurement failed.')
  process.exitCode = 1
})
