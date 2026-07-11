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
export function barberoDisponible(barbero, fecha, hora) {
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

  const enHorario = bloques.some((b) => minutos >= b.ini && minutos < b.fin)
  if (!enHorario) return false

  const enBreak = bloques.some((b) => b.break && minutos >= b.ini && minutos < b.fin)
  return !enBreak
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