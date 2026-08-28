import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { getWhatsAppDisplayState } from '../src/utils/whatsappDisplay.js'

const cases = [
  {
    name: 'connected + allowed',
    input: { configured: true, connected: true, entitlement: 'allowed' },
    expected: { connectionState: 'connected', connectionLabel: 'Conectado', entitlementLabel: null, whatsappReady: true },
  },
  {
    name: 'connected + blocked',
    input: { configured: true, connected: true, entitlement: 'blocked' },
    expected: { connectionState: 'connected', connectionLabel: 'Conectado', entitlementLabel: 'Automatización requiere plan', whatsappReady: false },
  },
  {
    name: 'disconnected + blocked',
    input: { configured: true, connected: false, estado: 'DISCONNECTED', entitlement: 'blocked' },
    expected: { connectionState: 'disconnected', connectionLabel: 'Desconectado', entitlementLabel: 'Plan no habilitado para esta función', whatsappReady: false },
  },
  {
    name: 'connecting + blocked',
    input: { configured: true, connected: false, estado: 'CONNECTING', entitlement: 'blocked' },
    expected: { connectionState: 'connecting', connectionLabel: 'Conectando…', entitlementLabel: 'Plan no habilitado para esta función', whatsappReady: false },
  },
  {
    name: 'error + blocked',
    input: { configured: true, connected: false, estado: 'ERROR', entitlement: 'blocked' },
    expected: { connectionState: 'error', connectionLabel: 'Error de conexión', entitlementLabel: 'Plan no habilitado para esta función', whatsappReady: false },
  },
  {
    name: 'unknown connection while entitlement loads',
    input: { entitlementLoading: true, entitlement: 'checking' },
    expected: { connectionState: 'checking', connectionLabel: 'Verificando…', entitlementLabel: null, whatsappReady: false },
  },
  {
    name: 'fetch failure is unavailable, never not configured',
    input: { statusUnavailable: true, entitlement: 'allowed' },
    expected: { connectionState: 'unavailable', connectionLabel: 'Estado no disponible', canConfigure: false, whatsappReady: false },
  },
  {
    name: 'last known connected survives refresh failure',
    input: { configured: true, connected: true, statusUnavailable: true, entitlement: 'allowed' },
    expected: { connectionState: 'connected', connectionLabel: 'Conectado', connectionNotice: 'No pudimos verificar el estado más reciente.', canConfigure: false, whatsappReady: false },
  },
  {
    name: 'verified not configured can prepare connection',
    input: { configured: false, connected: false, connectionStatus: 'NOT_CONFIGURED', entitlement: 'allowed' },
    expected: { connectionState: 'needs-config', connectionLabel: 'Requiere configuración', canConfigure: true, whatsappReady: false },
  },
]

for (const { name, input, expected } of cases) {
  const result = getWhatsAppDisplayState(input)
  for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, `${name}: ${key}`)
}

assert.equal(getWhatsAppDisplayState({ configured: true, connected: true, estado: 'CONNECTED', entitlement: 'blocked' }).connectionState, 'connected')
assert.equal(getWhatsAppDisplayState({ configured: true, estado: 'QR_READY', entitlement: 'blocked' }).connectionLabel, 'QR listo')

const panel = await fs.readFile(new URL('../src/components/WhatsAppConnectionPanel.jsx', import.meta.url), 'utf8')
assert.match(panel, /STATUS_UNAVAILABLE/)
assert.match(panel, /workingRef\.current/)
assert.match(panel, /statusUnavailable \|\| workingRef\.current/)
assert.match(panel, /finally\s*\{/)
assert.match(panel, /canConnect = !statusUnavailable/)
assert.doesNotMatch(panel, /\['NOT_CONFIGURED', 'DISCONNECTED', 'ERROR', 'QR_READY', 'CONNECTING'\]/)
console.log('WhatsApp UI connection/entitlement status: PASS')
