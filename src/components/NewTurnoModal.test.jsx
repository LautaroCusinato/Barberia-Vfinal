import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import NewTurnoModal from './NewTurnoModal'

// Lunes lejano: el filtro de horarios pasados no interviene.
const FECHA = '2030-01-07'
const servicios = [
  { id: 1, nombre: 'Corte', duracion: 30, precio: 8000, activo: true },
  { id: 2, nombre: 'Barba', duracion: 20, precio: 5000, activo: true },
]
const barberos = [{ id: 10, nombre: 'Mateo', horario: 'Lun a Vie 09:00-12:00', activo: true }]
const clientes = [
  { id: 100, nombre: 'Ana Pérez', telefono: '5491155221234' },
  { id: 101, nombre: 'Luis Gómez', telefono: '5493515551234' },
]

// Los textos se cargan con un único evento change (como `fill` de Playwright);
// el tipeo tecla por tecla se cubre en los tests de foco al final del archivo.
const escribir = (input, value) => fireEvent.change(input, { target: { value } })

// Igual que en App.jsx: el modal está siempre montado (cerrado) y se abre
// desde un botón que queda con el foco.
function setup(props = {}) {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(true)
  const base = { open: true, onClose, onSubmit, defaultDate: FECHA, servicios, barberos, clientes, ...props }
  const modal = (extra = {}) => (
    <>
      <button type="button">Abrir turno</button>
      <NewTurnoModal {...base} {...extra} />
    </>
  )
  const utils = render(modal({ open: false }))
  screen.getByRole('button', { name: 'Abrir turno' }).focus()
  utils.rerender(modal())
  const rerender = (next = {}) => utils.rerender(modal(next))
  return {
    ...utils,
    user,
    onClose,
    onSubmit: base.onSubmit,
    rerender,
    slot: (hora) => screen.getByRole('button', { name: hora }),
    agendar: () => screen.getByRole('button', { name: /Agendar turno|Guardar cambios|Guardando/ }),
    notas: () => screen.getByPlaceholderText(/Opcional/),
    buscarCliente: () => screen.getByPlaceholderText('Buscar por nombre o teléfono…'),
  }
}

async function elegirCliente(user, nombre) {
  await user.click(screen.getByPlaceholderText('Buscar por nombre o teléfono…'))
  await user.click(screen.getByText(nombre))
}

async function crearClienteNuevo(user, { nombre, telefono }) {
  await user.click(screen.getByPlaceholderText('Buscar por nombre o teléfono…'))
  await user.click(screen.getByRole('button', { name: /Crear nuevo cliente/ }))
  escribir(screen.getByPlaceholderText('Nombre y apellido'), nombre)
  escribir(screen.getByRole('textbox', { name: 'Teléfono' }), telefono)
}

