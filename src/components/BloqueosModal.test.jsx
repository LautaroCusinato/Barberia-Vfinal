import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BloqueosModal from './BloqueosModal'

const HOY = '2026-10-05'
const barberos = [
  { id: 7, nombre: 'Lucas', activo: true },
  { id: 8, nombre: 'Mora', activo: true },
  { id: 9, nombre: 'Baja', activo: false },
]

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function renderModal(props = {}) {
  const onClose = vi.fn()
  const onBloquear = vi.fn().mockResolvedValue({ ok: true })
  const onDesbloquear = vi.fn().mockResolvedValue({ ok: true })
  const utils = render(
    <BloqueosModal
      open
      onClose={onClose}
      fechaInicial="2026-10-10"
      todayKey={HOY}
      barberos={barberos}
      bloqueos={[]}
      turnos={[]}
      onBloquear={onBloquear}
      onDesbloquear={onDesbloquear}
      {...props}
    />,
  )
  return { ...utils, onClose, onBloquear, onDesbloquear }
}

const botonBloquear = () => screen.getByRole('button', { name: /^(Bloquear|Bloqueando…)$/ })

describe('BloqueosModal', () => {
  it('parte de la fecha elegida en el calendario, la enfoca y ofrece sólo profesionales activos', async () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Bloquear fechas' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Fecha/, { selector: 'input' })).toHaveValue('2026-10-10')
    await waitFor(() => expect(screen.getByLabelText(/^Fecha/, { selector: 'input' })).toHaveFocus())
    const alcance = screen.getByLabelText('Para quién')
    expect(within(alcance).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todo el negocio', 'Lucas', 'Mora'])
  })

  it('una fecha pasada del calendario arranca en hoy', () => {
    renderModal({ fechaInicial: '2026-09-01' })
    expect(screen.getByLabelText(/^Fecha/, { selector: 'input' })).toHaveValue(HOY)
  })

  it('guarda un bloqueo de profesional y anuncia el éxito sólo después de guardar', async () => {
    const user = userEvent.setup()
    const pendiente = deferred()
    const onBloquear = vi.fn(() => pendiente.promise)
    renderModal({ onBloquear })
    await user.selectOptions(screen.getByLabelText('Para quién'), '7')
    await user.selectOptions(screen.getByLabelText('Motivo'), 'vacaciones')
    await user.click(botonBloquear())
    expect(botonBloquear()).toHaveTextContent('Bloqueando…')
    expect(screen.queryByText(/Bloqueado el/)).not.toBeInTheDocument()
    // Doble clic mientras guarda: no se envía dos veces.
    await user.click(botonBloquear())
    expect(onBloquear).toHaveBeenCalledTimes(1)
    expect(onBloquear).toHaveBeenCalledWith({ fechas: ['2026-10-10'], barberoId: '7', tipo: 'vacaciones', detalle: '' })
    pendiente.resolve({ ok: true })
    expect(await screen.findByText(/Bloqueado el sábado 10 de octubre para Lucas/)).toBeInTheDocument()
  })

  it('ante un error conserva el borrador y no muestra éxito', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal({ onBloquear: vi.fn().mockResolvedValue({ ok: false, mensaje: 'Sólo el dueño o un administrador del negocio pueden bloquear o desbloquear fechas.' }) })
    await user.type(screen.getByLabelText(/Detalle/), 'Mudanza')
    await user.click(botonBloquear())
    // Espera amplia: en arranque en frío de jsdom el primer render puede demorar.
    expect(await screen.findByText(/Sólo el dueño/, {}, { timeout: 5000 })).toHaveAttribute('role', 'alert')
    expect(screen.getByLabelText(/Detalle/)).toHaveValue('Mudanza')
    expect(screen.queryByText(/Bloqueado el/)).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('bloquea un rango y no duplica las fechas ya bloqueadas', async () => {
    const user = userEvent.setup()
    const bloqueos = [{ id: 1, fecha: '2026-10-11', barbero_id: null, start_time: '00:00', end_time: '23:59', motivo: 'Feriado', tipo: 'feriado' }]
    const { onBloquear } = renderModal({ bloqueos })
    await user.click(screen.getByLabelText('Varias fechas seguidas'))
    const hasta = screen.getByLabelText(/^Hasta/, { selector: 'input' })
    await user.clear(hasta)
    await user.type(hasta, '2026-10-12')
    await user.click(botonBloquear())
    expect(onBloquear).toHaveBeenCalledWith(expect.objectContaining({ fechas: ['2026-10-10', '2026-10-12'], barberoId: null }))
    expect(await screen.findByText(/Una fecha ya estaba bloqueada/)).toBeInTheDocument()
  })

  it('avisa si la fecha ya está bloqueada sin llamar al servidor', async () => {
    const user = userEvent.setup()
    const bloqueos = [{ id: 1, fecha: '2026-10-10', barbero_id: null, start_time: '00:00', end_time: '23:59', motivo: 'Cierre', tipo: 'cierre' }]
    const { onBloquear } = renderModal({ bloqueos })
    await user.selectOptions(screen.getByLabelText('Para quién'), '8')
    await user.click(botonBloquear())
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa fecha ya está bloqueada para Mora.')
    expect(onBloquear).not.toHaveBeenCalled()
  })

  it('con turnos agendados pide confirmación, los muestra y no los toca', async () => {
    const user = userEvent.setup()
    const turnos = [
      { id: 11, fecha: '2026-10-10', hora: '10:00:00', paciente: 'Ana', barbero_id: 7, estado: 'confirmado' },
      { id: 12, fecha: '2026-10-10', hora: '11:00', paciente: 'Beto', barbero_id: 8, estado: 'confirmado' },
      { id: 13, fecha: '2026-10-10', hora: '12:00', paciente: 'Cancelada', barbero_id: 7, estado: 'cancelado' },
    ]
    const { onBloquear } = renderModal({ turnos })
    await user.selectOptions(screen.getByLabelText('Para quién'), '7')
    await user.click(botonBloquear())
    const aviso = await screen.findByText(/Hay 1 turno agendado/)
    expect(onBloquear).not.toHaveBeenCalled()
    const caja = aviso.closest('.bloqueos-confirm')
    expect(within(caja).getByText(/10:00/)).toBeInTheDocument()
    expect(within(caja).queryByText(/Beto|Cancelada/)).not.toBeInTheDocument()
    expect(within(caja).getByText(/No se cancelan ni se avisa/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bloquear igual' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Bloquear igual' }))
    expect(onBloquear).toHaveBeenCalledTimes(1)
  })

  it('cambiar la fecha descarta una confirmación pendiente', async () => {
    const user = userEvent.setup()
    const turnos = [{ id: 11, fecha: '2026-10-10', hora: '10:00', paciente: 'Ana', barbero_id: 7, estado: 'confirmado' }]
    renderModal({ turnos })
    await user.click(botonBloquear())
    expect(await screen.findByText(/Hay 1 turno agendado/)).toBeInTheDocument()
    const fecha = screen.getByLabelText(/^Fecha/, { selector: 'input' })
    await user.clear(fecha)
    await user.type(fecha, '2026-10-13')
    expect(screen.queryByText(/Hay 1 turno agendado/)).not.toBeInTheDocument()
  })

  it('lista bloqueos vigentes, parciales como tales, y desbloquea sólo el elegido', async () => {
    const user = userEvent.setup()
    const bloqueos = [
      { id: 1, fecha: '2026-10-10', barbero_id: null, start_time: '00:00:00', end_time: '23:59:00', motivo: 'Cierre', tipo: 'cierre' },
      { id: 2, fecha: '2026-10-10', barbero_id: 7, start_time: '13:00:00', end_time: '15:00:00', motivo: 'Capacitación', tipo: 'bloqueo' },
      { id: 3, fecha: '2026-09-01', barbero_id: null, start_time: '00:00', end_time: '23:59', motivo: 'Viejo', tipo: 'cierre' },
    ]
    const pendiente = deferred()
    const onDesbloquear = vi.fn(() => pendiente.promise)
    renderModal({ bloqueos, onDesbloquear })
    expect(screen.getByText('Parcial · 13:00–15:00')).toBeInTheDocument()
    expect(screen.queryByText('Viejo')).not.toBeInTheDocument()
    const boton = screen.getByRole('button', { name: 'Desbloquear el sábado 10 de octubre para Lucas' })
    await user.click(boton)
    await user.click(boton)
    expect(onDesbloquear).toHaveBeenCalledTimes(1)
    expect(onDesbloquear).toHaveBeenCalledWith(bloqueos[1])
    expect(boton).toHaveTextContent('Desbloqueando…')
    pendiente.resolve({ ok: true })
    expect(await screen.findByText(/Desbloqueado el sábado 10 de octubre para Lucas/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Fechas bloqueadas' })).toHaveFocus()
  })

  it('si el desbloqueo falla lo informa y el bloqueo sigue en la lista', async () => {
    const user = userEvent.setup()
    const bloqueos = [{ id: 1, fecha: '2026-10-10', barbero_id: null, start_time: '00:00', end_time: '23:59', motivo: 'Cierre', tipo: 'cierre' }]
    renderModal({ bloqueos, onDesbloquear: vi.fn().mockResolvedValue({ ok: false, mensaje: 'No se pudo desbloquear. La fecha sigue bloqueada.' }) })
    await user.click(screen.getByRole('button', { name: /Desbloquear el sábado 10/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha sigue bloqueada')
    expect(screen.getByText('Cierre')).toBeInTheDocument()
  })

  it('Escape no cierra mientras se guarda', async () => {
    const user = userEvent.setup()
    const pendiente = deferred()
    const { onClose } = renderModal({ onBloquear: vi.fn(() => pendiente.promise) })
    await user.click(botonBloquear())
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    pendiente.resolve({ ok: true })
    await screen.findByText(/Bloqueado el/)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
