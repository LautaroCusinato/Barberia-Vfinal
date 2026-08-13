export function normalizar(str = '') {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function soloDigitos(str = '') {
  return str.replace(/\D/g, '')
}

export const PREFIJO_AR = '+54 9 11 '

export function formatTelefonoAR(value = '') {
  const digitos = soloDigitos(value).slice(0, 8)
  let formateado = digitos
  if (digitos.length > 4) {
    formateado = `${digitos.slice(0, 4)}-${digitos.slice(4)}`
  }
  return PREFIJO_AR + formateado
}

export function telefonoCompleto(value = '') {
  return soloDigitos(value.slice(PREFIJO_AR.length)).length > 0
}

export function telefonoSinPrefijo(value = '') {
  if (!value) return ''
  return value.startsWith(PREFIJO_AR) ? value.slice(PREFIJO_AR.length).trim() : value
}

// Para cargar en el input con prefijo un telefono que ya esta guardado
// (y que puede tener cualquier formato viejo/inconsistente: con guiones,
// con +54, sin código de país, etc). Si arranca con el prefijo completo
// de Argentina (54 9 11) lo sacamos; si no, nos quedamos con los últimos
// 8 dígitos (el número local), que es lo que va después del prefijo.
export function extraerNumeroLocal(value = '') {
  const digitos = soloDigitos(value)
  if (digitos.startsWith('54911')) return digitos.slice(5)
  return digitos.length > 8 ? digitos.slice(-8) : digitos
}

// Para MOSTRAR lindo un telefono que esta guardado en digitos crudos
// (5491138922851 -> +54 9 11 3892-2851). Si no calza con el formato
// esperado, muestra el valor tal cual está guardado.
export function formatTelefonoDisplay(value = '') {
  if (!value) return ''
  const digitos = soloDigitos(value)
  if (!digitos.startsWith('54911')) return value
  const local = digitos.slice(5)
  if (local.length <= 4) return PREFIJO_AR + local
  return `${PREFIJO_AR}${local.slice(0, 4)}-${local.slice(4)}`
}

// La base conserva fechas ISO (YYYY-MM-DD). Esta funcion solo cambia la
// presentacion, evitando que el formato tecnico se filtre a las cards/UI.
export function formatFechaVisible(value = '') {
  if (!value) return '—'
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}

// ===== HABILIDADES DE CADA BARBERO (que servicios puede hacer) =====
// Se guardan como un JSON de ids (slug del nombre del servicio) en
// barberos.habilidades. Un barbero SIN habilidades cargadas se interpreta
// como "hace todos los servicios" (para no romper turnos existentes de
// barberos a los que todavia no se les configuro nada).

export function generarIdHabilidad(nombre = '') {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

export function parseHabilidades(habilidadesStr) {
  if (!habilidadesStr) return []
  if (Array.isArray(habilidadesStr)) return habilidadesStr
  try {
    return JSON.parse(habilidadesStr)
  } catch {
    return []
  }
}

export function serializeHabilidades(habilidades) {
  return JSON.stringify(habilidades)
}

// Devuelve true si el barbero puede hacer ese servicio (o si no tiene
// restricciones cargadas, en cuyo caso puede hacer cualquier cosa).
export function barberoHaceServicio(barbero, servicio) {
  if (!servicio) return true
  const habilidades = parseHabilidades(barbero?.habilidades)
  if (habilidades.length === 0) return true
  return habilidades.includes(generarIdHabilidad(servicio.nombre))
}

// La relación relacional es la fuente de verdad cuando el panel la cargó.
// El fallback JSON sólo se conserva para el modo demo/local y para datos
// antiguos que todavía no tienen la metadata relacional disponible.
export function barberoRealizaServicio(barbero, servicio) {
  if (!barbero || !servicio) return false
  if (barbero.serviciosCargados) {
    return (barbero.servicios || []).some((relacion) => String(relacion.servicio_id ?? relacion.id) === String(servicio.id))
  }
  return barberoHaceServicio(barbero, servicio)
}

export function duracionServicioBarbero(barbero, servicio, fallback = 30) {
  if (!servicio) return Number(fallback) || 30
  const relacion = (barbero?.servicios || []).find((item) => String(item.servicio_id ?? item.id) === String(servicio.id))
  return Number(relacion?.duracion_min ?? servicio.duracion_min ?? servicio.duracion ?? fallback) || Number(fallback) || 30
}

export function turnosSeSuperponen(aInicio, aDuracion, bInicio, bDuracion) {
  const aStart = horaEnMinutos(aInicio)
  const bStart = horaEnMinutos(bInicio)
  const aLength = Math.max(0, Number(aDuracion) || 0)
  const bLength = Math.max(0, Number(bDuracion) || 0)
  return aStart < bStart + bLength && bStart < aStart + aLength
}

// Convierte el formato que ya usa el panel (por ejemplo: "Lun, Mar y Vie
// 09:00-18:00 break 13:00-14:00") en franjas para horarios_barbero. Si el
// texto no es reconocible, devolvemos null y conservamos la agenda vigente.
export function parseHorarioTexto(horario = '') {
  const normalizado = horario.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const dias = [
    ['lun', 1], ['mar', 2], ['mie', 3], ['jue', 4], ['vie', 5], ['sab', 6], ['dom', 0],
  ].filter(([nombre]) => new RegExp(`\\b${nombre}`).test(normalizado)).map(([, dia]) => dia)
  const rangos = [...normalizado.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)]
    .map(([, inicio, fin]) => ({ inicio: inicio.padStart(5, '0'), fin: fin.padStart(5, '0') }))
  if (!dias.length || !rangos.length || rangos[0].inicio >= rangos[0].fin) return null
  const jornada = rangos[0]
  const pausa = rangos[1]
  if (!pausa) return dias.flatMap((day_of_week) => [{ day_of_week, start_time: jornada.inicio, end_time: jornada.fin }])
  if (pausa.inicio <= jornada.inicio || pausa.fin >= jornada.fin || pausa.inicio >= pausa.fin) return null
  return dias.flatMap((day_of_week) => [
    { day_of_week, start_time: jornada.inicio, end_time: pausa.inicio },
    { day_of_week, start_time: pausa.fin, end_time: jornada.fin },
  ])
}

// Devuelve true si el barbero (o toda la barberia, si el bloqueo no tiene
// barbero_id) tiene un dia libre/bloqueo cargado para esa fecha.
export function barberoBloqueadoFecha(bloqueos, barberoId, fecha) {
  if (!bloqueos?.length || !fecha) return false
  return bloqueos.some(
    (b) => b.fecha === fecha
      && (b.barbero_id == null || String(b.barbero_id) === String(barberoId))
      && horaEnMinutos(b.start_time || '00:00') <= 0
      && horaEnMinutos(b.end_time || '23:59') >= 23 * 60 + 59
  )
}

function diaDeFecha(fecha) {
  const [y, m, d] = String(fecha || '').split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function horaEnMinutos(value) {
  const [h, m] = String(value || '00:00').slice(0, 5).split(':').map(Number)
  return (Number(h) || 0) * 60 + (Number(m) || 0)
}

function ahoraEnZona(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  return Number(parts.find((part) => part.type === 'hour')?.value || 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value || 0)
}

function fechaEnZona(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Argentina/Buenos_Aires' }).format(new Date())
}

function agendaDelDia(barbero, fecha) {
  const dow = diaDeFecha(fecha)
  if (dow == null) return { trabajo: [], cargada: false }

  if (barbero?.agendaCargada) {
    return {
      trabajo: (barbero.agenda || [])
        .filter((franja) => franja.activo !== false && Number(franja.day_of_week) === dow)
        .map((franja) => ({ ini: horaEnMinutos(franja.start_time), fin: horaEnMinutos(franja.end_time) }))
        .filter((franja) => franja.fin > franja.ini),
      cargada: true,
    }
  }

  const mapa = parseHorarioBarbero(barbero?.horario)
  const bloques = mapa?.[dow] || []
  const pausas = bloques.filter((franja) => franja.break)
  const trabajo = []
  for (const franja of bloques.filter((item) => !item.break)) {
    let cursor = franja.ini
    for (const pausa of pausas.sort((a, b) => a.ini - b.ini)) {
      if (pausa.fin <= cursor || pausa.ini >= franja.fin) continue
      if (cursor < pausa.ini) trabajo.push({ ini: cursor, fin: Math.min(pausa.ini, franja.fin) })
      cursor = Math.max(cursor, pausa.fin)
    }
    if (cursor < franja.fin) trabajo.push({ ini: cursor, fin: franja.fin })
  }
  return { trabajo, cargada: false }
}

export function barberoTrabajaFecha(barbero, fecha) {
  return agendaDelDia(barbero, fecha).trabajo.length > 0
}

function bloqueaHorario(bloqueos, barberoId, fecha, inicio, fin) {
  return (bloqueos || []).some((bloqueo) => {
    if (bloqueo.fecha !== fecha) return false
    if (bloqueo.barbero_id != null && String(bloqueo.barbero_id) !== String(barberoId)) return false
    return inicio < horaEnMinutos(bloqueo.end_time || '23:59') && fin > horaEnMinutos(bloqueo.start_time || '00:00')
  })
}

// Cálculo compartido por el modal interno. La confirmación final sigue
// ocurriendo en el trigger/RPC de PostgreSQL; esta función sólo evita ofrecer
// opciones que ya sabemos que son imposibles.
export function generarSlotsDisponibles(barbero, fecha, duracionMin = 30, bloqueos = [], step = 15, timezone = 'America/Argentina/Buenos_Aires', ignorePast = false) {
  if (!barbero || !fecha) return []
  const { trabajo } = agendaDelDia(barbero, fecha)
  const duracion = Math.max(1, Number(duracionMin) || 30)
  const slots = []
  for (const franja of trabajo) {
    for (let inicio = franja.ini; inicio + duracion <= franja.fin; inicio += step) {
      if (!ignorePast && fecha === fechaEnZona(timezone) && inicio < ahoraEnZona(timezone)) continue
      if (!bloqueaHorario(bloqueos, barbero.id, fecha, inicio, inicio + duracion)) {
        slots.push(`${String(Math.floor(inicio / 60)).padStart(2, '0')}:${String(inicio % 60).padStart(2, '0')}`)
      }
    }
  }
  return [...new Set(slots)].sort()
}

// ===== PARSEO DE HORARIOS =====
export function parseHorarioBarbero(horario = '') {
  if (!horario || typeof horario !== 'string') return null
  const txt = horario.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  const mapa = {
    lun: 1, lunes: 1,
    mar: 2, martes: 2,
    mie: 3, miercoles: 3,
    jue: 4, jueves: 4,
    vie: 5, viernes: 5,
    sab: 6, sabado: 6,
    dom: 0, domingo: 0,
  }

  // Caso con break: "Lun, Mar, Mié, Jue y Vie 09:00-18:00 break 13:00-14:00"
  const conBreak = txt.match(/(.+?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+break\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (conBreak) {
    const [, diasTxt, hIni, mIni, hFin, mFin, hBreakIni, mBreakIni, hBreakFin, mBreakFin] = conBreak
    const dias = diasTxt.split(/\s*,\s*|\s+y\s+/).map((s) => s.trim()).filter(Boolean)
    const atencion = { ini: Number(hIni) * 60 + Number(mIni), fin: Number(hFin) * 60 + Number(mFin) }
    const breakBlock = {
      ini: Number(hBreakIni) * 60 + Number(mBreakIni),
      fin: Number(hBreakFin) * 60 + Number(mBreakFin),
      break: true
    }
    const result = {}
    for (const d of dias) {
      if (mapa[d] !== undefined) {
        result[mapa[d]] = [atencion, breakBlock]
      }
    }
    return Object.keys(result).length ? result : null
  }

  // Caso: "Lun a Vie 09:00-17:00"
  const rangoDias = txt.match(/([a-z]+)\s+a\s+([a-z]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (rangoDias) {
    const [, dIni, dFin, hIni, mIni, hFin, mFin] = rangoDias
    const ini = mapa[dIni]
    const fin = mapa[dFin]
    if (ini === undefined || fin === undefined) return null
    const bloque = { ini: Number(hIni) * 60 + Number(mIni), fin: Number(hFin) * 60 + Number(mFin) }
    const result = {}
    if (ini <= fin) {
      for (let d = ini; d <= fin; d++) result[d] = [bloque]
    } else {
      for (let d = ini; d <= 6; d++) result[d] = [bloque]
      for (let d = 0; d <= fin; d++) result[d] = [bloque]
    }
    return result
  }

  // Caso: "Lun, Mie y Vie 10:00-19:00"
  const varios = txt.match(/((?:[a-z]+\s*,\s*)*(?:[a-z]+\s*y\s+)[a-z]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (varios) {
    const [, diasTxt, hIni, mIni, hFin, mFin] = varios
    const nombres = diasTxt.split(/\s*,\s*|\s+y\s+/).map((s) => s.trim()).filter(Boolean)
    const bloque = { ini: Number(hIni) * 60 + Number(mIni), fin: Number(hFin) * 60 + Number(mFin) }
    const result = {}
    for (const n of nombres) {
      if (mapa[n] !== undefined) result[mapa[n]] = [bloque]
    }
    return Object.keys(result).length ? result : null
  }

  // Caso: "Lun 09:00-17:00"
  const unDia = txt.match(/([a-z]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (unDia) {
    const [, d, hIni, mIni, hFin, mFin] = unDia
    if (mapa[d] === undefined) return null
    return { [mapa[d]]: [{ ini: Number(hIni) * 60 + Number(mIni), fin: Number(hFin) * 60 + Number(mFin) }] }
  }

  return null
}

// ===== DISPONIBILIDAD ESTRICTA =====
export function barberoDisponible(barbero, fecha, hora, duracionMin = 0, bloqueos = [], timezone = 'America/Argentina/Buenos_Aires', ignorePast = false) {
  if (!barbero) return false
  if (!fecha || !hora) return false

  const [hh, mm] = hora.split(':').map(Number)
  const { trabajo } = agendaDelDia(barbero, fecha)
  if (!trabajo.length) return false

  const minutos = hh * 60 + mm
  if (!ignorePast && fecha === fechaEnZona(timezone) && minutos < ahoraEnZona(timezone)) return false

  const duracion = Math.max(0, Number(duracionMin) || 0)
  const fin = minutos + duracion
  // El turno debe entrar completo en una franja de trabajo y no puede
  // atravesar una pausa, incluso aunque el inicio sea válido.
  if (!trabajo.some((b) => minutos >= b.ini && fin <= b.fin)) return false
  return !bloqueaHorario(bloqueos, barbero.id, fecha, minutos, fin)
}

export function generarSlots(iniMin, finMin, step = 15) {
  const slots = []
  for (let m = iniMin; m < finMin; m += step) {
    const h = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${h}:${mm}`)
  }
  return slots
}

export function slotsOcupados(duracionMin = 30, stepMin = 30) {
  const duracion = Number(duracionMin) || stepMin
  return Math.max(1, Math.ceil((duracion - 5) / stepMin))
}
