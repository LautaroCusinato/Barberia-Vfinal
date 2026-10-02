import { describe, expect, it } from 'vitest'
import { getWhatsAppDisplayState } from './whatsappDisplay.js'

const listo = { configured: true, connected: true, entitlement: 'allowed', automationEnabled: true }

describe('getWhatsAppDisplayState', () => {
  it('sin datos pide configurar', () => {
    expect(getWhatsAppDisplayState()).toMatchObject({
      connectionState: 'needs-config',
      connectionLabel: 'Requiere configuración',
      connectionTitle: 'Conectar WhatsApp',
      canConfigure: true,
      whatsappReady: false,
      entitlementLabel: null,
      automationLabel: null,
    })
  })

  it('sólo está listo con conexión, configuración, plan y automatización habilitada', () => {
    expect(getWhatsAppDisplayState(listo)).toMatchObject({
      connectionState: 'connected',
      connectionBadge: 'Conectado',
      whatsappReady: true,
      canConfigure: false,
      automationLabel: null,
      connectionNotice: null,
    })
    expect(getWhatsAppDisplayState({ ...listo, configured: false }).whatsappReady).toBe(false)
    expect(getWhatsAppDisplayState({ ...listo, entitlement: 'unknown' }).whatsappReady).toBe(false)
  })

  it('conectado sin automatización avisa que falta habilitarla', () => {
    expect(getWhatsAppDisplayState({ ...listo, automationEnabled: false })).toMatchObject({
      whatsappReady: false,
      automationLabel: 'Automatización pendiente de habilitación',
    })
    // automationEnabled tiene que ser exactamente true.
    expect(getWhatsAppDisplayState({ ...listo, automationEnabled: 'true' }).whatsappReady).toBe(false)
  })

  it.each([
    [{ connectionStatus: 'CONNECTED' }, 'connected'],
    [{ estado: 'conectado' }, 'connected'],
    [{ connectionStatus: 'connecting' }, 'connecting'],
    [{ connectionStatus: 'qr_ready' }, 'qr-ready'],
    [{ connectionStatus: 'QR listo' }, 'qr-ready'],
    [{ connectionStatus: 'failed' }, 'error'],
    [{ estado: 'fallido' }, 'error'],
    [{ connectionStatus: 'desconectado' }, 'disconnected'],
    [{ configured: true }, 'disconnected'],
    [{ connectionStatus: 'status_unavailable' }, 'unavailable'],
    [{ connectionStatus: 'algo-raro' }, 'needs-config'],
  ])('normaliza el estado técnico %j -> %s', (input, expected) => {
    expect(getWhatsAppDisplayState(input).connectionState).toBe(expected)
  })

  it('sólo deja configurar en needs-config, disconnected o error', () => {
    expect(getWhatsAppDisplayState({ connectionStatus: 'failed' }).canConfigure).toBe(true)
    expect(getWhatsAppDisplayState({ configured: true }).canConfigure).toBe(true)
    expect(getWhatsAppDisplayState({ connectionStatus: 'connecting' }).canConfigure).toBe(false)
    expect(getWhatsAppDisplayState({ connectionStatus: 'qr-ready' }).canConfigure).toBe(false)
  })

  it('mientras carga el plan muestra "Verificando" y no deja configurar', () => {
    expect(getWhatsAppDisplayState({ entitlementLoading: true })).toMatchObject({
      connectionState: 'checking',
      connectionLabel: 'Verificando…',
      canConfigure: false,
      entitlementLoading: true,
    })
  })

  it('si no se pudo verificar el estado no inventa una conexión lista', () => {
    expect(getWhatsAppDisplayState({ ...listo, statusUnavailable: true })).toMatchObject({
      connectionState: 'connected',
      connectionUnavailable: true,
      connectionNotice: 'No pudimos verificar el estado más reciente.',
      whatsappReady: false,
      canConfigure: false,
    })
    expect(getWhatsAppDisplayState({ statusUnavailable: true })).toMatchObject({
      connectionState: 'unavailable',
      connectionLabel: 'Estado no disponible',
      connectionNotice: null,
    })
  })

  it('explica los problemas de plan', () => {
    expect(getWhatsAppDisplayState({ entitlement: 'blocked' })).toMatchObject({ requiresPlan: true, entitlementLabel: 'Plan no habilitado para esta función' })
    expect(getWhatsAppDisplayState({ ...listo, entitlement: 'blocked' })).toMatchObject({ requiresPlan: true, whatsappReady: false, entitlementLabel: 'Automatización requiere plan' })
    expect(getWhatsAppDisplayState({ entitlement: 'unavailable' })).toMatchObject({ billingUnavailable: true, entitlementLabel: 'No pudimos verificar el plan' })
    expect(getWhatsAppDisplayState({ entitlement: 'unknown' }).entitlementLabel).toBe('Plan pendiente de verificación')
  })

  it('en la demo nunca ofrece conectar ni mensajes reales', () => {
    expect(getWhatsAppDisplayState({ ...listo, demoMode: true })).toMatchObject({
      connectionState: 'requires-plan',
      connectionBadge: 'En validación',
      canConfigure: false,
      whatsappReady: false,
      requiresPlan: true,
    })
  })
})
