import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { crearCargaPagos } from './paymentStats'
import Stats from '../components/Stats.jsx'

// Revisión 45: una recarga (Realtime o reintento) después de una lectura
// completa no debe borrar los totales confirmados mientras espera. Sólo la
// primera carga, o una posterior a un fallo o lectura incompleta, oculta los
// importes.
function clienteControlado() {
  const pendientes = []
  const client = {
    from: () => {
      const chain = { select: () => chain, eq: () => chain, order: () => new Promise((resolve) => pendientes.push(resolve)) }
      return chain
    },
  }
  return { client, responder: (respuesta) => pendientes.shift()(respuesta) }
}
const completa = (data) => ({ data, count: data.length, error: null })
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Carga de pagos — revisión 45', () => {
  it('una recarga tras una lectura completa queda "actualizando", no "cargando"', async () => {
    const { client, responder } = clienteControlado()
    const estados = []
    const cargar = crearCargaPagos({ client, barberiaId: 1, onData: vi.fn(), onStatus: (e) => estados.push(e), onError: vi.fn() })
    const primera = cargar(); await flush()
    responder(completa([{ id: 1, monto: 1000 }])); await primera
    const segunda = cargar(); await flush()
    expect(estados).toEqual(['cargando', 'listo', 'actualizando'])
    responder(completa([{ id: 1, monto: 1000 }, { id: 2, monto: 500 }])); await segunda
    expect(estados.at(-1)).toBe('listo')
  })

  it('después de una lectura incompleta o un error, la recarga vuelve a ocultar importes', async () => {
    const { client, responder } = clienteControlado()
    const estados = []
    const cargar = crearCargaPagos({ client, barberiaId: 1, onData: vi.fn(), onStatus: (e) => estados.push(e), onError: vi.fn() })
    let p = cargar(); await flush(); responder(completa([{ id: 1, monto: 1000 }])); await p
    p = cargar(); await flush(); responder({ data: [{ id: 1, monto: 1000 }], count: 1500, error: null }); await p
    p = cargar(); await flush()
    expect(estados).toEqual(['cargando', 'listo', 'actualizando', 'incompleto', 'cargando'])
    responder({ data: null, count: null, error: { message: 'red' } }); await p
    p = cargar(); await flush()
    expect(estados.slice(-2)).toEqual(['error', 'cargando'])
    responder(completa([])); await p
  })

  it('Stats muestra los importes confirmados mientras actualiza', () => {
    const props = { turnos: [], pacientes: [], todayKey: '2026-10-07', barberos: [], servicios: [], pagos: [{ id: 1, monto: 15000, created_at: '2026-10-07T13:00:00Z' }] }
    const cargando = render(<Stats {...props} pagosEstado="cargando" />)
    const guionesCargando = screen.queryAllByText('—').length
    expect(screen.getByText(/Cargando cobros/)).toBeInTheDocument()
    cargando.unmount()
    render(<Stats {...props} pagosEstado="actualizando" />)
    expect(screen.queryByText(/Cargando cobros|No se pudieron actualizar|lectura de pagos está incompleta/)).toBeNull()
    expect(screen.queryAllByText('—').length).toBeLessThan(guionesCargando)
    expect(screen.queryByText('Esperando una lectura completa de pagos.')).toBeNull()
  })
})
