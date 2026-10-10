import { normalizeCustomerReply, classifyShadowIntent, resolveRequestedServices } from './whatsappAgentShadow.mjs'
import { extractCustomerName, isValidCustomerName } from './whatsappCustomer.mjs'
import { parseExplicitConfirmation } from './whatsappConversationState.mjs'

const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,]+/g, '').trim()
const text = value => String(value || '').trim()
const GOALS = new Set(['booking', 'services', 'prices', 'duration', 'availability', 'identity', 'my_booking', 'recommend', 'greeting', 'thanks', 'human', 'unclear'])
export const CONCIERGE_ROUTE = 'https://n8n.cuchitron.lat/webhook/austral-qa-language-928'

export function conciergeGoal(message, state = null) {
  const value = fold(message)
  if (/como me llamo|mi nombre|sabes quien soy|quien soy|a nombre de quien (esta|quedo)/.test(value)) return 'identity'
  if (/^(decime vos|decime|vos decime)$/.test(value) && state?.last_information_topic === 'identity') return 'identity'
  if (/mi turno|mi reserva|que reserve|cuando tengo|tengo (un )?turno/.test(value)) return 'my_booking'
  if (/recomend|no se (que|cual)|que me conviene|ayudame a elegir|elegi vos|^(decime vos)$/.test(value)) return 'recommend'
  if (/persona|humano|recepcionista|hablar con alguien/.test(value)) return 'human'
  if (/^(hola|buenas|buen dia|buenas tardes|buenas noches|holaa|hey|hola de nuevo)$/.test(value)) return 'greeting'
  if (/^(gracias|muchas gracias|genial|joya|chau|hasta luego|gracias chau)$/.test(value)) return 'thanks'
  const intent = classifyShadowIntent(message)
  return ({ services_query: 'services', price_query: 'prices', duration_query: 'duration', availability_query: 'availability', booking_intent: 'booking' })[intent] || 'unclear'
}

export function redactLanguageInput(value, customerName = '') {
  let result = text(value).slice(0, 1600)
  if (customerName) result = result.split(customerName).join('[CLIENTE]')
  return result.replace(/https?:\/\/\S+/gi, '[ENLACE]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]').replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[TELEFONO]').replace(/(?:Bearer\s+\S+|\beyJ[A-Za-z0-9_.-]+|\bsk-[A-Za-z0-9_-]+)/gi, '[CREDENCIAL]')
}

export function languageRequest({ message, business, services = [], barbers = [], state, customer, today }) {
  return {
    tenant_id: 928, instance: 'austral-qa-tenant-928',
    text: redactLanguageInput(message, customer?.nombre),
    context: {
      today, timezone: business.zona_horaria || 'America/Argentina/Buenos_Aires',
      services: services.filter(s => s.activo !== false).slice(0, 40).map(s => ({ id: s.id, name: s.nombre, description: s.descripcion || '' })),
      barbers: barbers.filter(b => b.activo !== false).slice(0, 30).map(b => ({ id: b.id, name: b.nombre })),
      stage: state?.awaiting_customer_name ? 'name' : state?.barber_selection_pending ? 'barber' : state?.confirmation_state === 'awaiting_confirmation' ? 'confirmation' : 'collecting',
      service_id: state?.service_id || null, date: state?.requested_date || null, time: state?.requested_time || null,
      known_customer: Boolean(customer?.nombre && !customer?.whatsapp_nombre_pendiente),
      last_topic: state?.last_information_topic || null,
    },
  }
}

export function validateLanguageResult(value, { services = [], barbers = [], today }) {
  if (!value || typeof value !== 'object' || !GOALS.has(value.goal) || !(Number(value.confidence) >= 0.75)) return null
  const result = { goal: value.goal, fields: {}, provider: 'deepseek_n8n' }
  if (value.service_id != null && services.some(s => Number(s.id) === Number(value.service_id) && s.activo !== false)) result.fields.service_id = Number(value.service_id)
  if (value.barber_id != null && barbers.some(b => Number(b.id) === Number(value.barber_id) && b.activo !== false)) { result.fields.barber_id = Number(value.barber_id); result.fields.barber_selection_pending = false }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.date || '')) {
    const date = new Date(value.date + 'T12:00:00Z')
    const start = new Date(today + 'T12:00:00Z')
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.date && date >= start && date - start <= 60 * 86400000) result.fields.requested_date = value.date
  }
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time || '')) result.fields.requested_time = value.time
  if (['morning', 'afternoon', 'evening'].includes(value.daypart)) result.fields.daypart = value.daypart
  if (['earliest', 'latest', 'any'].includes(value.time_preference)) result.fields.time_preference = value.time_preference
  if (value.goal === 'booking') result.fields.pending_intent = 'booking_intent'
  // Nunca acepta nombre, teléfono, texto de respuesta, confirmación ni acción
  // de escritura propuestos por el modelo.
  return result
}

