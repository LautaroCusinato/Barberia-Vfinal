// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { AUTH_PRODUCTION_ORIGIN, buildAuthRedirect, getAppOrigin, safeAuthNext } from './authRedirect.js'

const PROD = 'https://barberia.cuchitron.lat'

describe('safeAuthNext', () => {
  it('conserva rutas internas con query y hash', () => {
    expect(safeAuthNext('/panel?tab=agenda#hoy')).toBe('/panel?tab=agenda#hoy')
    expect(safeAuthNext('  /cuenta  ')).toBe('/cuenta')
    expect(safeAuthNext('/a/../b')).toBe('/b')
  })

  it.each([
    [''],
    [null],
    [undefined],
    ['panel'],
    ['https://evil.example/phish'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['/\t/evil.example'], // el parser de URL descarta tabs: quedaría //evil.example
    ['/https://evil.example'],
    ['javascript:alert(1)'],
  ])('rechaza %j (open redirect) y usa el fallback', (value) => {
    expect(safeAuthNext(value)).toBe('/ingresar')
    expect(safeAuthNext(value, '/otro')).toBe('/otro')
  })
})

describe('getAppOrigin', () => {
  it('acepta el origen de producción configurado', () => {
    vi.stubEnv('VITE_APP_BASE_URL', `${PROD}/cualquier/ruta`)
    vi.stubEnv('DEV', false)
    expect(getAppOrigin()).toBe(PROD)
    expect(AUTH_PRODUCTION_ORIGIN).toBe(PROD)
  })

  it('en desarrollo acepta un origen local configurado', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_APP_BASE_URL', 'http://127.0.0.1:5173')
    expect(getAppOrigin()).toBe('http://127.0.0.1:5173')
  })

  it('en desarrollo ignora orígenes configurados no permitidos y usa el del navegador local', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_APP_BASE_URL', 'https://evil.example')
    expect(new URL(window.location.origin).hostname).toBe('localhost')
    expect(getAppOrigin()).toBe(window.location.origin)
  })

  it('sin configuración QA nunca usa previews ni el origen del navegador', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_APP_BASE_URL', 'https://rama.barberia.pages.dev')
    expect(getAppOrigin()).toBe(PROD)
    vi.stubEnv('VITE_APP_BASE_URL', '')
    expect(getAppOrigin()).toBe(PROD)
  })

  it.each([
    'https://barberia-qa.cuchitron.lat',
    'https://fix-review-hardening.barberia-177.pages.dev',
    'https://65dfc973.barberia-177.pages.dev',
  ])('un build QA conserva el origen explícito %s aunque DEV=false', (origin) => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://cmsymmszlzikqpvfqjre.supabase.co')
    vi.stubEnv('VITE_APP_BASE_URL', origin)
    expect(getAppOrigin()).toBe(origin)
    expect(buildAuthRedirect('/auth/confirm?next=/recuperar')).toBe(`${origin}/auth/confirm?next=/recuperar`)
  })

  it.each([
    '',
    'https://ssagttjdgtypxjcgdnrw.supabase.co',
    'https://cmsymmszlzikqpvfqjre.supabase.co.evil.example',
    'https://otro-proyecto.supabase.co',
  ])('no habilita redirects QA con backend no aprobado %j', (backend) => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_SUPABASE_URL', backend)
    vi.stubEnv('VITE_APP_BASE_URL', 'https://barberia-qa.cuchitron.lat')
    expect(getAppOrigin()).toBe(PROD)
  })

  it.each([
    'https://otro.pages.dev',
    'https://rama.barberia.pages.dev',
    'https://barberia-177.pages.dev',
    'https://barberia-qa.cuchitron.lat.evil.example',
    'https://preview.barberia-177.pages.dev.evil.example',
    'https://otra.rama.barberia-177.pages.dev',
    'https://barberia-qa.cuchitron.lat:444',
    'https://rama.barberia-177.pages.dev:444',
    'https://usuario@barberia-qa.cuchitron.lat',
    'http://barberia-qa.cuchitron.lat',
    'http://rama.barberia-177.pages.dev',
    'http://localhost:5173',
  ])('un build QA tampoco acepta el origen %s', (origin) => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://cmsymmszlzikqpvfqjre.supabase.co')
    vi.stubEnv('VITE_APP_BASE_URL', origin)
    expect(getAppOrigin()).toBe(PROD)
  })

  it('no convierte automáticamente el origen del navegador en un redirect QA', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://cmsymmszlzikqpvfqjre.supabase.co')
    vi.stubEnv('VITE_APP_BASE_URL', '')
    vi.stubGlobal('window', { location: { origin: 'https://barberia-qa.cuchitron.lat' } })
    expect(getAppOrigin()).toBe(PROD)
  })

  it('ignora protocolos que no son http(s)', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_APP_BASE_URL', 'javascript:alert(1)')
    expect(getAppOrigin()).toBe(window.location.origin)
  })
})

describe('buildAuthRedirect', () => {
  it('arma la URL absoluta del callback sobre el origen permitido', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_APP_BASE_URL', '')
    expect(buildAuthRedirect()).toBe(`${PROD}/auth/confirm`)
    expect(buildAuthRedirect('/auth/confirm?next=/panel')).toBe(`${PROD}/auth/confirm?next=/panel`)
  })

  it('reemplaza rutas inseguras por /auth/confirm', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_APP_BASE_URL', '')
    expect(buildAuthRedirect('//evil.example/x')).toBe(`${PROD}/auth/confirm`)
  })
})
