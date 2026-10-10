import { canonicalArgentineMobile, isValidCustomerName } from './whatsappCustomer.mjs'
import { manualQaPhoneAllowed } from './qaManualRuntime.mjs'

const RECEIPT_PREFIX = 'qa928-accepted:'

// La RPC escribe sólo en el negocio dueño de la integración administrada; no
// envía nada ni cambia la pausa del bot.
export async function persistManualMessage(admin, message) {
  const { data, error } = await admin.rpc('registrar_mensaje_whatsapp', {
    p_integration_id: message.integrationId,
    p_operation_id: message.operationId,
    p_de: message.de,
    p_telefono: message.phone,
    p_texto: message.text,
    p_message_at: message.messageAt,
    p_provider_message_id: message.providerMessageId || null,
    p_customer_name: isValidCustomerName(message.customerName) ? message.customerName : null,
  })
  if (error || !data?.mensaje?.id || !['persisted', 'replay'].includes(data.status)) throw new Error('qa_panel_message_persist_failed')
  return data
}

export function acceptedManualReceipt(message) {
  return RECEIPT_PREFIX + JSON.stringify({
    integrationId: message.integrationId,
    operationId: message.operationId,
    de: 'bot',
    phone: message.phone,
    text: message.text,
    messageAt: message.messageAt,
    providerMessageId: message.providerMessageId,
  })
}

export function parseAcceptedManualReceipt(value, { integrationId, operationId, getEnv }) {
  if (typeof value !== 'string' || !value.startsWith(RECEIPT_PREFIX)) return null
  let receipt
  try { receipt = JSON.parse(value.slice(RECEIPT_PREFIX.length)) } catch { return null }
  const phone = canonicalArgentineMobile(receipt?.phone)
  if (Number(receipt?.integrationId) !== Number(integrationId) || receipt?.operationId !== operationId
    || receipt.de !== 'bot' || !phone || !manualQaPhoneAllowed(getEnv, phone)
    || typeof receipt.text !== 'string' || !receipt.text.trim() || receipt.text.length > 4096
    || typeof receipt.providerMessageId !== 'string' || !receipt.providerMessageId.trim() || receipt.providerMessageId.length > 200
    || !Number.isFinite(Date.parse(receipt.messageAt))) return null
  return { ...receipt, phone }
}

// Un reintento recupera la fila del panel desde el recibo duradero. Nunca
// vuelve a llamar a Evolution; un resultado incierto sin recibo no se inventa.
export async function recoverManualReply(admin, { integrationId, operationId, getEnv }) {
  const { data, error } = await admin.from('saas_automation_events').select('status,result_reference')
    .eq('integration_id', integrationId).eq('event_id', operationId).maybeSingle()
  if (error) throw new Error('qa_panel_receipt_lookup_failed')
  if (data?.status !== 'completed') return null
  const receipt = parseAcceptedManualReceipt(data.result_reference, { integrationId, operationId, getEnv })
  return receipt ? persistManualMessage(admin, receipt) : null
}
