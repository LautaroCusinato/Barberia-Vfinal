export function normalizar(str = '') {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca tildes para que "Perez" encuentre "Pérez"
}

export function soloDigitos(str = '') {
  return str.replace(/\D/g, '')
}

// Prefijo fijo para celulares argentinos. Vive como una "pildora" no
// editable al costado del input; el usuario solo escribe los 8 dígitos
// del número (4 de área + 4 de línea).
export const PREFIJO_AR = '+54 9 11 '

// Arma el número con el guión en el medio a partir de los dígitos
// tipeados. Si no hay dígitos, devuelve solo el prefijo para que la UI
// siga mostrando el hint "+54 9 11 " sin inventar contenido.
export function formatTelefonoAR(value = '') {
  const digitos = soloDigitos(value).slice(0, 8) // 4 (área) + 4 (línea)
  let formateado = digitos
  if (digitos.length > 4) {
    formateado = `${digitos.slice(0, 4)}-${digitos.slice(4)}`
  }
  return PREFIJO_AR + formateado
}

// Devuelve true cuando el input tiene al menos un dígito cargado por
// el usuario (más allá del prefijo fijo). Sirve para que el botón
// "Crear cliente" no se habilite con el campo vacío.
export function telefonoCompleto(value = '') {
  return soloDigitos(value.slice(PREFIJO_AR.length)).length > 0
}

// Saca el prefijo y deja solo los dígitos, para persistir en
// `clientes.telefono` (que es text y se guarda con el formato legible
// en la demo). Si está vacío, devuelve ''.
export function telefonoSinPrefijo(value = '') {
  if (!value) return ''
  return value.startsWith(PREFIJO_AR) ? value.slice(PREFIJO_AR.length).trim() : value
}

// Parsea el string libre `barbero.horario` ("Lun a Sab 09:00-17:00")
// y devuelve un mapa de bloques por día. Si no se puede parsear,
// devuelve null y la UI debe tratar al barbero como "siempre
// disponible" (modo demo).
//
// Devuelve algo como:
//   { 1: [{ini: 540, fin: 1020}], 2: [...], ... }
// donde 0=Dom, 1=Lun, ..., 6=Sáb (convención JS getDay()).
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

  // Caso: "Lun a Vie 09:00-17:00" o "Mar a Sab 10:00-19:00"
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
      // Rango que cruza el domingo (ej: "Jue a Mar")
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

// Devuelve true si el barbero está disponible ese día a esa hora,
// usando el parseo de su `horario`. Si no se puede parsear, devuelve
// true (modo demo: no bloquear al usuario).
export function barberoDisponible(barbero, fecha, hora) {
  const mapa = parseHorarioBarbero(barbero?.horario)
  if (!mapa) return true
  if (!fecha || !hora) return true
  const [y, m, d] = fecha.split('-').map(Number)
  const [hh, mm] = hora.split(':').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const bloques = mapa[dow]
  if (!bloques) return false
  const minutos = hh * 60 + mm
  return bloques.some((b) => minutos >= b.ini && minutos < b.fin)
}

// Genera una lista de slots (strings "HH:MM") entre iniMin y finMin
// cada `step` minutos. Lo usa la grilla del modal.
export function generarSlots(iniMin, finMin, step = 15) {
  const slots = []
  for (let m = iniMin; m < finMin; m += step) {
    const h = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${h}:${mm}`)
  }
  return slots
}

// Cuantos bloques de la grilla (de `stepMin` minutos, por defecto 30)
// ocupa un turno segun su duracion real. Regla: hasta 35 min entra en
// un solo bloque (da un pequeño margen sobre el bloque de 30); pasado
// eso, cada 30 min extra suma un bloque mas. Ej: 30min -> 1, 50min -> 2,
// 65min -> 2, 66min -> 3, y asi siguiendo.
export function slotsOcupados(duracionMin = 30, stepMin = 30) {
  const duracion = Number(duracionMin) || stepMin
  return Math.max(1, Math.ceil((duracion - 5) / stepMin))
}
