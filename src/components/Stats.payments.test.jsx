// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats'
import { formatPrecio } from '../lib/text'

vi.mock('./AnimatedNumber', () => ({ default: ({ value }) => <span>{value}</span> }))
afterEach(cleanup)
const base = { todayKey: '2026-10-07', pacientes: [], turnos: [], pagos: [] }
const valor = (label) => (texto) => within(screen.getByText(label).closest('.stat-card')).getByText(texto, { normalizer: (s) => s })

describe('estadísticas con dinero registrado', () => {
  it('no muestra el precio de un atendido como dinero cobrado', () => {
    render(<Stats {...base} turnos={[{ id: 1, fecha: base.todayKey, estado: 'atendido', precio: 10000 }]} />)
    expect(valor('Cobrado registrado')(formatPrecio(0))).toBeTruthy()
    expect(screen.getByText(formatPrecio(10000), { normalizer: (s) => s })).toBeTruthy()
    expect(screen.getByText(/Es una estimación/)).toBeTruthy()
    expect(screen.queryByText('Ingresos totales')).toBeNull()
  })
  it('incluye en cobros y caja un pago sin turno y usa fecha de pago local', () => {
    render(<Stats {...base} pagos={[{ id: 1, monto: 3500, created_at: '2026-10-08T01:00:00Z', metodo: 'efectivo' }]} />)
    expect(valor('Cobrado registrado')(formatPrecio(3500))).toBeTruthy()
    expect(valor('Total en caja hoy')(formatPrecio(3500))).toBeTruthy()
    expect(screen.getByText(/Sin profesional identificado/)).toBeTruthy()
  })
  it.each(['cargando', 'error', 'incompleto'])('no confirma cero ni vacío cuando la lectura está %s', (pagosEstado) => {
    render(<Stats {...base} pagosEstado={pagosEstado} />)
    expect(valor('Cobrado registrado')('—')).toBeTruthy()
    expect(valor('Total en caja hoy')('—')).toBeTruthy()
    expect(screen.queryByText('Todavía no se registró ningún cobro')).toBeNull()
    expect(screen.getByRole(pagosEstado === 'cargando' ? 'status' : 'alert')).toBeTruthy()
  })
  it('conserva un historial anterior con advertencia cuando falla actualizar', () => {
    render(<Stats {...base} pagosEstado="error" pagos={[{ id: 1, monto: 50, paciente: 'Ana', created_at: '2026-10-07T15:00:00Z' }]} />)
    expect(screen.getByText('Ana')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('desactualizado')
    expect(screen.queryByText('Cobrado por profesional')).toBeNull()
  })
  it('una fecha inválida no rompe estadísticas ni inventa que el pago es de hoy', () => {
    render(<Stats {...base} pagos={[{ id: 1, monto: 50, created_at: 'inválida' }]} />)
    expect(screen.getByText('Fecha no disponible')).toBeTruthy()
    expect(valor('Cobrado registrado')(formatPrecio(50))).toBeTruthy()
    expect(valor('Total en caja hoy')(formatPrecio(0))).toBeTruthy()
  })
})