export async function interpretConcierge({ request, secret, fetchImpl = globalThis.fetch }) {
  if (!secret) return null
  try {
    const response = await fetchImpl(CONCIERGE_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json', 'x-austral-panel-secret': secret, 'user-agent': 'Austral-QA-Integration/1.0' }, body: JSON.stringify(request), signal: AbortSignal.timeout(9000) })
    if (!response.ok) return null
    return await response.json()
  } catch { return null }
}

export function richReply(value) {
  const lines = text(value).split(/\r?\n/).map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 1000)
  return normalizeCustomerReply(lines) ? lines : 'Puedo ayudarte a reservar o consultar los servicios. ¿Qué necesitás?'
}

export function money(value, currency = 'ARS') {
  const amount = Number(value)
  return value != null && Number.isFinite(amount) && amount >= 0 ? amount.toLocaleString('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }) : 'precio a consultar'
}
export function friendlyDate(value) {
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : ''
}

export function conciergeNameInput(message, state, customer) {
  if (!state?.awaiting_customer_name) return null
  if (customer?.nombre && !customer.whatsapp_nombre_pendiente && (/^(soy yo|yo|a mi nombre|para mi|si soy yo)$/.test(fold(message)) || parseExplicitConfirmation(message))) return customer.nombre
  if (/^(hola|gracias|cualquiera|decime vos|no se|como me llamo|no)$/.test(fold(message))) return null
  const name = extractCustomerName(message)
  return isValidCustomerName(name) ? name : null
}

export function conciergeChoice(message, state) {
  const match = fold(message).match(/^(?:opcion |el |la |numero )?([1-6])$/)
  if (!match) return null
  return state?.concierge_choices?.[Number(match[1]) - 1] || null
}

export function conciergeInformation({ goal, message, customer, services = [], state, upcoming = [], business }) {
  const name = customer?.whatsapp_nombre_pendiente ? '' : text(customer?.nombre)
  const first = name.split(' ')[0]
  const active = services.filter(s => s.activo !== false)
  const selected = resolveRequestedServices(message, active)
  const service = selected.status === 'matched' ? selected.matches[0] : active.find(s => Number(s.id) === Number(state?.service_id))
  switch (goal) {
    case 'identity': return name ? `Tu ficha está a nombre de *${name}* 😊\n¿Querés consultar tu reserva o agendar otra?` : 'Todavía no tengo tu nombre. ¿Cómo te llamás?'
    case 'my_booking': return upcoming.length ? `Estas son tus próximas reservas:\n${upcoming.slice(0, 3).map(t => `• ${t.motivo || 'Turno'} · ${friendlyDate(t.fecha)} a las ${text(t.hora).slice(0, 5)}${t.paciente ? ` · ${t.paciente}` : ''}`).join('\n')}\nSi querés cambiar o cancelar, podés pedir ayuda al negocio.` : 'No encontré reservas próximas para este WhatsApp. ¿Querés agendar un turno?'
    case 'greeting': return `¡Hola${first ? `, ${first}` : ''}! 👋\n${upcoming.length ? 'Tu reserva sigue agendada. ¿Querés verla o hacer otra consulta?' : `Bienvenido a ${business.nombre}. ¿Querés reservar o consultar nuestros servicios?`}`
    case 'thanks': return `¡De nada${first ? `, ${first}` : ''}! 😊${upcoming.length ? '\nTe esperamos para tu turno.' : '\nCuando quieras, te ayudo a reservar.'}`
    case 'prices': return service ? `${service.nombre}: *${money(service.precio, business.moneda)}* · ${service.duracion_min} min.\n¿Querés reservarlo?` : `Estos son los precios publicados:\n${active.map(s => `• ${s.nombre}: ${money(s.precio, business.moneda)} · ${s.duracion_min} min`).join('\n')}\n¿Cuál te interesa?`
    case 'duration': return service ? `${service.nombre} dura ${service.duracion_min} minutos. ¿Querés ver horarios?` : `Duración de nuestros servicios:\n${active.map(s => `• ${s.nombre}: ${s.duracion_min} min`).join('\n')}\n¿Cuál querés reservar?`
    case 'human': return 'Podés escribir acá qué necesitás para que el negocio lo vea en el panel. Soy el bot y puedo ayudarte con reservas y consultas; todavía no puedo asegurar cuándo responderá una persona.'
    case 'services':
    case 'recommend': return `${goal === 'recommend' ? 'Te ayudo a elegir 😊' : 'Estos son nuestros servicios:'}\n${active.slice(0, 5).map((s, i) => `${i + 1}. *${s.nombre}* · ${money(s.precio, business.moneda)}\n${s.descripcion || `${s.duracion_min} minutos`}`).join('\n')}\n¿Cuál te interesa? Podés decir el nombre o el número.`
    default: return `Puedo ayudarte con:\n• Reservar un turno\n• Servicios y precios\n• Consultar tu próxima reserva\n¿Qué te gustaría hacer?`
  }
}

export function conciergeBookingProposal({ proposal, state, action, services, barbers, availability, customer, business }) {
  const service = services.find(s => Number(s.id) === Number(state.service_id))
  const name = text(state.customer_name)
  let reply = proposal.proposed_reply
  let choices = []
  let quote = state.concierge_quote || null
  if (availability?.status === 'error') return { proposal: { ...proposal, proposed_reply: 'No pude consultar los horarios ahora. Todavía no se creó una reserva. Podés decir «reintentar» o usar el enlace de reservas.' }, state }
  if (action.action === 'ask_name') {
    reply = customer?.nombre && !customer.whatsapp_nombre_pendiente
      ? `¿A nombre de quién lo agendamos?\nTengo tu ficha como *${customer.nombre}*. Podés decir «soy yo» o indicarme el nombre para esta reserva.`
      : '¡Dale! 😊 ¿A nombre de quién lo agendamos?'
  } else if (action.action === 'ask_service') {
    choices = services.filter(s => s.activo !== false).slice(0, 5).map(s => ({ type: 'service', id: s.id }))
    reply = `${name ? `${name.split(' ')[0]}, ¿` : '¿'}qué servicio te gustaría?\n${choices.map((c, i) => { const s = services.find(s => s.id === c.id); return `${i + 1}. ${s.nombre} · ${money(s.precio, business.moneda)} · ${s.duracion_min} min` }).join('\n')}\nPodés decir el nombre o el número.`
  } else if (action.action === 'ask_date') {
    reply = `Perfecto${name ? `, ${name.split(' ')[0]}` : ''}. ${service ? `${service.nombre} cuesta ${money(service.precio, business.moneda)}.\n` : ''}¿Para qué día lo buscás? Podés decir «mañana» o una fecha.`
  } else if (action.action === 'ask_time') {
    const times = [...new Set((availability?.slots || []).map(s => text(s.hora).slice(0, 5)))].slice(0, 6)
    choices = times.map(time => ({ type: 'time', time }))
    reply = times.length ? `Para ${friendlyDate(state.requested_date)} tengo, por ejemplo:\n${times.map((time, i) => `${i + 1}. ${time}`).join('\n')}\n¿Cuál te sirve? También podés pedirme otra hora o una franja.` : `¿A qué hora te gustaría el ${friendlyDate(state.requested_date)}? Podés decir una hora o «por la tarde».`
  } else if (action.action === 'ask_barber') {
    choices = barbers.filter(b => b.activo !== false && (!state.available_barber_ids?.length || state.available_barber_ids.includes(Number(b.id)))).slice(0, 5).map(b => ({ type: 'barber', id: b.id }))
    reply = `A esa hora podés elegir:\n${choices.map((c, i) => `${i + 1}. ${barbers.find(b => b.id === c.id).nombre}`).join('\n')}\n¿Con quién preferís? Si te da igual, decime «cualquiera».`
  } else if (action.action === 'request_confirmation') {
    const barber = barbers.find(b => Number(b.id) === Number(state.barber_id))
    const slot = availability?.slots?.find(s => Number(s.barbero_id) === Number(state.barber_id) && text(s.hora).slice(0, 5) === state.requested_time)
    quote = { service_id: Number(service?.id), price: Number(service?.precio), currency: business.moneda || 'ARS', duration: Number(slot?.duracion_min || service?.duracion_min) }
    reply = `Antes de agendar, revisá estos datos:\n👤 ${name || customer?.nombre || 'Nombre pendiente'}\n✂️ ${service?.nombre || 'Servicio'} · ${money(service?.precio, business.moneda)} · ${quote.duration} min\n📅 ${friendlyDate(state.requested_date)} · ${state.requested_time}\n💈 ${barber?.nombre || 'Profesional disponible'}\n¿Lo reservo así? Respondé «sí» o decime qué querés cambiar.`
  } else if (action.action === 'offer_alternatives') {
    const times = [...new Set((availability?.slots || []).map(s => text(s.hora).slice(0, 5)))].slice(0, 6)
    choices = times.map(time => ({ type: 'time', time }))
    reply = times.length ? `Ese horario ya no está libre. Estas opciones sí aparecen disponibles:\n${times.map((time, i) => `${i + 1}. ${time}`).join('\n')}\n¿Cuál elegís?` : `No encontré horarios libres el ${friendlyDate(state.requested_date)}. ¿Probamos otro día?`
  }
  return { proposal: { ...proposal, proposed_reply: richReply(reply), agent_prompt_version: 'natural-v2' }, state: { ...state, concierge_choices: choices, concierge_quote: quote } }
}

export function conciergeConfirmation({ turno, service, business, barber }) {
  return richReply(`¡Listo! Tu turno quedó reservado ✅\n👤 ${turno.paciente}\n✂️ ${service?.nombre || turno.motivo || 'Servicio'}\n📅 ${friendlyDate(turno.fecha)} · ${text(turno.hora).slice(0, 5)}\n💈 ${barber?.nombre || 'Profesional asignado'}\n💰 ${money(turno.precio, business?.moneda || 'ARS')}\n${business?.nombre || ''}\nSi querés volver a consultar los datos, decime «mi turno».`)
}
