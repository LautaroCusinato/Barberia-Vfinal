import { describe, expect, it, vi } from 'vitest'
import {
  COMMERCIAL_CATALOG,
  COMMERCIAL_MONTHLY_PRICE,
  COMMERCIAL_PLAN_CODE,
  COMMERCIAL_TRIAL_DAYS,
  TRIAL_CONTINUATION_MESSAGE,
  buildWhatsAppHref,
  catalogPlan,
  getSalesWhatsAppMessage,
  getTrialContinuationWhatsAppMessage,
  normalizeCommercialBillingMode,
} from './commercialCatalog.js'
import { recommendPrice } from './pricingAssistant.js'

describe('catálogo comercial', () => {
  it('publica un único plan mensual en pesos con 15 días de prueba', () => {
    expect(COMMERCIAL_CATALOG).toHaveLength(1)
    expect(COMMERCIAL_CATALOG[0]).toMatchObject({
      codigo: 'starter',
      nombre: 'Austral',
      precio_mensual: 50000,
      moneda: 'ARS',
      periodicidad: 'monthly',
      trial_dias: 15,
    })
    expect(COMMERCIAL_MONTHLY_PRICE).toBe(50000)
    expect(COMMERCIAL_TRIAL_DAYS).toBe(15)
  })

  it('es inmutable', () => {
    expect(Object.isFrozen(COMMERCIAL_CATALOG)).toBe(true)
    expect(Object.isFrozen(COMMERCIAL_CATALOG[0])).toBe(true)
  })

  it('catalogPlan cae en el plan vigente para códigos desconocidos', () => {
    expect(catalogPlan(COMMERCIAL_PLAN_CODE)).toBe(COMMERCIAL_CATALOG[0])
    expect(catalogPlan('pro')).toBe(COMMERCIAL_CATALOG[0])
    expect(catalogPlan()).toBe(COMMERCIAL_CATALOG[0])
  })

  it('el mensaje de ventas usa precio y prueba del catálogo', () => {
    expect(getSalesWhatsAppMessage()).toBe('Hola! Quiero conocer Austral: 15 días gratis y luego $50.000 mensuales.')
    expect(getSalesWhatsAppMessage({ codigo: 'inexistente' })).toBe(getSalesWhatsAppMessage())
    expect(getTrialContinuationWhatsAppMessage()).toBe(TRIAL_CONTINUATION_MESSAGE)
  })
})

describe('normalizeCommercialBillingMode', () => {
  it('sólo "automatic" habilita el modo automático', () => {
    expect(normalizeCommercialBillingMode(' AUTOMATIC ')).toBe('automatic')
    expect(normalizeCommercialBillingMode('auto')).toBe('manual')
    expect(normalizeCommercialBillingMode(undefined)).toBe('manual')
  })
})

describe('buildWhatsAppHref', () => {
  it('sanea el número y codifica el mensaje', () => {
    expect(buildWhatsAppHref('+54 9 11 5522-1234', 'Hola & chau?')).toBe('https://wa.me/5491155221234?text=Hola%20%26%20chau%3F')
  })

  it('sin número o sin mensaje no arma enlace', () => {
    expect(buildWhatsAppHref('', 'Hola')).toBe('')
    expect(buildWhatsAppHref('abc', 'Hola')).toBe('')
    expect(buildWhatsAppHref('5491155221234', '')).toBe('')
  })
})

describe('enlaces de ventas según VITE_SALES_WHATSAPP_NUMBER', () => {
  async function cargarConEnv(env) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    vi.resetModules()
    return import('./commercialCatalog.js')
  }

  it('sin número configurado no muestra enlaces y el cobro queda manual', async () => {
    const catalogo = await cargarConEnv({ VITE_SALES_WHATSAPP_NUMBER: '', VITE_COMMERCIAL_BILLING_MODE: '' })
    expect(catalogo.getSalesWhatsAppHref()).toBe('')
    expect(catalogo.getTrialContinuationWhatsAppHref()).toBe('')
    expect(catalogo.COMMERCIAL_BILLING_MODE).toBe('manual')
  })

  it('con número configurado arma enlaces de wa.me saneados', async () => {
    const catalogo = await cargarConEnv({ VITE_SALES_WHATSAPP_NUMBER: '+54 9 11 0000-0000', VITE_COMMERCIAL_BILLING_MODE: 'automatic' })
    const ventas = new URL(catalogo.getSalesWhatsAppHref())
    expect(ventas.origin + ventas.pathname).toBe('https://wa.me/5491100000000')
    expect(ventas.searchParams.get('text')).toBe(catalogo.getSalesWhatsAppMessage())
    expect(new URL(catalogo.getTrialContinuationWhatsAppHref()).searchParams.get('text')).toBe(TRIAL_CONTINUATION_MESSAGE)
    expect(catalogo.COMMERCIAL_BILLING_MODE).toBe('automatic')
  })
})

describe('recommendPrice', () => {
  it('siempre recomienda el plan publicado, sin cargos extra', () => {
    const recomendacion = recommendPrice({ employees: 4, whatsapp: 1, ai: 0, support: 'priority', customization: 'sí' })
    expect(recomendacion).toMatchObject({
      currency: 'ARS',
      monthly: 50000,
      setup: 0,
      plan: 'starter',
      extras: { whatsapp: true, ai: false, support: true, customization: true },
    })
    expect(recomendacion.rationale).toContain('Equipo considerado: 4')
  })

  it('considera al menos una persona', () => {
    expect(recommendPrice({ employees: 'abc' }).rationale).toContain('Equipo considerado: 1')
    expect(recommendPrice().rationale).toContain('Equipo considerado: 1')
  })
})
