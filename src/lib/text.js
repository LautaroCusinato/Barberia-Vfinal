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
    (b) => b.fecha === fecha && (b.barbero_id == null || String(b.barbero_id) === String(barberoId))
  )
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
export function barberoDisponible(barbero, fecha, hora, duracionMin = 0) {
  if (!barbero) return false
  if (!fecha || !hora) return false

  const mapa = parseHorarioBarbero(barbero?.horario)
  if (!mapa) return false

  const [y, m, d] = fecha.split('-').map(Number)
  const [hh, mm] = hora.split(':').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const bloques = mapa[dow]
  if (!bloques) return false

  const minutos = hh * 60 + mm

  const duracion = Math.max(0, Number(duracionMin) || 0)
  const fin = minutos + duracion
  const trabajo = bloques.filter((b) => !b.break)
  const pausas = bloques.filter((b) => b.break)

  // El turno debe entrar completo en una franja de trabajo y no puede
  // atravesar una pausa, incluso aunque el inicio sea válido.
  if (!trabajo.some((b) => minutos >= b.ini && fin <= b.fin)) return false
  return !pausas.some((b) => minutos < b.fin && fin > b.ini)
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
