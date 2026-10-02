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

  it('en desarrollo acepta un origen local o un preview de Pages configurado', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_APP_BASE_URL', 'http://127.0.0.1:5173')
    expect(getAppOrigin()).toBe('http://127.0.0.1:5173')
    vi.stubEnv('VITE_APP_BASE_URL', 'https://rama.barberia.pages.dev')
    expect(getAppOrigin()).toBe('https://rama.barberia.pages.dev')
  })

  it('en desarrollo ignora orígenes configurados no permitidos y usa el del navegador local', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_APP_BASE_URL', 'https://evil.example')
    expect(new URL(window.location.origin).hostname).toBe('localhost')
    expect(getAppOrigin()).toBe(window.location.origin)
  })

  it('fuera de desarrollo nunca usa previews ni el origen del navegador: cae a producción', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_APP_BASE_URL', 'https://rama.barberia.pages.dev')
    expect(getAppOrigin()).toBe(PROD)
    vi.stubEnv('VITE_APP_BASE_URL', '')
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
