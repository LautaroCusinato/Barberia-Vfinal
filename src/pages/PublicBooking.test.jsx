import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicBooking from './PublicBooking.jsx'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc }, isSupabaseConfigured: true }))

const servicio = { id: 1, nombre: 'Corte de prueba', precio: 10000, duracion_min: 30 }
const slot = { barbero_id: 7, barbero_nombre: 'Profesional QA', duracion_min: 30, hora: '10:00:00' }
let catalogo, consultarCatalogo, consultarSlots, crear
const diferido = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
beforeEach(() => {
  catalogo = { barberia: { nombre: 'Negocio de prueba', moneda: 'ARS', zona_horaria: 'America/Argentina/Buenos_Aires' }, servicios: [{ ...servicio }] }
  consultarCatalogo = vi.fn(async () => ({ data: catalogo, error: null }))
  consultarSlots = vi.fn(async () => ({ data: [slot], error: null }))
  crear = vi.fn(async (params) => ({ data: [{ turno_id: 42, fecha: params.p_fecha, hora: params.p_hora, duracion_min: 30 }], error: null }))
  rpc.mockReset().mockImplementation((nombre, params) => {
    if (nombre === 'catalogo_reserva_publica') return consultarCatalogo(params)
    if (nombre === 'horarios_disponibles_reserva_publica') return consultarSlots(params)
    if (nombre === 'crear_reserva_publica') return crear(params)
    throw new Error(`RPC inesperada: ${nombre}`)
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  // El refresco periódico se dispara explícitamente en su test.
  const realSetInterval = window.setInterval.bind(window)
  vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => delay === 30000 ? 999 : realSetInterval(callback, delay, ...args))
})

async function abrir() {
  const view = render(<PublicBooking slug="negocio-prueba" />)
  await screen.findByRole('button', { name: /Corte de prueba/ })
  return view
}
async function formulario() {
  const view = await abrir()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.click(await screen.findByRole('button', { name: '10:00', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.change(screen.getByRole('textbox', { name: /Nombre y apellido/ }), { target: { value: 'Cliente de prueba' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Teléfono/ }), { target: { value: '1111223344' } })
  return view
}
const confirmar = () => fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva', exact: true }))
const resumen = () => within(screen.getByRole('complementary', { name: 'Tu reserva' }))

describe('catálogo y recuperación de reserva pública', () => {
  it.each(['ARS', 'USD', undefined])('usa moneda %s del negocio en selección, resumen y éxito sin convertir importes', async (moneda) => {
    catalogo = { ...catalogo, barberia: { ...catalogo.barberia, moneda } }
    const expected = (10000).toLocaleString('es-AR', { style: 'currency', currency: moneda || 'ARS', maximumFractionDigits: 0 }).replace(/\s+/g, ' ')
    await formulario()
    expect(resumen().getByText(expected, { exact: true })).toBeVisible()
    confirmar()
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    expect(screen.getByText(expected, { exact: true })).toBeVisible()
    expect(crear.mock.calls[0][0]).not.toHaveProperty('p_moneda')
    expect(crear.mock.calls[0][0]).not.toHaveProperty('p_precio')
  })

  it('pide revisar un cambio de moneda antes de crear la reserva', async () => {
    await formulario()
    catalogo = { ...catalogo, barberia: { ...catalogo.barberia, moneda: 'USD' } }
    confirmar()
    await screen.findByText('El servicio cambió. Revisá el resumen antes de confirmar otra vez.')
    expect(crear).not.toHaveBeenCalled()
    confirmar()
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('actualiza precio, nombre y duración del mismo servicio al recuperar el foco', async () => {
    await abrir()
    catalogo = { ...catalogo, servicios: [{ ...servicio, nombre: 'Corte actualizado', precio: 17000, duracion_min: 45 }] }
    fireEvent(window, new Event('focus'))
    await screen.findByRole('button', { name: /Corte actualizado/ })
    expect(resumen().getByText('Corte actualizado')).toBeVisible()
    expect(resumen().getByText(/17\.000/)).toBeVisible()
    expect(screen.getByText(/El servicio cambió/)).toBeVisible()
  })

  it('no confirma si la consulta previa de horarios falla', async () => {
    await formulario()
    consultarSlots.mockResolvedValueOnce({ data: null, error: { message: 'sin red' } })
    confirmar()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).not.toBeDisabled())
    expect(crear).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: '¡Turno reservado!' })).not.toBeInTheDocument()
  })

  it('una respuesta vacía de creación no muestra un éxito inventado', async () => {
    await formulario()
    crear.mockResolvedValueOnce({ data: [], error: null })
    confirmar()
    await screen.findByText(/No pudimos comprobar si la reserva/)
    expect(screen.queryByRole('heading', { name: '¡Turno reservado!' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled()
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('permite reintentar la carga inicial si el cliente lanza una excepción', async () => {
    consultarCatalogo.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<PublicBooking slug="negocio-prueba" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Intentar nuevamente' }))
    await screen.findByRole('button', { name: /Corte de prueba/ })
    expect(consultarCatalogo).toHaveBeenCalledTimes(2)
    expect(crear).not.toHaveBeenCalled()
  })

  it.each(['catálogo', 'horarios'])('conserva el borrador y libera el formulario si falla %s antes de enviar', async (consulta) => {
    await formulario()
    const consultaMock = consulta === 'catálogo' ? consultarCatalogo : consultarSlots
    consultaMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    confirmar()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).not.toBeDisabled())
    expect(crear).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
    expect(screen.getByRole('textbox', { name: /Teléfono/ }).value.replace(/\D/g, '')).toBe('1111223344')
    confirmar()
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('exige revisar un precio cambiado antes de permitir confirmar otra vez', async () => {
    await formulario()
    catalogo = { ...catalogo, servicios: [{ ...servicio, precio: 17000 }] }
    confirmar()
    await screen.findByText('El servicio cambió. Revisá el resumen antes de confirmar otra vez.')
    expect(crear).not.toHaveBeenCalled()
    expect(resumen().getByText(/17\.000/)).toBeVisible()
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
    confirmar()
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    expect(screen.getByText(/17\.000/)).toBeVisible()
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('pide revisar la duración actual del profesional antes de confirmar', async () => {
    await formulario()
    consultarSlots.mockResolvedValue({ data: [{ ...slot, duracion_min: 45 }], error: null })
    confirmar()
    await screen.findByText('La duración del turno cambió. Revisá el resumen antes de confirmar otra vez.')
    expect(resumen().getByText('45 min')).toBeVisible()
    expect(crear).not.toHaveBeenCalled()
    crear.mockImplementationOnce(async (params) => ({ data: [{ turno_id: 42, fecha: params.p_fecha, hora: params.p_hora, duracion_min: 45 }], error: null }))
    confirmar()
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    expect(screen.getByText('45 min')).toBeVisible()
  })

  it('no reserva otro servicio silenciosamente cuando desaparece el seleccionado', async () => {
    await formulario()
    catalogo = { ...catalogo, servicios: [{ ...servicio, id: 2, nombre: 'Otro servicio' }] }
    confirmar()
    await screen.findByText('El servicio elegido ya no está disponible. Elegí otro servicio para continuar.')
    expect(screen.getByRole('heading', { name: 'Elegí un servicio' })).toBeVisible()
    expect(crear).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Otro servicio/ }))
    expect(await screen.findByRole('button', { name: '10:00', exact: true })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: '10:00', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
  })

  it('descarta respuestas de catálogo antiguas que llegan después de una nueva', async () => {
    await abrir()
    const vieja = diferido()
    consultarCatalogo.mockReturnValueOnce(vieja.promise)
    fireEvent(window, new Event('focus'))
    catalogo = { ...catalogo, servicios: [{ ...servicio, precio: 19000 }] }
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(resumen().getByText(/19\.000/)).toBeVisible())
    await act(async () => vieja.resolve({ data: { ...catalogo, servicios: [servicio] }, error: null }))
    expect(resumen().getByText(/19\.000/)).toBeVisible()
    expect(resumen().queryByText(/10\.000/)).not.toBeInTheDocument()
  })

  it('una respuesta antigua de horarios no restaura una opción ocupada', async () => {
    await formulario()
    const vieja = diferido()
    consultarSlots.mockReturnValueOnce(vieja.promise)
    fireEvent(window, new Event('focus'))
    consultarSlots.mockResolvedValueOnce({ data: [], error: null })
    fireEvent(window, new Event('focus'))
    await screen.findByText(/el horario seleccionado dejó de estar disponible/)
    await act(async () => vieja.resolve({ data: [slot], error: null }))
    expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled()
    expect(crear).not.toHaveBeenCalled()
  })

  it('el refresco periódico actualiza el catálogo sin perder datos ni un horario válido', async () => {
    await formulario()
    catalogo = { ...catalogo, servicios: [{ ...servicio, precio: 18000 }] }
    const timer = window.setInterval.mock.calls.filter(([, delay]) => delay === 30000).at(-1)
    expect(timer[1]).toBe(30000)
    await act(async () => timer[0]())
    expect(resumen().getByText(/18\.000/)).toBeVisible()
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
    expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).not.toBeDisabled()
  })

  it('actualiza horarios en segundo plano sin desmontar el botón enfocado ni ocultar las opciones', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    const horario = await screen.findByRole('button', { name: '10:00', exact: true })
    fireEvent.click(horario)
    horario.focus()
    const pendiente = diferido()
    consultarSlots.mockReturnValueOnce(pendiente.promise)
    const timer = window.setInterval.mock.calls.filter(([, delay]) => delay === 30000).at(-1)
    await act(async () => timer[0]())
    expect(screen.getByRole('button', { name: '10:00', exact: true })).toBe(horario)
    expect(horario).toHaveFocus()
    expect(horario).toHaveAttribute('aria-pressed', 'true')
    await act(async () => pendiente.resolve({ data: [slot], error: null }))
    expect(screen.getByRole('button', { name: '10:00', exact: true })).toBe(horario)
    expect(horario).toHaveFocus()
  })

  it('un fallo de catálogo durante el sondeo conserva el formulario y el borrador', async () => {
    await formulario()
    consultarCatalogo.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fireEvent(window, new Event('focus'))
    await screen.findByText('No pudimos actualizar los servicios. Revisaremos los datos antes de confirmar.')
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
    expect(screen.queryByRole('heading', { name: /No pudimos abrir/ })).not.toBeInTheDocument()
    expect(crear).not.toHaveBeenCalled()
  })

  it('al cambiar la duración del servicio exige elegir nuevamente un horario', async () => {
    await formulario()
    catalogo = { ...catalogo, servicios: [{ ...servicio, duracion_min: 45 }] }
    consultarSlots.mockResolvedValue({ data: [{ ...slot, duracion_min: 45 }], error: null })
    fireEvent(window, new Event('focus'))
    await screen.findByText(/El servicio cambió/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Elegir horario', exact: true }))
    const horario = await screen.findByRole('button', { name: '10:00', exact: true })
    expect(horario).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(horario)
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(resumen().getByText('45 min')).toBeVisible()
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
    expect(crear).not.toHaveBeenCalled()
  })

  it('ignora errores tardíos de horarios del día anterior', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByRole('button', { name: '10:00', exact: true })
    const anterior = diferido()
    consultarSlots.mockReturnValueOnce(anterior.promise)
    fireEvent(window, new Event('focus'))
    consultarSlots.mockResolvedValueOnce({ data: [{ ...slot, hora: '15:00:00' }], error: null })
    fireEvent.click(within(screen.getByRole('group', { name: 'Próximos días' })).getAllByRole('button')[1])
    await screen.findByRole('button', { name: '15:00', exact: true })
    await act(async () => anterior.reject(new TypeError('sin red')))
    expect(screen.getByRole('button', { name: '15:00', exact: true })).toBeVisible()
    expect(screen.queryByText(/No pudimos actualizar la disponibilidad/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '10:00', exact: true })).not.toBeInTheDocument()
  })

  it('un doble envío y recuperar el foco no duplican una creación pendiente', async () => {
    await formulario()
    const pendiente = diferido()
    crear.mockReturnValueOnce(pendiente.promise)
    const form = screen.getByRole('form', { name: 'Revisá y confirmá' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(crear).toHaveBeenCalledTimes(1))
    const llamadas = rpc.mock.calls.length
    fireEvent(window, new Event('focus'))
    fireEvent.submit(form)
    fireEvent.click(screen.getByRole('button', { name: 'Volver a Servicio' }))
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toBeDisabled()
    expect(rpc).toHaveBeenCalledTimes(llamadas)
    const params = crear.mock.calls[0][0]
    await act(async () => pendiente.resolve({ data: [{ turno_id: 42, fecha: params.p_fecha, hora: params.p_hora, duracion_min: 30 }], error: null }))
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    fireEvent(window, new Event('focus'))
    expect(rpc).toHaveBeenCalledTimes(llamadas)
  })

  it('al corregir los campos marcados desaparece el aviso de validación sin sugerir otro horario', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    fireEvent.click(await screen.findByRole('button', { name: '10:00', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    confirmar()
    expect(await screen.findByText('Revisá los datos marcados antes de confirmar.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Nombre y apellido/ }), { target: { value: 'Cliente de prueba' } })
    expect(screen.getByText('Revisá los datos marcados antes de confirmar.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Teléfono/ }), { target: { value: '1111223344' } })
    expect(screen.queryByText('Revisá los datos marcados antes de confirmar.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Elegir otro horario' })).toBeNull()
    confirmar()
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('un rechazo confirmado por la base permite corregir y reintentar', async () => {
    await formulario()
    crear.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'El email no es válido' } })
    confirmar()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).not.toBeDisabled())
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
    expect(screen.getByRole('textbox', { name: /Email/ })).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByRole('textbox', { name: /Email/ }), { target: { value: 'cliente@example.test' } })
    confirmar()
    await screen.findByRole('heading', { name: '¡Turno reservado!' })
    expect(crear).toHaveBeenCalledTimes(2)
  })

  it.each(['excepción', 'sin código', '08007', '40003'])('no reenvía cuando el resultado del envío es incierto: %s', async (caso) => {
    await formulario()
    if (caso === 'excepción') crear.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    else crear.mockResolvedValueOnce({ data: null, error: { message: 'sin respuesta confiable', code: caso === 'sin código' ? undefined : caso } })
    confirmar()
    await screen.findByText(/No pudimos comprobar si la reserva/)
    const form = screen.getByRole('form', { name: 'Revisá y confirmá' })
    fireEvent.submit(form)
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled())
    expect(crear).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: /Nombre y apellido/ })).toHaveValue('Cliente de prueba')
    expect(screen.queryByRole('heading', { name: '¡Turno reservado!' })).not.toBeInTheDocument()
  })

  it('descarta la respuesta del negocio anterior al cambiar de enlace', async () => {
    const view = await formulario()
    const pendiente = diferido()
    crear.mockReturnValueOnce(pendiente.promise)
    confirmar()
    await waitFor(() => expect(crear).toHaveBeenCalledTimes(1))
    catalogo = { ...catalogo, barberia: { ...catalogo.barberia, nombre: 'Otro negocio' } }
    view.rerender(<PublicBooking slug="otro-negocio" />)
    await screen.findByRole('button', { name: /Corte de prueba/ })
    const params = crear.mock.calls[0][0]
    await act(async () => pendiente.resolve({ data: [{ turno_id: 42, fecha: params.p_fecha, hora: params.p_hora, duracion_min: 30 }], error: null }))
    expect(screen.queryByRole('heading', { name: '¡Turno reservado!' })).not.toBeInTheDocument()
    expect(screen.getByText('Otro negocio')).toBeVisible()
    expect(consultarCatalogo).toHaveBeenLastCalledWith({ p_slug: 'otro-negocio' })
  })
})
