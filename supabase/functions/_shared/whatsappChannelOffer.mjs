/**
 * Oferta de dos canales para reservar (tarea 35): el enlace público del
 * negocio o seguir por este chat. Módulo puro: no consulta Supabase, no envía
 * mensajes ni crea reservas. El enlace se arma sólo con el slug del negocio
 * resuelto en el servidor y un origen web explícito del entorno; ni el modelo
 * ni el mensaje del cliente eligen dominio, negocio o destinatario.
 */

export const PUBLIC_BOOKING_ORIGIN_ENV = 'WHATSAPP_PUBLIC_BOOKING_ORIGIN'
export const PUBLIC_BOOKING_ENVIRONMENT_ENV = 'WHATSAPP_PUBLIC_BOOKING_ENVIRONMENT'
// Un mismo chat no recibe otra vez el saludo con enlace hasta pasado este
// tiempo. Acota la deduplicación sin bloquear para siempre futuros saludos.
export const CHANNEL_OFFER_COOLDOWN_MS = 12 * 60 * 60 * 1000
// Orígenes que sirven el frontend productivo. Un entorno que no es producción
// nunca ofrece estos enlaces aunque se configuren por error.
export const KNOWN_PRODUCTION_WEB_ORIGINS = Object.freeze(['https://barberia-177.pages.dev'])

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/
const OFFER_INTENTS = new Set(['general_query', 'empty_query', 'booking_intent'])
const BOOKING_DETAIL_FIELDS = ['service_id', 'requested_date', 'requested_time', 'daypart', 'barber_id']

const textFrom = (value) => String(value ?? '').trim()

