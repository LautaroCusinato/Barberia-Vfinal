// Cobro de un turno atendido: estado + pago en una sola operación del
// servidor (RPC registrar_cobro_turno). La clave de idempotencia se crea una
// vez por intento de cobro y se reutiliza en cada reintento, así una respuesta
// perdida no duplica el pago.

export const METODOS_COBRO = ['efectivo', 'mercadopago', 'transferencia']

const MENSAJE_GENERICO = 'No se pudo registrar el cobro. Revisá tu conexión e intentá de nuevo.'

// Mensajes por `hint` de la RPC. Los que no están acá usan el genérico.
const MENSAJES_POR_HINT = {
  monto_invalido: 'El importe debe ser un número mayor o igual a 0, con hasta 2 decimales.',
  metodo_invalido: 'Elegí un método de pago válido.',
  turno_no_encontrado: 'No encontramos ese turno. Puede haberse eliminado.',
  turno_ya_atendido: 'Este turno ya figura como atendido. Actualizá la agenda antes de cobrarlo de nuevo.',
  sin_permiso: 'Tu rol no permite registrar cobros.',
  sin_acceso_operativo: 'La cuenta del negocio no permite registrar cobros en este momento.',
  sin_sesion: 'Tu sesión venció. Volvé a ingresar para registrar el cobro.',
}

export class CobroError extends Error {
  constructor(mensaje, { codigo = 'desconocido', causa } = {}) {
    super(mensaje)
    this.name = 'CobroError'
    this.codigo = codigo
    this.causa = causa
  }
}

export function nuevaClaveCobro() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // Respaldo RFC 4122 v4 para contextos sin randomUUID.
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Misma regla que la RPC; evita un viaje al servidor con datos imposibles.
export function validarCobro({ monto, metodo }) {
  if (typeof monto !== 'number' || !Number.isFinite(monto) || monto < 0 || monto > 9999999999.99 || Math.round(monto * 100) / 100 !== monto) {
    return { codigo: 'monto_invalido', mensaje: MENSAJES_POR_HINT.monto_invalido }
  }
  if (!METODOS_COBRO.includes(metodo)) return { codigo: 'metodo_invalido', mensaje: MENSAJES_POR_HINT.metodo_invalido }
  return null
}

// Devuelve { pago, repetido } sólo cuando el servidor confirmó el cobro.
// Cualquier otro caso lanza CobroError con un mensaje para mostrar.
export async function registrarCobroTurno(supabase, { turnoId, monto, metodo, clave }) {
  const invalido = validarCobro({ monto, metodo })
  if (invalido) throw new CobroError(invalido.mensaje, { codigo: invalido.codigo })

  let respuesta
  try {
    respuesta = await supabase.rpc('registrar_cobro_turno', {
      p_turno_id: turnoId,
      p_monto: monto,
      p_metodo: metodo,
      p_idempotency_key: clave,
    })
  } catch (causa) {
    throw new CobroError(MENSAJE_GENERICO, { codigo: 'red', causa })
  }
  const { data, error } = respuesta ?? {}
  if (error) {
    const codigo = MENSAJES_POR_HINT[error.hint] ? error.hint : 'desconocido'
    throw new CobroError(MENSAJES_POR_HINT[codigo] ?? MENSAJE_GENERICO, { codigo, causa: error })
  }
  if (!data?.pago?.id) throw new CobroError(MENSAJE_GENERICO, { codigo: 'respuesta_invalida' })
  return { pago: data.pago, repetido: data.repetido === true }
}

// Agrega el pago sin duplicarlo si Realtime ya lo trajo.
export function agregarPagoSinDuplicar(pagos, pago) {
  return pagos.some((p) => p.id === pago.id) ? pagos : [pago, ...pagos]
}
