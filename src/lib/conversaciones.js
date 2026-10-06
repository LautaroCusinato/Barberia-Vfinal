// Hilos de Mensajes derivados de la tabla `mensajes`. No existe una tabla de
// conversaciones del panel: el hilo de un cliente es la clave determinística
// `id-<cliente_id>`, así que abrirlo dos veces, desde dos pestañas o después de
// una recarga/Realtime siempre resuelve al mismo hilo.

export const claveHiloCliente = (clienteId) => `id-${clienteId}`

const EPOCH = new Date(0).toISOString()

function hiloVacio(cliente) {
  return {
    id: claveHiloCliente(cliente.id),
    paciente: cliente.nombre,
    clienteId: cliente.id,
    ultimaHora: null,
    ultimoCreatedAt: EPOCH,
    noLeido: false,
    mensajes: [],
  }
}

/**
 * Agrupa por cliente_id, NO por nombre. Si agrupáramos por nombre, un mismo
 * cliente puede aparecer duplicado apenas el texto no calza exacto (ej: se
 * cargó "Lauta" desde Agendar o desde el bot, y en el mensaje quedó guardado
 * "Lauta Gómez"). El cliente_id no cambia nunca, así que es la clave correcta.
 */
export function agruparConversaciones(mensajes, clientes) {
  const nombrePorClienteId = Object.fromEntries((clientes ?? []).map((c) => [c.id, c.nombre]))
  const agrupados = {}
  for (const m of mensajes ?? []) {
    const key = m.cliente_id != null ? claveHiloCliente(m.cliente_id) : `sin-id-${m.paciente}`
    if (!agrupados[key]) {
      agrupados[key] = { id: key, paciente: m.paciente, clienteId: m.cliente_id ?? null, ultimaHora: m.hora, ultimoCreatedAt: m.created_at, noLeido: false, mensajes: [] }
    }
    agrupados[key].mensajes.push(m)
    agrupados[key].ultimaHora = m.hora
    agrupados[key].ultimoCreatedAt = m.created_at
    // El nombre a mostrar NO sale de m.paciente (queda congelado con el
    // nombre/apodo de WhatsApp de ese mensaje). Mostramos el nombre ACTUAL de
    // la ficha; si el cliente no tiene ficha (caso raro), m.paciente.
    if (m.cliente_id) agrupados[key].clienteId = m.cliente_id
    agrupados[key].paciente = nombrePorClienteId[agrupados[key].clienteId] ?? m.paciente
    if (!m.leido) agrupados[key].noLeido = true
  }

  // Clientes que todavía no le escribieron nunca al negocio: se agregan igual,
  // con el chat vacío, y quedan al final de la lista. Se chequea por id de
  // cliente (no por nombre) para no duplicar chats.
  for (const c of clientes ?? []) {
    const key = claveHiloCliente(c.id)
    if (!agrupados[key]) agrupados[key] = hiloVacio(c)
  }

  return Object.values(agrupados).sort((a, b) => new Date(b.ultimoCreatedAt) - new Date(a.ultimoCreatedAt))
}

/**
 * "Iniciar chat": devuelve la lista con el hilo del cliente. Si ya existe (con
 * o sin mensajes) se devuelve la misma lista; si no, se agrega un hilo vacío
 * arriba para que sea visible. Es idempotente: un doble clic no duplica.
 */
export function asegurarHiloCliente(conversaciones, cliente) {
  if (!cliente || cliente.id == null) return conversaciones
  if (conversaciones.some((c) => c.clienteId === cliente.id || c.id === claveHiloCliente(cliente.id))) return conversaciones
  return [hiloVacio(cliente), ...conversaciones]
}

/**
 * Si la recarga no pudo leer los clientes, la lista sólo trae hilos con
 * mensajes y el hilo vacío que el operador acaba de abrir desaparecería. Se
 * conserva mientras siga vacío. Si los clientes sí se leyeron, la lista ya lo
 * incluye, o el cliente fue borrado y el hilo no debe quedar.
 */
export function conservarHiloIniciado(lista, previas, clienteId, clientes) {
  if (clienteId == null || Array.isArray(clientes) || lista.some((c) => c.clienteId === clienteId)) return lista
  const anterior = previas.find((c) => c.clienteId === clienteId)
  if (!anterior || anterior.mensajes.length > 0) return lista
  return [anterior, ...lista]
}

/**
 * Mensaje legible de un error de `supabase.functions.invoke`. `respondio`
 * indica si la función devolvió su propio error (JSON); si no, la respuesta se
 * perdió o vino de la red/gateway y el resultado es desconocido.
 */
export async function leerErrorFuncion(error, respaldo) {
  try {
    // FunctionsHttpError deja la respuesta de la función en `context`.
    const response = error?.context
    const body = typeof response?.json === 'function' ? await response.json() : null
    const message = body?.error?.message
    if (typeof message === 'string' && message.trim()) {
      return { code: String(body.error.code || ''), message: message.trim(), contract: body.contract ?? null, respondio: true }
    }
  } catch {
    // Respuesta sin JSON: se usa el respaldo.
  }
  return { code: '', message: respaldo, contract: null, respondio: false }
}
