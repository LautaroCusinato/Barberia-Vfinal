const MAX_INBOUND_TEXT = 2000
const MAX_PROPOSED_REPLY = 1000

const textFrom = (value) => String(value ?? '').trim()

export function extractInboundText(payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const data = body.data && typeof body.data === 'object' ? body.data : {}
  const message = data.message && typeof data.message === 'object' ? data.message : {}
  const raw = message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || data.text
    || body.text
    || ''
  return textFrom(raw).slice(0, MAX_INBOUND_TEXT)
}

export function classifyShadowIntent(text) {
  const normalized = textFrom(text).toLocaleLowerCase('es-AR')
  if (/\b(servicio|servicios|hacen|ofrecen|tienen)\b/.test(normalized)) return 'services_query'
  if (/\b(precio|precios|cu[aá]nto|cu[aá]ntos|costo|sale)\b/.test(normalized)) return 'price_query'
  if (/\b(turno|turnos|reserva|reservar|disponib|horario|horarios)\b/.test(normalized)) return 'availability_query'
  if (/\b(cancelar|cancelo|cancelaci[oó]n|cambiar|reprogramar)\b/.test(normalized)) return 'booking_change_request'
  return normalized ? 'general_query' : 'empty_query'
}

function safeServiceName(service) {
  return textFrom(service?.nombre).replace(/[\r\n]/g, ' ').slice(0, 120)
}

function formatPrice(service, currency) {
  const amount = Number(service?.precio)
  if (!Number.isFinite(amount)) return ''
  return `${currency || 'ARS'} ${amount.toLocaleString('es-AR')}`
}

export function buildDeterministicShadowProposal({ text, business = {}, services = [], barbers = [], schedules = [], blocks = [] }) {
  const intent = classifyShadowIntent(text)
  const activeServices = services.filter((service) => service?.activo !== false && safeServiceName(service))
  const businessName = textFrom(business?.nombre).replace(/[\r\n]/g, ' ').slice(0, 120) || 'la barbería'
  const currency = textFrom(business?.moneda).slice(0, 8) || 'ARS'
  let proposedReply = ''
  let requestedAction = 'answer_information'
  let toolsConsidered = ['tenant_context_read']
  let confidence = 0.88

  if (intent === 'services_query') {
    const names = activeServices.map(safeServiceName)
    proposedReply = names.length
      ? `Hola. En ${businessName} contamos con: ${names.join(', ')}. Si querés, te indico duración y precio de cada servicio.`
      : `Hola. Todavía no hay servicios publicados para ${businessName}.`
    toolsConsidered = ['tenant_context_read', 'services_read']
  } else if (intent === 'price_query') {
    const prices = activeServices.map((service) => `${safeServiceName(service)}: ${formatPrice(service, currency)}`).filter(Boolean)
    proposedReply = prices.length
      ? `Estos son nuestros precios: ${prices.join(' · ')}.`
      : `Todavía no hay precios publicados para ${businessName}.`
    toolsConsidered = ['tenant_context_read', 'services_read']
  } else if (intent === 'availability_query') {
    proposedReply = 'Puedo consultar horarios disponibles para el servicio que elijas. No confirmé ningún turno.'
    requestedAction = 'read_availability_only'
    toolsConsidered = ['tenant_context_read', 'services_read', 'barbers_read', 'schedules_read', 'blocks_read']
  } else if (intent === 'booking_change_request') {
    proposedReply = 'Puedo revisar opciones de horario, pero cualquier alta, cambio o cancelación requiere una confirmación explícita y permanece bloqueada en este modo.'
    requestedAction = 'booking_mutation_proposal_only'
    confidence = 0.93
    toolsConsidered = ['tenant_context_read', 'services_read', 'barbers_read', 'schedules_read', 'blocks_read']
  } else if (intent === 'empty_query') {
    proposedReply = `Hola. Soy el asistente de ${businessName}. ¿En qué te puedo ayudar?`
    confidence = 0.72
  } else {
    proposedReply = `Hola. Soy el asistente de ${businessName}. Puedo ayudarte con servicios y horarios. ¿Qué necesitás consultar?`
  }

  const reply = proposedReply.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_PROPOSED_REPLY)
  return {
    intent,
    proposed_reply: reply,
    confidence,
    requested_action: requestedAction,
    tools_considered: toolsConsidered,
    context_counts: {
      services: activeServices.length,
      barbers: barbers.filter((barber) => barber?.activo !== false).length,
      schedules: schedules.length,
      blocks: blocks.length,
    },
    provider: 'qa_deterministic_shadow',
    model: 'shadow-safe-v1',
    mutation_allowed: false,
    outbound_allowed: false,
  }
}

export function assertShadowAgentConfiguration(env = {}) {
  if (textFrom(env.WHATSAPP_MODE).toLowerCase() !== 'shadow' || textFrom(env.PILOT_MODE).toLowerCase() !== 'shadow') {
    throw new Error('shadow_mode_required')
  }
  return { mutation_allowed: false, outbound_allowed: false }
}

export async function generateShadowProposal({ text, context = {}, apiKey = '', model = 'deepseek-chat', fetchImpl = globalThis.fetch }) {
  const deterministic = buildDeterministicShadowProposal({ text, ...context })
  if (!textFrom(apiKey)) return deterministic

  const system = [
    'Sos un agente de WhatsApp en modo shadow para una única barbería QA.',
    'Respondé únicamente JSON con intent, reply y requested_action.',
    'No inventes datos ni incluyas tenant_id, barberia_id, teléfonos, credenciales o secretos.',
    'No reserves, edites, canceles ni envíes mensajes: sólo proponé una respuesta informativa.',
    `Negocio: ${textFrom(context.business?.nombre).slice(0, 120) || 'barbería QA'}.`,
    `Servicios disponibles: ${context.services?.map(safeServiceName).filter(Boolean).join(', ') || 'ninguno'}.`,
  ].join('\n')
  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'deepseek-chat',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: textFrom(text).slice(0, MAX_INBOUND_TEXT) }],
    }),
  })
  if (!response.ok) throw new Error('llm_unavailable')
  const body = await response.json().catch(() => null)
  const raw = body?.choices?.[0]?.message?.content
  let parsed
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { throw new Error('llm_invalid_json') }
  const reply = textFrom(parsed?.reply).replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_PROPOSED_REPLY)
  if (!reply || /tenant_id|barberia_id|service_role|access_token|webhook_secret/i.test(reply)) throw new Error('llm_unsafe_reply')
  const allowedIntents = new Set(['general_query', 'services_query', 'price_query', 'availability_query', 'booking_change_request', 'empty_query'])
  const intent = allowedIntents.has(parsed?.intent) ? parsed.intent : deterministic.intent
  const action = textFrom(parsed?.requested_action).slice(0, 80) || deterministic.requested_action
  return { ...deterministic, intent, proposed_reply: reply, requested_action: action, provider: 'deepseek', model: model || 'deepseek-chat', confidence: 0.8 }
}

export const shadowAgentLimits = Object.freeze({ MAX_INBOUND_TEXT, MAX_PROPOSED_REPLY })
