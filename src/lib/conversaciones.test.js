import { describe, expect, it } from 'vitest'
import { agruparConversaciones, asegurarHiloCliente, claveHiloCliente, conservarHiloIniciado, leerErrorFuncion } from './conversaciones.js'

const ana = { id: 100, nombre: 'Ana Pérez', telefono: '5491122334455' }
const beto = { id: 101, nombre: 'Beto Ruiz', telefono: '5491166667777' }

describe('agruparConversaciones', () => {
  it('agrupa por cliente_id con el nombre actual de la ficha y agrega hilos vacíos al final', () => {
    const lista = agruparConversaciones([
      { id: 1, cliente_id: 100, paciente: 'Anita (WhatsApp)', texto: 'Hola', de: 'paciente', hora: '10:00', leido: false, created_at: '2026-10-05T10:00:00Z' },
      { id: 2, cliente_id: 100, paciente: 'Anita (WhatsApp)', texto: 'Respuesta', de: 'clinica', hora: '10:01', leido: true, created_at: '2026-10-05T10:01:00Z' },
    ], [ana, beto])
    expect(lista.map((c) => c.id)).toEqual(['id-100', 'id-101'])
    expect(lista[0]).toMatchObject({ paciente: 'Ana Pérez', clienteId: 100, noLeido: true, ultimaHora: '10:01' })
    expect(lista[0].mensajes).toHaveLength(2)
    expect(lista[1]).toMatchObject({ paciente: 'Beto Ruiz', clienteId: 101, mensajes: [] })
  })

  it('sin clientes (lectura fallida) no inventa hilos vacíos', () => {
    expect(agruparConversaciones([], null)).toEqual([])
  })
})

describe('asegurarHiloCliente (Iniciar chat)', () => {
  it('cliente existente sin conversación: agrega un hilo vacío arriba con la clave del cliente', () => {
    const previas = [{ id: 'id-101', clienteId: 101, paciente: 'Beto Ruiz', mensajes: [{ id: 9, texto: 'Hola' }] }]
    const lista = asegurarHiloCliente(previas, ana)
    expect(lista[0]).toMatchObject({ id: claveHiloCliente(100), clienteId: 100, paciente: 'Ana Pérez', mensajes: [] })
    expect(lista).toHaveLength(2)
  })

  it('cliente con conversación existente: devuelve la misma lista', () => {
    const previas = [{ id: 'id-100', clienteId: 100, paciente: 'Ana Pérez', mensajes: [{ id: 1, texto: 'Hola' }] }]
    expect(asegurarHiloCliente(previas, ana)).toBe(previas)
  })

  it('doble clic: aplicar dos veces no duplica el hilo', () => {
    const una = asegurarHiloCliente([], ana)
    const dos = asegurarHiloCliente(una, ana)
    expect(dos).toBe(una)
    expect(dos.filter((c) => c.clienteId === 100)).toHaveLength(1)
  })

  it('dos operadores abren el mismo cliente: la clave es determinística', () => {
    const operadorA = asegurarHiloCliente([], ana)
    const operadorB = asegurarHiloCliente([], ana)
    expect(operadorA[0].id).toBe(operadorB[0].id)
  })

  it('ignora clientes inválidos', () => {
    const previas = []
    expect(asegurarHiloCliente(previas, null)).toBe(previas)
    expect(asegurarHiloCliente(previas, { nombre: 'Sin id' })).toBe(previas)
  })
})

describe('recarga y Realtime', () => {
  it('el primer mensaje recargado cae en el mismo hilo abierto, sin duplicarlo', () => {
    const abierta = asegurarHiloCliente(agruparConversaciones([], [beto]), ana)
    const seleccionada = abierta[0].id
    // Realtime trae la fila guardada por el servidor con el cliente_id de la ficha.
    const recargada = agruparConversaciones([
      { id: 77, cliente_id: 100, paciente: 'Ana Pérez', texto: 'Primer mensaje', de: 'clinica', hora: '12:00', leido: true, created_at: '2026-10-05T12:00:00Z' },
    ], [ana, beto])
    const deAna = recargada.filter((c) => c.clienteId === 100)
    expect(deAna).toHaveLength(1)
    expect(deAna[0].id).toBe(seleccionada)
    expect(deAna[0].mensajes.map((m) => m.id)).toEqual([77])
    expect(asegurarHiloCliente(recargada, ana)).toBe(recargada)
  })

  it('conserva el hilo iniciado sólo si la recarga no pudo leer los clientes', () => {
    const previas = asegurarHiloCliente([], ana)
    const sinClientes = agruparConversaciones([], null)
    expect(conservarHiloIniciado(sinClientes, previas, 100, null)).toEqual([previas[0]])
    // Clientes leídos y Ana borrada: el hilo no debe quedar colgado.
    const sinAna = agruparConversaciones([], [beto])
    expect(conservarHiloIniciado(sinAna, previas, 100, [beto])).toBe(sinAna)
    // Sin hilo iniciado o ya presente: la lista queda igual.
    expect(conservarHiloIniciado(sinClientes, previas, null, null)).toBe(sinClientes)
    const conAna = agruparConversaciones([], [ana])
    expect(conservarHiloIniciado(conAna, previas, 100, null)).toBe(conAna)
  })

  it('no conserva un hilo que ya tenía mensajes (la recarga lo trae por cliente_id)', () => {
    const previas = [{ id: 'id-100', clienteId: 100, paciente: 'Ana Pérez', mensajes: [{ id: 1 }] }]
    expect(conservarHiloIniciado([], previas, 100, null)).toEqual([])
  })
})

describe('leerErrorFuncion', () => {
  it('usa el mensaje del servidor', async () => {
    const error = { context: new Response(JSON.stringify({ error: { code: 'whatsapp_paused', message: 'WhatsApp está pausado.' } }), { status: 409 }) }
    await expect(leerErrorFuncion(error, 'respaldo')).resolves.toEqual({ code: 'whatsapp_paused', message: 'WhatsApp está pausado.', contract: null, respondio: true, botPausado: false })
  })

  it('informa si el servidor ya pausó el bot (rechazo después de intentar el envío)', async () => {
    const error = { context: new Response(JSON.stringify({ error: { code: 'panel_send_rejected', message: 'WhatsApp rechazó el envío.' }, contract: 2, bot_paused: true }), { status: 502 }) }
    await expect(leerErrorFuncion(error, 'respaldo')).resolves.toMatchObject({ code: 'panel_send_rejected', contract: 2, botPausado: true })
  })

  it('usa el respaldo si la respuesta no es JSON o no hay contexto', async () => {
    await expect(leerErrorFuncion({ context: new Response('<html>', { status: 502 }) }, 'respaldo')).resolves.toEqual({ code: '', message: 'respaldo', contract: null, respondio: false })
    await expect(leerErrorFuncion(new Error('red'), 'respaldo')).resolves.toEqual({ code: '', message: 'respaldo', contract: null, respondio: false })
  })
})
