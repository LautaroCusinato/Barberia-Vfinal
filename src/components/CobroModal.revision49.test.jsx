// Revisión independiente de la tarea 49: cobro en curso, rechazo y cierre.
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CobroModal from './CobroModal'
import { CobroError } from '../lib/cobroTurno.js'

const turno = { id: 50, paciente: 'Ana Pérez', motivo: 'Corte', servicio_id: 1, precio: 9000 }
const servicios = [{ id: 1, nombre: 'Corte', precio: 8500 }]

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const frame = () => act(() => new Promise((r) => setTimeout(r, 30)))

let consoleError
beforeEach(() => { consoleError = vi.spyOn(console, 'error') })
afterEach(() => { consoleError.mockRestore() })

function setup(onConfirmImpl) {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onConfirm = vi.fn(onConfirmImpl)
  const utils = render(<><button>Fuera</button><CobroModal turno={turno} servicios={servicios} onClose={onClose} onConfirm={onConfirm} /></>)
  const q = {
    dialog: () => screen.getByRole('dialog'),
    monto: () => screen.getByRole('spinbutton', { name: /Monto cobrado/ }),
    confirmar: () => screen.getByRole('button', { name: /Confirmar cobro|Guardando/ }),
    cancelar: () => screen.getByRole('button', { name: 'Cancelar' }),
    cerrar: () => screen.getByRole('button', { name: 'Cerrar' }),
    metodo: (n) => screen.getByRole('button', { name: n }),
  }
  return { user, onClose, onConfirm, ...utils, ...q }
}

describe('Revisión 49: guardado pendiente', () => {
  it('bloquea cerrar, cancelar, overlay, Escape, importe, método y reenvíos', async () => {
    const d = deferred()
    const s = setup(() => d.promise)
    await frame()
    expect(s.monto()).toHaveFocus()
    await s.user.clear(s.monto())
    await s.user.type(s.monto(), '1234')
    await s.user.click(s.metodo(/Transferencia/))
    await s.user.click(s.confirmar())
    expect(s.onConfirm).toHaveBeenCalledTimes(1)
    expect(s.onConfirm).toHaveBeenCalledWith({ monto: 1234, metodo: 'transferencia' })
    expect(s.dialog()).toHaveFocus()

    // Todos los controles deshabilitados y estado ocupado anunciado.
    for (const el of [s.monto(), s.cancelar(), s.cerrar(), s.confirmar(), s.metodo(/Efectivo/), s.metodo(/Mercado Pago/), s.metodo(/Transferencia/)]) expect(el).toBeDisabled()
    expect(s.confirmar()).toHaveTextContent('Guardando…')
    expect(s.container.querySelector('form')).toHaveAttribute('aria-busy', 'true')

    // Intentos de salida.
    await s.user.click(s.cancelar())
    await s.user.click(s.cerrar())
    fireEvent.click(s.cancelar()); fireEvent.click(s.cerrar())
    fireEvent.mouseDown(s.container.querySelector('.modal-overlay'))
    await s.user.keyboard('{Escape}')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(s.onClose).not.toHaveBeenCalled()

    // Intentos de edición (user-event respeta disabled; fireEvent fuerza el handler React).
    await s.user.type(s.monto(), '9')
    fireEvent.change(s.monto(), { target: { value: '1' } })
    await s.user.click(s.metodo(/Efectivo/))
    fireEvent.click(s.metodo(/Mercado Pago/))
    expect(s.metodo(/Transferencia/)).toHaveAttribute('aria-pressed', 'true')

    // Reenvíos: click, Enter y submit directo del form.
    await s.user.click(s.confirmar())
    fireEvent.submit(s.container.querySelector('form'))
    fireEvent.submit(s.container.querySelector('form'))
    expect(s.onConfirm).toHaveBeenCalledTimes(1)

    // Tab no escapa del diálogo aunque no haya controles habilitados.
    await s.user.tab()
    expect(s.dialog().contains(document.activeElement)).toBe(true)
    await s.user.tab({ shift: true })
    expect(s.dialog().contains(document.activeElement)).toBe(true)
    expect(screen.getByRole('button', { name: 'Fuera' })).not.toHaveFocus()

    await act(async () => { d.resolve() })
    expect(s.onClose).not.toHaveBeenCalled()
  })
})

describe('Revisión 49: rechazo y recuperación', () => {
  it.each([
    ['CobroError', () => new CobroError('El turno ya fue cobrado por otra persona.', { codigo: 'turno_ya_atendido' }), 'El turno ya fue cobrado por otra persona.'],
    ['excepción genérica', () => new TypeError('fetch failed'), 'No se pudo registrar el cobro. Revisá tu conexión e intentá de nuevo.'],
  ])('%s: conserva borrador, avisa y permite reintentar o cerrar', async (_n, makeErr, mensaje) => {
    const d1 = deferred(); const d2 = deferred()
    const s = setup()
    s.onConfirm.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise)
    await frame()
    await s.user.clear(s.monto()); await s.user.type(s.monto(), '777.5')
    await s.user.click(s.metodo(/Mercado Pago/))
    await s.user.click(s.confirmar())
    await act(async () => { d1.reject(makeErr()) })

    expect(screen.getByRole('alert')).toHaveTextContent(mensaje)
    expect(s.monto()).toHaveFocus()
    expect(screen.getByRole('alert').textContent).not.toMatch(/fetch failed|turno_ya_atendido/)
    expect(s.monto()).toHaveValue(777.5)
    expect(s.metodo(/Mercado Pago/)).toHaveAttribute('aria-pressed', 'true')
    for (const el of [s.monto(), s.cancelar(), s.cerrar(), s.confirmar()]) expect(el).toBeEnabled()
    expect(s.confirmar()).toHaveTextContent('Confirmar cobro')
    expect(s.container.querySelector('form')).toHaveAttribute('aria-busy', 'false')

    // Reintento con los mismos valores, una sola invocación más; el aviso se limpia.
    await s.user.click(s.confirmar())
    expect(s.onConfirm).toHaveBeenCalledTimes(2)
    expect(s.onConfirm).toHaveBeenNthCalledWith(2, { monto: 777.5, metodo: 'mercadopago' })
    expect(screen.queryByRole('alert')).toBeNull()
    await s.user.keyboard('{Escape}')
    expect(s.onClose).not.toHaveBeenCalled()
    await act(async () => { d2.reject(makeErr()) })

    // Tras el segundo error, Escape vuelve a cerrar.
    await s.user.keyboard('{Escape}')
    expect(s.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Revisión 49: éxito con cierre como App', () => {
  function Host({ onConfirm }) {
    const [t, setT] = useState(turno)
    const [toast, setToast] = useState('')
    const [cerrado, setCerrado] = useState(0)
    const confirmar = async (datos) => {
      await onConfirm(datos)
      setT(null)
      setToast('Cobro registrado')
    }
    return <><p>{toast}</p><p data-testid="cerrado">{cerrado}</p><CobroModal turno={t} servicios={servicios} onClose={() => { setCerrado((c) => c + 1); setT(null) }} onConfirm={confirmar} /></>
  }

  it('cierra por éxito sin error, sin onClose y sin warnings de React', async () => {
    const user = userEvent.setup()
    const d = deferred()
    const onConfirm = vi.fn(() => d.promise)
    render(<Host onConfirm={onConfirm} />)
    await frame()
    await user.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => { d.resolve() })
    await frame(); await frame()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Cobro registrado')).toBeInTheDocument()
    expect(screen.getByTestId('cerrado')).toHaveTextContent('0')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