function normalized(text) {
  return textFrom(text)
    .toLocaleLowerCase('es-AR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¡!¿?.,;:()"']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNonPublicHost(host) {
  return !host.includes('.')
    || host === 'localhost'
    || /\.(localhost|local|test|internal|lan|home|example|invalid)$/.test(host)
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    || host.startsWith('[')
}

/** Valida que el valor sea un origen https público, sin ruta, query ni credenciales. */
export function validatePublicBookingOrigin(value) {
  const raw = textFrom(value)
  if (!raw) return { ok: false, reason: 'booking_origin_missing', origin: null }
  let url
  try { url = new URL(raw) } catch { return { ok: false, reason: 'booking_origin_invalid', origin: null } }
  if (url.protocol !== 'https:') return { ok: false, reason: 'booking_origin_not_https', origin: null }
  if (url.username || url.password) return { ok: false, reason: 'booking_origin_invalid', origin: null }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return { ok: false, reason: 'booking_origin_not_origin', origin: null }
  if (isNonPublicHost(url.hostname.toLowerCase())) return { ok: false, reason: 'booking_origin_not_public', origin: null }
  return { ok: true, reason: null, origin: url.origin }
}

/**
 * Arma `https://<origen>/reservar/<slug>` o explica por qué no hay enlace.
 * `declaredEnvironment` lo fija el operador junto al origen; debe coincidir
 * con el entorno real del runtime para que una configuración copiada de otro
 * entorno no mande clientes a la base equivocada.
 */
export function buildPublicBookingLink({ origin, declaredEnvironment, runtimeEnvironment, slug, publicBookingEnabled } = {}) {
  const runtime = textFrom(runtimeEnvironment).toLowerCase()
  if (!runtime) return { available: false, reason: 'runtime_environment_required', url: null }
  const validated = validatePublicBookingOrigin(origin)
  if (!validated.ok) return { available: false, reason: validated.reason, url: null }
  if (textFrom(declaredEnvironment).toLowerCase() !== runtime) return { available: false, reason: 'booking_origin_environment_mismatch', url: null }
  if (runtime !== 'production' && KNOWN_PRODUCTION_WEB_ORIGINS.includes(validated.origin)) return { available: false, reason: 'booking_origin_environment_mismatch', url: null }
  const cleanSlug = textFrom(slug)
  if (!SLUG_PATTERN.test(cleanSlug)) return { available: false, reason: 'business_slug_missing', url: null }
  if (publicBookingEnabled !== true) return { available: false, reason: 'public_booking_disabled', url: null }
  return { available: true, reason: null, url: `${validated.origin}/reservar/${cleanSlug}` }
}

/**
 * Interpreta la elección del cliente. Devuelve 'link_request' cuando pide el
 * enlace de forma explícita, 'web' o 'chat' cuando elige un camino y null si
 * no hay elección clara (incluido el caso ambiguo que menciona los dos).
 */
export function classifyChannelChoice(text) {
  const value = normalized(text)
  if (!value) return null
  const mentionsLink = /\b(link|enlace|pagina|web|url)\b/.test(value)
  if (mentionsLink && /\b(pasa|pasame|pasamelo|pasas|manda|mandame|mandamelo|envia|enviame|dame|compartime|cual es|tenes|tienen|hay|de nuevo|otra vez)\b/.test(value)) return 'link_request'
  const web = /\b(por|desde|en|con)( la| el)? (web|pagina|link|enlace)\b/.test(value)
    || /\b(prefiero|mejor|elijo|voy con)( por)?( la| el)? (web|pagina|link|enlace|online)\b/.test(value)
    || /\bonline\b/.test(value)
    || /^(la |el )?(web|link|enlace|pagina)$/.test(value)
  const chat = /\b(por|desde) (aca|aqui|aki|chat|este chat|el chat|whatsapp|wsp|wpp|wasap|mensaje|mensajes)\b/.test(value)
    || /\b(prefiero|mejor|elijo|sigo|seguimos|sigamos)( por)? (aca|aqui|chat|el chat|whatsapp)\b/.test(value)
    || /^(aca|aqui|chat|el chat)$/.test(value)
  if (web && chat) return null
  if (web) return 'web'
  if (chat) return 'chat'
  return null
}

function offerTimestamp(state) {
  const time = new Date(textFrom(state?.channel_offer_at)).getTime()
  return Number.isFinite(time) ? time : null
}

/** El último saludo con enlace sigue vigente para esta conversación. */
export function isChannelOfferFresh(state, now = new Date()) {
  const offeredAt = offerTimestamp(state)
  if (offeredAt === null) return false
  const age = new Date(now).getTime() - offeredAt
  return age >= 0 && age < CHANNEL_OFFER_COOLDOWN_MS
}

/** Hay un saludo vigente que todavía espera que el cliente elija. */
export function isChannelChoicePending(state, now = new Date()) {
  return isChannelOfferFresh(state, now) && !textFrom(state?.channel_choice)
}

function hasBookingDetails(fields = {}) {
  return BOOKING_DETAIL_FIELDS.some((field) => fields[field] !== null && fields[field] !== undefined && fields[field] !== '')
}

/**
 * Decide si este mensaje recibe el saludo con las dos opciones. Se ofrece al
 * iniciar (saludo/consulta general) o ante una intención de reservar sin
 * datos concretos. Si el cliente ya pide un turno con servicio, día u hora, se
 * sigue con la reserva sin obligarlo a elegir. Nunca se repite mientras el
 * saludo anterior está vigente ni durante una confirmación en curso.
 */
export function shouldOfferChannels({ state = null, intent, extractedFields = {}, linkAvailable, now = new Date() } = {}) {
  if (linkAvailable !== true) return { offer: false, reason: 'link_unavailable' }
  if (isChannelOfferFresh(state, now)) return { offer: false, reason: 'offer_recently_sent' }
  if (!OFFER_INTENTS.has(textFrom(intent))) return { offer: false, reason: 'intent_answered_directly' }
  if (hasBookingDetails(extractedFields)) return { offer: false, reason: 'concrete_booking_request' }
  if (state && ['awaiting_confirmation', 'confirmed'].includes(textFrom(state.confirmation_state))) return { offer: false, reason: 'confirmation_in_progress' }
  if (state && hasBookingDetails(state) && isFreshBookingState(state, now)) return { offer: false, reason: 'booking_in_progress' }
  return { offer: true, reason: null }
}

function isFreshBookingState(state, now) {
  const expiry = new Date(textFrom(state?.expires_at)).getTime()
  return Number.isFinite(expiry) && expiry > new Date(now).getTime() && state.confirmation_state !== 'expired'
}

function safeBusinessName(value) {
  return textFrom(value).replace(/[\r\n]+/g, ' ').slice(0, 120)
}

export function buildChannelOfferReply({ businessName, url, chatBookingEnabled } = {}) {
  const name = safeBusinessName(businessName)
  const greeting = name ? `¡Hola! Gracias por escribir a ${name}.` : '¡Hola!'
  if (chatBookingEnabled === true) {
    return `${greeting} Podés reservar online acá: ${url}. Si preferís, también podemos coordinar tu turno por este chat. ¿Cómo te queda más cómodo?`
  }
  return `${greeting} Podés reservar online acá: ${url}. Si tenés alguna consulta sobre servicios, precios u horarios, escribime por acá.`
}

export function buildLinkResendReply({ url, linkAvailable, chatBookingEnabled } = {}) {
  if (linkAvailable === true) return `Acá tenés el enlace para reservar online: ${url}.`
  return chatBookingEnabled === true
    ? 'Por ahora no tengo un enlace de reserva online para compartirte. Si querés, coordinamos tu turno por acá.'
    : 'Por ahora no tengo un enlace de reserva online para compartirte. Si tenés una consulta, escribime por acá.'
}

export function buildWebChoiceReply() {
  return 'Perfecto. Elegí el servicio y el horario en el enlace; la reserva queda hecha cuando la confirmás en la página. Si necesitás algo más, escribime por acá.'
}

export const CHAT_CHOICE_PREFIX = 'Dale, seguimos por acá.'
