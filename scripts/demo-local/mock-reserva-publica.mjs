// Mock local de las 3 RPC públicas de reserva. SOLO DEMO: no hay Supabase, RLS ni persistencia.
import http from 'node:http'

const PORT = Number(process.env.PORT || 54399)
const negocios = {
  'austral-demo': { nombre: 'Austral Demo · Barbería', moneda: 'ARS', zona_horaria: 'America/Argentina/Buenos_Aires', color_principal: '#9b6a2f', direccion: 'Av. Demo 123, CABA' },
  'austral-demo-usd': { nombre: 'Austral Demo · Studio USD', moneda: 'USD', zona_horaria: 'America/Argentina/Buenos_Aires', color_principal: '#2f6b9b', direccion: 'Calle Ejemplo 456' },
}
const servicios = {
  ARS: [
    { id: 1, nombre: 'Corte clásico', descripcion: 'Corte y terminación', precio: 15000, duracion_min: 30 },
    { id: 2, nombre: 'Barba', descripcion: 'Perfilado completo', precio: 10000, duracion_min: 30 },
    { id: 3, nombre: 'Corte + barba', descripcion: 'Servicio completo', precio: 22000, duracion_min: 60 },
  ],
  USD: [
    { id: 11, nombre: 'Corte premium', descripcion: 'Incluye lavado', precio: 25, duracion_min: 45 },
    { id: 12, nombre: 'Color', descripcion: 'Coloración completa', precio: 60, duracion_min: 90 },
  ],
}
const profesionales = [
  { barbero_id: 7, barbero_nombre: 'Marta Demo', barbero_color: '#2d9464' },
  { barbero_id: 8, barbero_nombre: 'Lucas Demo', barbero_color: '#9b6a2f' },
]
const HORAS = ['09:00:00', '09:30:00', '10:00:00', '10:30:00', '11:00:00', '15:00:00', '15:30:00', '16:00:00']
const reservados = new Set()
let nextId = 1000

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204)
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    const rpc = req.url.split('?')[0].replace('/rest/v1/rpc/', '')
    console.log(new Date().toISOString(), req.method, rpc, JSON.stringify(body))
    if (rpc === 'catalogo_reserva_publica') {
      const barberia = negocios[body.p_slug]
      return send(res, 200, barberia ? { barberia, servicios: servicios[barberia.moneda] } : null)
    }
    if (rpc === 'horarios_disponibles_reserva_publica') {
      const dow = new Date(`${body.p_fecha}T12:00:00`).getDay()
      if (dow === 0) return send(res, 200, []) // domingos sin turnos
      const slots = []
      for (const p of profesionales) for (const hora of HORAS) {
        const dur = [...servicios.ARS, ...servicios.USD].find((s) => s.id === body.p_servicio_id)?.duracion_min || 30
        if (!reservados.has(`${body.p_slug}|${body.p_fecha}|${hora}|${p.barbero_id}`)) slots.push({ ...p, duracion_min: dur, hora })
      }
      return send(res, 200, slots)
    }
    if (rpc === 'crear_reserva_publica') {
      const key = `${body.p_slug}|${body.p_fecha}|${body.p_hora}|${body.p_barbero_id}`
      if (reservados.has(key)) return send(res, 409, { code: '23P01', message: 'Ese horario acaba de ocuparse. Elegí otro horario.' })
      reservados.add(key)
      return send(res, 200, [{ turno_id: nextId++, fecha: body.p_fecha, hora: body.p_hora, duracion_min: [...servicios.ARS, ...servicios.USD].find((s) => s.id === body.p_servicio_id)?.duracion_min || 30 }])
    }
    return send(res, 404, { message: `mock: ${rpc} no implementado` })
  })
}).listen(PORT, '127.0.0.1', () => console.log(`mock reserva en http://127.0.0.1:${PORT}`))
