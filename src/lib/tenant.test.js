import { describe, expect, it, vi } from 'vitest'
import { VERTICALS, getVerticalProfile, normalizeVertical, parseTenantId, tenantStorageKey } from './tenant.js'

describe('parseTenantId', () => {
  it('acepta enteros positivos en número o texto', () => {
    expect(parseTenantId(5)).toBe(5)
    expect(parseTenantId('42')).toBe(42)
  })

  it('usa el fallback para valores vacíos, cero, negativos o no numéricos', () => {
    expect(parseTenantId(undefined)).toBe(1)
    expect(parseTenantId(null)).toBe(1)
    expect(parseTenantId('')).toBe(1)
    expect(parseTenantId(0)).toBe(1)
    expect(parseTenantId('-3')).toBe(1)
    expect(parseTenantId('abc')).toBe(1)
    expect(parseTenantId('abc', 9)).toBe(9)
  })
})

describe('normalizeVertical / getVerticalProfile', () => {
  it('normaliza mayúsculas y espacios', () => {
    expect(normalizeVertical(' Spa ')).toBe('spa')
    expect(normalizeVertical('BARBERIA')).toBe('barberia')
  })

  it('cae en custom para valores desconocidos, incluso claves heredadas del prototipo', () => {
    expect(normalizeVertical('panaderia')).toBe('custom')
    expect(normalizeVertical('')).toBe('custom')
    expect(normalizeVertical(null)).toBe('custom')
    expect(normalizeVertical('toString')).toBe('custom')
    expect(normalizeVertical('__proto__')).toBe('custom')
  })

  it('devuelve las etiquetas del rubro', () => {
    expect(getVerticalProfile('gimnasio')).toMatchObject({ customerLabel: 'socios', appointmentLabel: 'reservas' })
    expect(getVerticalProfile('clinica').customerLabel).toBe('pacientes')
    expect(getVerticalProfile('desconocido')).toBe(VERTICALS.custom)
  })

  it('el catálogo de rubros es inmutable', () => {
    expect(Object.isFrozen(VERTICALS)).toBe(true)
  })
})

describe('tenantStorageKey', () => {
  it('aísla las claves por negocio y sanea el nombre', () => {
    expect(tenantStorageKey('agenda-view', 12)).toBe('tenant-12-agenda-view')
    expect(tenantStorageKey('filtros/agenda:hoy', '7')).toBe('tenant-7-filtros-agenda-hoy')
    expect(tenantStorageKey('vista', 'no-valido')).toBe('tenant-1-vista')
  })
})

describe('getRuntimeTenant (variables VITE_*)', () => {
  async function cargarConEnv(env) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    vi.resetModules()
    return import('./tenant.js')
  }

  it('usa valores por defecto sin configuración', async () => {
    const tenant = await cargarConEnv({ VITE_BARBERIA_ID: '', VITE_BUSINESS_NAME: '', VITE_BUSINESS_VERTICAL: '', VITE_PRODUCT_NAME: '' })
    expect(tenant.getRuntimeTenant()).toEqual({
      id: 1,
      name: 'Barbería Central',
      vertical: 'barberia',
      productName: 'Agenda',
      profile: VERTICALS.barberia,
    })
    expect(tenant.tenantStorageKey('x')).toBe('tenant-1-x')
  })

  it('respeta la configuración del despliegue', async () => {
    const tenant = await cargarConEnv({ VITE_BARBERIA_ID: '42', VITE_BUSINESS_NAME: 'Spa Sur', VITE_BUSINESS_VERTICAL: 'Spa', VITE_PRODUCT_NAME: 'Austral' })
    expect(tenant.getRuntimeTenant()).toMatchObject({ id: 42, name: 'Spa Sur', vertical: 'spa', productName: 'Austral' })
    expect(tenant.getRuntimeTenant().profile.serviceLabel).toBe('tratamientos')
    expect(tenant.tenantStorageKey('x')).toBe('tenant-42-x')
  })
})
