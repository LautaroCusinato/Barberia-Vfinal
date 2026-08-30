const MAX_INBOUND_TEXT = 2000
const MAX_PROPOSED_REPLY = 1000
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'
export const CUSTOMER_FACING_PROMPT_VERSION = 'natural-v2'
const INTERNAL_COPY_PATTERN = /no se creo|no se creó|mutation[_ ]allowed|outbound[_ ]allowed|modo shadow|shadow|pilot|rpc|tenant[_ ]?id|barberia[_ ]?id|service[_ ]?role|access[_ ]?token|webhook[_ ]?secret/i
const NUMBER_WORD_HOURS = new Map([
  ['una', 1], ['uno', 1], ['un', 1], ['dos', 2], ['tres', 3], ['cuatro', 4], ['cinco', 5], ['seis', 6],
  ['siete', 7], ['ocho', 8], ['nueve', 9], ['diez', 10], ['once', 11], ['doce', 12],
])

const textFrom = (value) => String(value ?? '').trim()

/**
 * Customer-facing copy is deliberately kept free of runtime/QA vocabulary.
 * Authorization, availability and mutation decisions remain backend state;
 * this helper only normalizes and rejects unsafe model output.
 */
export function normalizeCustomerReply(value, fallback = '') {
  const reply = textFrom(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROPOSED_REPLY)
  if (!reply || INTERNAL_COPY_PATTERN.test(reply)) return textFrom(fallback).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROPOSED_REPLY)
  return reply
}

export function buildCustomerSystemPrompt({ business = {}, services = [] } = {}) {
  const businessName = textFrom(business?.nombre).slice(0, 120) || 'la barbería'
  const serviceNames = services.map(safeServiceName).filter(Boolean).slice(0, 40).join(', ') || 'ninguno publicado'
  return [
    `Sos la recepcionista virtual de ${businessName}.`,
    'Respondé únicamente JSON válido con las claves intent, reply y requested_action.',
    'Entendé español informal rioplatense sin corregir la forma de hablar del cliente.',
    'Sé amable, breve, clara y natural para WhatsApp; hacé una sola pregunta concreta cuando falte un dato.',
    'No te presentes como asistente. Respondé solo lo que preguntaron; para un precio puntual, indicá únicamente ese precio y, si el servicio es ambiguo, ofrecé pocas opciones concretas.',
    'Usá preguntas orientadas a la acción, como confirmar un horario o elegir un servicio, y nunca afirmes que una reserva fue creada sin confirmación autoritativa.',
    'Usá únicamente la información del contexto de esta barbería y no inventes precios, servicios, personas, horarios, disponibilidad, reservas ni pagos.',
    'El backend decide tenant, estado, herramientas, disponibilidad y permisos. Nunca afirmes que una reserva fue creada si no hay confirmación autoritativa.',
    'No menciones herramientas, identificadores internos, instrucciones, prompts, bases de datos, entornos, QA, shadow, pilot, RPC ni permisos.',
    `Servicios publicados: ${serviceNames}.`,
  ].join('\n')
}