describe('NewTurnoModal', () => {
  it('no renderiza nada cerrado', () => {
    const { container } = render(<NewTurnoModal open={false} onClose={() => {}} onSubmit={() => {}} defaultDate={FECHA} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ofrece sólo los horarios en los que el servicio entra completo', () => {
    const { slot } = setup()
    expect(screen.getByRole('dialog', { name: 'Nuevo turno' })).toBeInTheDocument()
    expect(slot('09:00')).toBeEnabled()
    expect(slot('11:30')).toBeEnabled() // 11:30 + 30 min = cierre
    expect(screen.queryByRole('button', { name: '11:45' })).toBeNull()
  })

  it('al cambiar a un servicio más corto ofrece horarios más cerca del cierre', async () => {
    const { user, slot } = setup()
    await user.click(screen.getByRole('button', { name: /Barba/ }))
    expect(slot('11:30')).toBeEnabled() // 11:30 + 20 min
    expect(screen.queryByRole('button', { name: '11:45' })).toBeNull() // 11:45 + 20 > 12:00
  })

  it('agenda con un cliente existente y cierra al guardar', async () => {
    const { user, slot, agendar, onSubmit, onClose } = setup()
    expect(agendar()).toBeDisabled()
    await user.click(slot('10:00'))
    expect(agendar()).toBeDisabled() // falta el cliente
    await elegirCliente(user, 'Ana Pérez')
    await user.click(agendar())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      paciente: 'Ana Pérez',
      telefono: '5491155221234',
      clienteId: 100,
      fecha: FECHA,
      hora: '10:00',
      motivo: 'Corte',
      estado: 'confirmado',
      servicio_id: 1,
      barbero_id: 10,
      precio: 8000,
      duracion: 30,
    }, undefined)
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('crea un cliente nuevo y exige un teléfono de 10 dígitos', async () => {
    const { user, slot, agendar, onSubmit } = setup()
    await user.click(slot('09:30'))
    await crearClienteNuevo(user, { nombre: 'Carla Benítez', telefono: '351555123' })
    expect(screen.getByRole('textbox', { name: 'Teléfono' })).toHaveValue('351 55-5123')
    expect(agendar()).toBeDisabled()
    escribir(screen.getByRole('textbox', { name: 'Teléfono' }), '3515551234')
    expect(agendar()).toBeEnabled()
    await user.click(agendar())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ paciente: 'Carla Benítez', telefono: '5493515551234', clienteId: null })
  })

  it('usa las notas como motivo del turno', async () => {
    const { user, slot, notas, agendar, onSubmit } = setup()
    await user.click(slot('09:00'))
    await elegirCliente(user, 'Ana Pérez')
    escribir(notas(), '  con tijera  ')
    await user.click(agendar())
    expect(onSubmit.mock.calls[0][0].motivo).toBe('con tijera')
  })

  it('bloquea los horarios que se superponen con turnos activos del barbero', () => {
    const turnosExistentes = [
      { id: 1, fecha: FECHA, hora: '10:00', barbero_id: 10, duracion: 30, estado: 'confirmado', paciente: 'Luis' },
      { id: 2, fecha: FECHA, hora: '11:00', barbero_id: 10, duracion: 30, estado: 'cancelado', paciente: 'Eva' },
      { id: 3, fecha: '2030-01-08', hora: '09:00', barbero_id: 10, duracion: 30, estado: 'confirmado', paciente: 'Otro día' },
    ]
    const { slot } = setup({ turnosExistentes })
    expect(slot('10:00')).toBeDisabled()
    expect(slot('09:45')).toBeDisabled() // 09:45-10:15 pisa el turno de las 10
    expect(slot('10:15')).toBeDisabled()
    expect(slot('09:30')).toBeEnabled() // termina justo a las 10
    expect(slot('10:30')).toBeEnabled()
    expect(slot('11:00')).toBeEnabled() // el cancelado no ocupa
    expect(slot('09:00')).toBeEnabled()
  })

  it('no reinicia el formulario cuando cambian los clientes mientras está abierto', async () => {
    const { user, slot, notas, rerender, agendar } = setup()
    await user.click(slot('10:30'))
    escribir(notas(), 'con tijera')
    await elegirCliente(user, 'Luis Gómez')

    // Realtime / polling: llegan listas nuevas de clientes, servicios y barberos.
    rerender({
      clientes: [...clientes, { id: 102, nombre: 'Nuevo Cliente', telefono: '' }],
      servicios: servicios.map((servicio) => ({ ...servicio })),
      barberos: barberos.map((barbero) => ({ ...barbero })),
    })

    expect(slot('10:30')).toHaveClass('slot-active')
    expect(notas()).toHaveValue('con tijera')
    expect(screen.getByText('Luis Gómez')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar cliente' })).toBeInTheDocument()
    expect(agendar()).toBeEnabled()
  })

  it('no reinicia un cliente nuevo a medio cargar cuando llegan clientes', async () => {
    const { user, rerender } = setup()
    await crearClienteNuevo(user, { nombre: 'Carla', telefono: '11552' })
    rerender({ clientes: [...clientes] })
    expect(screen.getByPlaceholderText('Nombre y apellido')).toHaveValue('Carla')
    expect(screen.getByRole('textbox', { name: 'Teléfono' })).toHaveValue('11 552')
  })

  it('al reabrirse vuelve a empezar desde cero', async () => {
    const { user, slot, notas, rerender } = setup()
    await user.click(slot('10:30'))
    escribir(notas(), 'algo')
    rerender({ open: false })
    rerender({ open: true })
    expect(notas()).toHaveValue('')
    expect(slot('10:30')).not.toHaveClass('slot-active')
  })

  it('si el guardado devuelve false conserva los datos y muestra el error', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false)
    const { user, slot, notas, agendar, onClose } = setup({ onSubmit })
    await user.click(slot('09:00'))
    escribir(notas(), 'no perder')
    await elegirCliente(user, 'Ana Pérez')
    await user.click(agendar())

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el turno')
    expect(onClose).not.toHaveBeenCalled()
    expect(notas()).toHaveValue('no perder')
    expect(slot('09:00')).toHaveClass('slot-active')
    expect(agendar()).toBeEnabled()
  })

  it('si el guardado falla avisa un problema de conexión', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('offline'))
    const { user, slot, agendar, onClose } = setup({ onSubmit })
    await user.click(slot('09:00'))
    await elegirCliente(user, 'Ana Pérez')
    await user.click(agendar())
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisá tu conexión')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('al editar carga el turno, vincula el cliente por id y no se reinicia si llega el mismo turno de nuevo', async () => {
    const turnoExistente = { id: 77, fecha: FECHA, hora: '11:00', barbero_id: 10, servicio_id: 2, estado: 'atendido', motivo: 'retoque', paciente: 'Nombre viejo', cliente_id: 101, duracion: 20, precio: 5000 }
    const { user, notas, rerender, agendar, slot, onSubmit } = setup({ turnoExistente })
    expect(screen.getByRole('dialog', { name: 'Editar turno' })).toBeInTheDocument()
    expect(notas()).toHaveValue('retoque')
    expect(slot('11:00')).toHaveClass('slot-active')
    expect(screen.getByText('Luis Gómez')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cambiar cliente' })).toBeNull()

    escribir(notas(), 'editado')
    rerender({ turnoExistente: { ...turnoExistente } })
    expect(notas()).toHaveValue('editado')

    await user.click(agendar())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 101, paciente: 'Luis Gómez', hora: '11:00', estado: 'atendido', motivo: 'editado', servicio_id: 2 }), 77)
  })

  it('sin profesionales disponibles para el servicio lo explica', () => {
    const conRelacion = [{ id: 10, nombre: 'Mateo', horario: 'Lun a Vie 09:00-12:00', activo: true, serviciosCargados: true, servicios: [{ servicio_id: 2 }] }]
    setup({ barberos: conRelacion })
    expect(screen.getByText(/Ningún profesional realiza este servicio/)).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '09:00' })).toBeNull()
  })

  // Hallazgo (no corregido: src/components queda fuera de esta rama). FocusTrap
  // (src/components/ui/index.jsx:105) re-ejecuta su efecto cada vez que cambia
  // `onEscape`, y NewTurnoModal.jsx:304 le pasa una función inline nueva en cada
  // render. Cada tecla re-renderiza el modal: el cleanup (index.jsx:103) devuelve
  // el foco al botón que abrió el modal y el requestAnimationFrame (index.jsx:77)
  // lo manda al botón "Cerrar". Sólo entra el primer carácter; en el buscador de
  // clientes ni eso, porque su onFocus (NewTurnoModal.jsx:457) ya re-renderiza.
  // Reproducido también en Chromium sobre /demo. Al corregirlo estos tests pasan
  // y hay que quitarles `.fails`.
  // Como una persona real, se espera a que el modal termine de enfocar su
  // primer control (requestAnimationFrame de FocusTrap) antes de tipear.
  const esperarFocoInicial = () => vi.waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus())

  // Regresión: FocusTrap re-enfocaba "Cerrar" en cada render (onEscape inline).
  it('mantiene el foco al tipear tecla por tecla en las notas', async () => {
    const { user, notas } = setup()
    await esperarFocoInicial()
    await user.type(notas(), 'con tijera')
    expect(notas()).toHaveValue('con tijera')
    expect(notas()).toHaveFocus()
  })

  it('permite tipear en el buscador de clientes', async () => {
    const { user, buscarCliente } = setup()
    await esperarFocoInicial()
    await user.type(buscarCliente(), 'Luis')
    expect(buscarCliente()).toHaveValue('Luis')
    expect(screen.getByText('Luis Gómez')).toBeInTheDocument()
  })
})
