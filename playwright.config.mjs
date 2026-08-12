import { defineConfig, devices } from '@playwright/test'
import { getQaConfig, printGuardError } from './scripts/e2e-sandbox-guards.mjs'

const qaRequested = process.env.E2E_REAL_SUPABASE !== undefined || process.env.E2E_SUPABASE_PROJECT_REF !== undefined
if (qaRequested) {
  try {
    getQaConfig({ checkViteRuntime: true })
  } catch (error) {
    printGuardError(error)
    throw error
  }
}

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173'
const publicTestEnv = {
  ...process.env,
  // Deterministic public tests use route mocks; these placeholders never
  // contact a real Supabase project and are replaced by QA env when enabled.
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://e2e-public.invalid.supabase.co',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'e2e-public-anon-placeholder',
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // QA fixtures intentionally mutate and restore the same isolated users and
  // tenants. Keep that suite deterministic; public tests remain parallel.
  fullyParallel: !qaRequested,
  workers: qaRequested ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: publicTestEnv,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-390', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'mobile-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } } },
    { name: 'mobile-412', use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 915 } } },
    { name: 'mobile-430', use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 } } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1366', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'desktop-1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
  ],
})
