const MAX_INBOUND_TEXT = 2000
const MAX_PROPOSED_REPLY = 1000
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'

const textFrom = (value) => String(value ?? '').trim()

function normalizedSearchText(value) {
  return textFrom(value)
    .toLocaleLowerCase('es-AR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function dateKeyInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDaysToDateKey(dateKey, days) {
  const base = new Date(`${dateKey}T12:00:00Z`)
  if (!Number.isFinite(base.getTime())) return null
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

const WEEKDAYS = new Map([
  ['domingo', 0],
  ['lunes', 1],
  ['martes', 2],
  ['miercoles', 3],
  ['jueves', 4],
  ['viernes', 5],
  ['sabado', 6],
])

export function interpretRequestedDate(text, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  const normalized = normalizedSearchText(text)
  const today = dateKeyInTimezone(now, timezone)
  let dateKey = null
  let datePhrase = null

  if (/\bpasado manana\b/.test(normalized)) {
    dateKey = addDaysToDateKey(today, 2)
    datePhrase = 'pasado mañana'
  } else if (/\bmanana\b/.test(normalized)) {
    dateKey = addDaysToDateKey(today, 1)
    datePhrase = 'mañana'
  } else if (/\bhoy\b/.test(normalized)) {
    dateKey = today
    datePhrase = 'hoy'
  } else {
    for (const [weekday, targetDay] of WEEKDAYS.entries()) {
      if (!new RegExp(`\\b${weekday}\\b`).test(normalized)) continue
      const currentDay = new Date(`${today}T12:00:00Z`).getUTCDay()
      const delta = (targetDay - currentDay + 7) % 7 || 7
      dateKey = addDaysToDateKey(today, delta)
      datePhrase = weekday
      break
    }
  }

  let timePeriod = null
  if (/\b(noche|noches)\b/.test(normalized)) timePeriod = 'evening'
  else if (/\b(tarde|tardes)\b/.test(normalized)) timePeriod = 'afternoon'
  else if (/\b(a la manana|por la manana|esta manana)\b/.test(normalized)) timePeriod = 'morning'

  return { date_key: dateKey, date_phrase: datePhrase, time_period: timePeriod, timezone: timezone || DEFAULT_TIMEZONE }
}

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
  const normalized = normalizedSearchText(text)
  const bookingAction = /\b(quiero|necesito|me gustaria|reservame|agendame|sacar|hacer)\b/.test(normalized)
    && /\b(reservar|reserva|reservame|turno|agendar|agendame)\b/.test(normalized)
  if (bookingAction) return 'booking_intent'
  if (/\b(cancelar|cancelo|cancelacion|cambiar|reprogramar)\b/.test(normalized)) return 'booking_change_request'
  if (/\b(turno|turnos|disponib|horario|horarios|hay lugar|libre|libres)\b/.test(normalized)) return 'availability_query'
  if (/\b(precio|precios|cuanto|cuantos|costo|sale)\b/.test(normalized)) return 'price_query'
  if (/\b(servicio|servicios|ofrecen|catalogo)\b/.test(normalized)) return 'services_query'
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

function formatDateLabel(dateKey) {
  if (!dateKey) return ''
  const date = new Date(`${dateKey}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) return dateKey
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
}

function formatAvailabilitySlot(slot) {
  const time = textFrom(slot?.hora).slice(0, 5)
  const service = textFrom(slot?.service_name)
  const barber = textFrom(slot?.barbero_nombre)
  const detail = [service, barber].filter(Boolean).join(' · ')
  return detail ? `${time} (${detail})` : time
}

function availabilityReply({ intent, businessName, availability }) {
  const request = availability?.request || {}
  if (availability?.status === 'error') return `No pude consultar la disponibilidad de ${businessName} en este momento. No se confirmó ningún turno.`
  if (!request.date_key) {
    return intent === 'booking_intent'
      ? 'Para revisar opciones necesito saber qué día y servicio querés reservar. No se creó ningún turno.'
      : '¿Qué día querés consultar? Puedo revisar horarios sin reservar ningún turno.'
  }
  const slots = Array.isArray(availability?.slots) ? availability.slots.slice(0, 8) : []
  const dateLabel = formatDateLabel(request.date_key)
  if (!slots.length) {
    return intent === 'booking_intent'
      ? `No encontré disponibilidad para el ${dateLabel}. No se creó ningún turno.`
      : `No encontré disponibilidad para el ${dateLabel}. Puedo revisar otro día.`
  }
  const listed = slots.map(formatAvailabilitySlot).filter(Boolean).join(', ')
  const prefix = intent === 'booking_intent' ? 'Encontré estas opciones, pero la reserva permanece bloqueada en modo shadow' : `Sí, para el ${dateLabel} encontré`
  return `${prefix}: ${listed}. ¿Querés que te ayude a elegir un horario?`
}

export function buildDeterministicShadowProposal({ text, business = {}, services = [], barbers = [], schedules = [], blocks = [], availability = null }) {
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
  } else if (intent === 'availability_query' || intent === 'booking_intent') {
    proposedReply = availabilityReply({ intent, businessName, availability })
    requestedAction = intent === 'booking_intent' ? 'booking_read_only_proposal' : 'read_availability_only'
    toolsConsidered = ['tenant_context_read', 'services_read', 'barbers_read', 'schedules_read', 'blocks_read']
    if (availability) toolsConsidered.push('availability_rpc_read')
    confidence = intent === 'booking_intent' ? 0.93 : 0.9
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
      availability: Array.isArray(availability?.slots) ? availability.slots.length : 0,
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
  if (!textFrom(apiKey) || ['availability_query', 'booking_intent'].includes(deterministic.intent)) return deterministic

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
  const allowedIntents = new Set(['general_query', 'services_query', 'price_query', 'availability_query', 'booking_intent', 'booking_change_request', 'empty_query'])
  const intent = allowedIntents.has(parsed?.intent) ? parsed.intent : deterministic.intent
  const action = textFrom(parsed?.requested_action).slice(0, 80) || deterministic.requested_action
  return { ...deterministic, intent, proposed_reply: reply, requested_action: action, provider: 'deepseek', model: model || 'deepseek-chat', confidence: 0.8 }
}

export const shadowAgentLimits = Object.freeze({ MAX_INBOUND_TEXT, MAX_PROPOSED_REPLY, DEFAULT_TIMEZONE })
