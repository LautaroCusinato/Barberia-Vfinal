import { describe, expect, it, vi } from 'vitest'

async function cargarConEnv({ fn = '', supabaseUrl = '' } = {}) {
  vi.stubEnv('VITE_WHATSAPP_PROVISION_FUNCTION', fn)
  vi.stubEnv('VITE_SUPABASE_URL', supabaseUrl)
  vi.resetModules()
  return import('./whatsappProvisioning.js')
}

describe('whatsappProvisioning', () => {
  it('por defecto usa whatsapp-provision, sin aprovisionamiento gestionado y con desconexión', async () => {
    const mod = await cargarConEnv({ supabaseUrl: 'https://otro-proyecto.supabase.co' })
    expect(mod.WHATSAPP_PROVISION_FUNCTION).toBe('whatsapp-provision')
    expect(mod.MANAGED_WHATSAPP_PROVISIONING).toBe(false)
    expect(mod.WHATSAPP_DISCONNECT_SUPPORTED).toBe(true)
    expect(mod.provisioningAction('disconnect')).toBe('disconnect')
    expect(mod.provisioningAction('connect')).toBe('connect')
  })

  it('el proyecto de QA activa el aprovisionamiento gestionado', async () => {
    const mod = await cargarConEnv({ supabaseUrl: 'https://cmsymmszlzikqpvfqjre.supabase.co' })
    expect(mod.MANAGED_WHATSAPP_PROVISIONING).toBe(true)
    expect(mod.WHATSAPP_PROVISION_FUNCTION).toBe('whatsapp-provision')
  })

  it('una URL de Supabase inválida no rompe la carga', async () => {
    const mod = await cargarConEnv({ supabaseUrl: 'no es una url' })
    expect(mod.MANAGED_WHATSAPP_PROVISIONING).toBe(false)
  })

  it('una función de producción configurada sólo admite status y prepare', async () => {
    const mod = await cargarConEnv({ fn: 'whatsapp-production-provision' })
    expect(mod.WHATSAPP_PROVISION_FUNCTION).toBe('whatsapp-production-provision')
    expect(mod.MANAGED_WHATSAPP_PROVISIONING).toBe(true)
    expect(mod.WHATSAPP_DISCONNECT_SUPPORTED).toBe(false)
    expect(mod.provisioningAction('status')).toBe('status')
    expect(mod.provisioningAction('connect')).toBe('prepare')
    expect(mod.provisioningAction('disconnect')).toBe('prepare')
  })

  it('ignora nombres de función con caracteres no permitidos', async () => {
    const mod = await cargarConEnv({ fn: '../evil fn', supabaseUrl: 'https://cmsymmszlzikqpvfqjre.supabase.co' })
    expect(mod.WHATSAPP_PROVISION_FUNCTION).toBe('whatsapp-provision')
    expect(mod.MANAGED_WHATSAPP_PROVISIONING).toBe(false)
  })
})