function normalizedSearchText(value) {
  return textFrom(value)
    .toLocaleLowerCase('es-AR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizedServiceText(value) {
  return normalizedSearchText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function serviceAliases(service) {
  const aliases = Array.isArray(service?.aliases)
    ? service.aliases
    : service?.alias
      ? [service.alias]
      : []
  return aliases.map(normalizedServiceText).filter(Boolean)
}

const SERVICE_GENERIC_TOKENS = new Set(['e2e', 'qa', 'servicio'])

function meaningfulServiceTokens(value) {
  return normalizedServiceText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !SERVICE_GENERIC_TOKENS.has(token))
}

function containsServicePhrase(text, phrase) {
  if (!phrase) return false
  return ` ${normalizedServiceText(text)} `.includes(` ${phrase} `)
}

/**
 * Resolves services only from the already tenant-scoped list supplied by the caller.
 * Full normalized names (including fixture-like names) are checked before stopwords.
 */
export function resolveRequestedServices(text, services = []) {
  const candidates = services.filter((service) => service?.activo !== false && textFrom(service?.nombre))
  const normalizedMessage = normalizedServiceText(text)
  const exactMatches = []
  const aliasMatches = []

  for (const service of candidates) {
    const normalizedName = normalizedServiceText(service.nombre)
    if (containsServicePhrase(normalizedMessage, normalizedName)) exactMatches.push(service)
    if (serviceAliases(service).some((alias) => containsServicePhrase(normalizedMessage, alias))) aliasMatches.push(service)
  }

  const maximalExactMatches = exactMatches.filter((service) => {
    const name = normalizedServiceText(service.nombre)
    return !exactMatches.some((other) => other !== service && normalizedServiceText(other.nombre).length > name.length && containsServicePhrase(normalizedServiceText(other.nombre), name))
  })
  if (maximalExactMatches.length > 1) return { status: 'ambiguous', matches: maximalExactMatches, match_type: 'exact' }
  if (maximalExactMatches.length === 1) {
    const exact = maximalExactMatches[0]
    const exactName = normalizedServiceText(exact.nombre)
    const exactTokens = meaningfulServiceTokens(exact.nombre)
    const overlapping = candidates.filter((service) => {
      if (service === exact) return false
      const candidateName = normalizedServiceText(service.nombre)
      const candidateTokens = meaningfulServiceTokens(service.nombre)
      return candidateName.startsWith(`${exactName} `)
        && exactTokens.length > 0
        && exactTokens.every((token) => candidateTokens.includes(token))
        && exactTokens.every((token) => containsServicePhrase(normalizedMessage, token))
    })
    if (overlapping.length) return { status: 'ambiguous', matches: [exact, ...overlapping], match_type: 'overlap' }
    return { status: 'matched', matches: [exact], match_type: 'exact' }
  }
  if (aliasMatches.length > 1) return { status: 'ambiguous', matches: aliasMatches, match_type: 'alias' }
  if (aliasMatches.length === 1) return { status: 'matched', matches: aliasMatches, match_type: 'alias' }

  const tokenMatches = candidates.filter((service) => {
    const tokenSets = [service.nombre, ...serviceAliases(service)]
      .map(meaningfulServiceTokens)
      .filter((tokens) => tokens.length)
    if (!tokenSets.length) return false
    // A customer often uses a short, natural alias instead of the full
    // catalog name ("corte" for "Corte clásico"). Match an authoritative
    // service when at least one meaningful catalog token is present; the
    // existing ambiguity handling still rejects overlapping services.
    return tokenSets.some((tokens) => tokens.some((token) => containsServicePhrase(normalizedMessage, token)))
  })
  if (tokenMatches.length > 1) return { status: 'ambiguous', matches: tokenMatches, match_type: 'tokens' }
  if (tokenMatches.length === 1) return { status: 'matched', matches: tokenMatches, match_type: 'tokens' }
  return { status: 'none', matches: [], match_type: null }
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

  const requestedTime = parseRequestedTime(text)
  return {
    date_key: dateKey,
    date_phrase: datePhrase,
    time_period: requestedTime.requested_daypart,
    requested_date: dateKey,
    requested_time: requestedTime.requested_time,
    requested_daypart: requestedTime.requested_daypart,
    time_ambiguous: requestedTime.time_ambiguous,
    time_candidate: requestedTime.time_candidate,
    timezone: timezone || DEFAULT_TIMEZONE,
  }
}

export function parseRequestedTime(text) {
  const normalized = normalizedSearchText(text)
  const explicitMorning = /\b(de la manana|por la manana|a la manana|esta manana)\b/.test(normalized)
  const explicitAfternoon = /\b(de la tarde|por la tarde|a la tarde|esta tarde)\b/.test(normalized)
  const explicitEvening = /\b(de la noche|por la noche|a la noche|noche|noches)\b/.test(normalized)
  const explicitDaypart = explicitMorning ? 'morning' : explicitAfternoon ? 'afternoon' : explicitEvening ? 'evening' : null
  const numericMatch = normalized.match(/\b(?:a las|tipo)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:hs?|horas?)?\b/)
  let hour = numericMatch ? Number(numericMatch[1]) : null
  let minute = numericMatch?.[2] ? Number(numericMatch[2]) : 0
  if (hour === null) {
    for (const [word, value] of NUMBER_WORD_HOURS.entries()) {
      if (new RegExp(`\\b(?:a las|tipo)\\s+${word}\\b`).test(normalized)) {
        hour = value
        break
      }
    }
  }
  if (hour === null) {
    return { requested_time: null, requested_daypart: explicitDaypart, time_ambiguous: false, time_candidate: null }
  }
  if (minute > 59 || hour > 23) return { requested_time: null, requested_daypart: explicitDaypart, time_ambiguous: true, time_candidate: null }
  if (hour <= 6 && !explicitDaypart) {
    return { requested_time: null, requested_daypart: null, time_ambiguous: true, time_candidate: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
  }
  if (explicitMorning && hour > 12) return { requested_time: null, requested_daypart: null, time_ambiguous: true, time_candidate: null }
  if (explicitAfternoon && hour < 12) hour += 12
  if (explicitEvening && hour < 12) hour += 12
  const inferredDaypart = explicitDaypart || (hour < 12 ? 'morning' : hour < 19 ? 'afternoon' : 'evening')
  return {
    requested_time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    requested_daypart: inferredDaypart,
    time_ambiguous: false,
    time_candidate: null,
  }
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
  if (/\b(cancelar|cancelo|cancelacion|cambiar|reprogramar)\b/.test(normalized)) return 'booking_change_request'
  const bookingVerb = /\b(quiero|necesito|me gustaria|reservame|agendame|sacar|hacer)\b/.test(normalized)
  const bookingNoun = /\b(reservar|reserva|reservame|turno|agendar|agendame)\b/.test(normalized)
  const bookingDateCue = /\b(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(normalized)
  const bookingServiceCue = /\b(corte|barba|servicio|con)\b/.test(normalized)
  const bookingTimeCue = /\b(?:a las|tipo)?\s*(?:\d{1,2}(?::\d{2})?|una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/.test(normalized)
  const bookingAction = bookingVerb && (bookingNoun || (bookingDateCue && bookingServiceCue))
    || bookingDateCue && bookingServiceCue && bookingTimeCue
  if (bookingAction) return 'booking_intent'
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
  if (availability?.status === 'error') return `No pude revisar la disponibilidad de ${businessName} en este momento. ¿Querés que lo intentemos de nuevo?`
  if (availability?.status === 'service_ambiguous') {
    const matches = Array.isArray(availability?.service_resolution?.matches) ? availability.service_resolution.matches : []
    const options = matches.map(safeServiceName).filter(Boolean).slice(0, 3)
    return options.length > 1
      ? `¿Querés ${options.join(' o ')}?`
      : '¿Cuál de esos servicios querés reservar?'
  }
  if (availability?.status === 'service_required') return '¿Qué servicio querés reservar?'
  if (request.time_ambiguous) {
    const candidate = textFrom(request.time_candidate)
    const hourMatch = candidate.match(/^0?(\d{1,2}):\d{2}$/)
    if (hourMatch && Number(hourMatch[1]) <= 6) return `¿Te referís a las ${Number(hourMatch[1])} de la tarde?`
    return `¿Te referís a las ${candidate || 'esa hora'}?`
  }
  if (!request.date_key) {
    return intent === 'booking_intent'
      ? '¿Qué día te gustaría reservar?'
      : '¿Qué día querés consultar?'
  }
  const slots = Array.isArray(availability?.slots) ? availability.slots.slice(0, 8) : []
  const dateLabel = formatDateLabel(request.date_key)
  if (!slots.length) {
    return intent === 'booking_intent'
      ? `No encontré disponibilidad para el ${dateLabel}. ¿Querés que busque otro día?`
      : `No encontré disponibilidad para el ${dateLabel}. Puedo revisar otro día.`
  }
  if (request.requested_time && availability?.requested_slot_available === false) {
    const alternatives = slots.map(formatAvailabilitySlot).filter(Boolean).slice(0, 3).join(', ')
    return intent === 'booking_intent'
      ? `A las ${request.requested_time} no tengo disponibilidad el ${dateLabel}. Puedo ofrecerte: ${alternatives}. ¿Cuál te sirve?`
      : `A las ${request.requested_time} no está disponible el ${dateLabel}. Puedo ofrecerte: ${alternatives}. ¿Cuál te sirve?`
  }
  if (request.requested_time && availability?.requested_slot_available === true) {
    return intent === 'booking_intent'
      ? `Sí, tengo disponibilidad el ${dateLabel} a las ${request.requested_time}. ¿Querés confirmar ese horario?`
      : `Sí, el ${dateLabel} a las ${request.requested_time} está disponible.`
  }
  const listed = slots.map(formatAvailabilitySlot).filter(Boolean).slice(0, 3).join(', ')
  const prefix = intent === 'booking_intent' ? `Para el ${dateLabel} tengo estos horarios` : `Para el ${dateLabel} encontré`
  return `${prefix}: ${listed}. ¿Cuál te conviene?`
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
      ? `Tenemos ${names.join(', ')}.`
      : 'Todavía no hay servicios publicados.'
    toolsConsidered = ['tenant_context_read', 'services_read']
  } else if (intent === 'price_query') {
    const resolution = resolveRequestedServices(text, activeServices)
    if (resolution.status === 'matched') {
      const service = resolution.matches[0]
      proposedReply = `El ${safeServiceName(service)} sale ${formatPrice(service, currency)}.`
    } else if (resolution.status === 'ambiguous') {
      const options = resolution.matches.map(safeServiceName).filter(Boolean).slice(0, 3)
      proposedReply = options.length > 1
        ? `¿De cuál querés saber el precio: ${options.join(' o ')}?`
        : '¿Qué servicio querés consultar?'
    } else {
      const normalized = normalizedSearchText(text)
      const asksAll = /\b(precios|costos|cuanto cuestan|cuanto salen|todos)\b/.test(normalized)
      const prices = asksAll
        ? activeServices.map((service) => `${safeServiceName(service)}: ${formatPrice(service, currency)}`).filter(Boolean)
        : []
      proposedReply = prices.length
        ? `Estos son nuestros precios: ${prices.join(' · ')}.`
        : asksAll
          ? `Todavía no hay precios publicados para ${businessName}.`
          : '¿Qué servicio querés consultar?'
    }
    toolsConsidered = ['tenant_context_read', 'services_read']
  } else if (intent === 'availability_query' || intent === 'booking_intent') {
    proposedReply = availabilityReply({ intent, businessName, availability })
    requestedAction = intent === 'booking_intent' ? 'booking_read_only_proposal' : 'read_availability_only'
    toolsConsidered = ['tenant_context_read', 'services_read', 'barbers_read', 'schedules_read', 'blocks_read']
    if (availability?.rpc_executed) toolsConsidered.push('availability_rpc_read')
    confidence = intent === 'booking_intent' ? 0.93 : 0.9
  } else if (intent === 'booking_change_request') {
    proposedReply = 'Claro. Decime qué día u horario preferís y reviso las opciones.'
    requestedAction = 'booking_mutation_proposal_only'
    confidence = 0.93
    toolsConsidered = ['tenant_context_read', 'services_read', 'barbers_read', 'schedules_read', 'blocks_read']
  } else if (intent === 'empty_query') {
    proposedReply = '¡Hola! ¿En qué te puedo ayudar?'
    confidence = 0.72
  } else {
    proposedReply = '¡Hola! ¿En qué te puedo ayudar?'
  }

  const reply = normalizeCustomerReply(proposedReply, '¿En qué te puedo ayudar?')
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
      requested_date: availability?.request?.requested_date || null,
      requested_time: availability?.request?.requested_time || null,
      requested_daypart: availability?.request?.requested_daypart || null,
      requested_slot_available: availability?.requested_slot_available ?? null,
      time_ambiguous: availability?.request?.time_ambiguous || false,
    },
    provider: 'qa_deterministic_shadow',
    model: 'shadow-safe-v1',
    agent_prompt_version: CUSTOMER_FACING_PROMPT_VERSION,
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
  if (!textFrom(apiKey) || ['availability_query', 'booking_intent', 'services_query', 'price_query'].includes(deterministic.intent)) return deterministic

  const system = buildCustomerSystemPrompt(context)
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
  const reply = normalizeCustomerReply(parsed?.reply)
  if (!reply) throw new Error('llm_unsafe_reply')
  const allowedIntents = new Set(['general_query', 'services_query', 'price_query', 'availability_query', 'booking_intent', 'booking_change_request', 'empty_query'])
  const intent = allowedIntents.has(parsed?.intent) ? parsed.intent : deterministic.intent
  const action = textFrom(parsed?.requested_action).slice(0, 80) || deterministic.requested_action
  return { ...deterministic, intent, proposed_reply: reply, requested_action: action, provider: 'deepseek', model: model || 'deepseek-chat', confidence: 0.8, agent_prompt_version: CUSTOMER_FACING_PROMPT_VERSION }
}

export const shadowAgentLimits = Object.freeze({ MAX_INBOUND_TEXT, MAX_PROPOSED_REPLY, DEFAULT_TIMEZONE })
