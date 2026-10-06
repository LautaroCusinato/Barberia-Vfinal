import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Messages from './Messages'

const conversaciones = [
  {
    id: 1,
    paciente: 'Agustín Molina',
    clienteId: 200,
    ultimaHora: '10:42',
    noLeido: true,
    mensajes: [
      { de: 'paciente', texto: 'Hola, ¿tienen turno hoy?', hora: '10:40' },
      { de: 'bot', texto: 'Sí, a las **15:00**', hora: '10:41' },
    ],
  },
  {
    id: 2,
    paciente: 'Bruno Acosta',
    clienteId: 201,
    ultimaHora: '09:15',
    noLeido: false,
    mensajes: [{ de: 'paciente', texto: 'Quiero un degradé', hora: '09:14' }],
  },
]

function renderFull(props = {}) {
  const onSelectConversation = vi.fn()
  const onSendMessage = vi.fn().mockResolvedValue(true)
  const utils = render(
    <Messages
      full
      conversaciones={conversaciones}
      selectedId={1}
      onSelectConversation={onSelectConversation}
      onSendMessage={onSendMessage}
      {...props}
    />,
  )
  return {
    ...utils,
    onSelectConversation,
    onSendMessage: props.onSendMessage || onSendMessage,
    composer: () => screen.getByRole('textbox', { name: 'Mensaje para Agustín Molina' }),
    enviar: () => screen.getByRole('button', { name: 'Enviar' }),
  }
}

describe('Messages (vista completa)', () => {
  it('muestra el hilo seleccionado con markdown seguro', () => {
    renderFull()
    expect(screen.getByText('Hola, ¿tienen turno hoy?')).toBeInTheDocument()
    expect(screen.getByText('15:00').tagName).toBe('STRONG')
  })

  it('envía el borrador recortado con el cliente y lo limpia si se guardó', async () => {
    const user = userEvent.setup()
    const { composer, enviar, onSendMessage } = renderFull()
    expect(enviar()).toBeDisabled()
    await user.type(composer(), '  Te esperamos  ')
    await user.click(enviar())
    expect(onSendMessage).toHaveBeenCalledWith('Agustín Molina', 'Te esperamos', 200)
    await vi.waitFor(() => expect(composer()).toHaveValue(''))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('conserva el borrador si onSendMessage devuelve false', async () => {
    const user = userEvent.setup()
    const { composer, enviar } = renderFull({ onSendMessage: vi.fn().mockResolvedValue(false) })
    await user.type(composer(), 'No lo pierdas')
    await user.click(enviar())
    expect(await screen.findByRole('alert')).toHaveTextContent('El borrador quedó preservado')
    expect(composer()).toHaveValue('No lo pierdas')
    expect(composer()).toBeEnabled()
  })

  it('conserva el borrador si el envío falla', async () => {
    const user = userEvent.setup()
    const { composer, enviar } = renderFull({ onSendMessage: vi.fn().mockRejectedValue(new Error('offline')) })
    await user.type(composer(), 'Reintentar')
    await user.click(enviar())
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisá tu conexión')
    expect(composer()).toHaveValue('Reintentar')
  })

  it('bloquea el composer mientras envía y evita envíos dobles', async () => {
    const user = userEvent.setup()
    let resolver
    const onSendMessage = vi.fn(() => new Promise((resolve) => { resolver = resolve }))
    const { composer, enviar } = renderFull({ onSendMessage })
    await user.type(composer(), 'Hola')
    await user.click(enviar())
    expect(composer()).toBeDisabled()
    expect(enviar()).toBeDisabled()
    await user.click(enviar())
    expect(onSendMessage).toHaveBeenCalledTimes(1)
    resolver(true)
    await vi.waitFor(() => expect(composer()).toBeEnabled())
  })

  it('Enter envía y Shift+Enter agrega un salto de línea', async () => {
    const user = userEvent.setup()
    const { composer, onSendMessage } = renderFull()
    await user.type(composer(), 'Línea 1{Shift>}{Enter}{/Shift}Línea 2')
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(composer()).toHaveValue('Línea 1\nLínea 2')
    await user.type(composer(), '{Enter}')
    expect(onSendMessage).toHaveBeenCalledWith('Agustín Molina', 'Línea 1\nLínea 2', 200)
  })

  it('no envía borradores en blanco', async () => {
    const user = userEvent.setup()
    const { composer, onSendMessage } = renderFull()
    await user.type(composer(), '   {Enter}')
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it('sin onSendMessage no muestra el composer', () => {
    render(<Messages full conversaciones={conversaciones} selectedId={1} onSelectConversation={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull()
  })

  it('filtra por nombre o por mensaje sin importar acentos', async () => {
    const user = userEvent.setup()
    const { container } = renderFull()
    const buscar = screen.getByRole('textbox', { name: 'Buscar conversaciones' })
    const nombres = () => [...container.querySelectorAll('.conv-list-scroll .conv-name')].map((node) => node.textContent)

    await user.type(buscar, 'agustin')
    expect(nombres()).toEqual(['Agustín Molina'])
    await user.clear(buscar)
    await user.type(buscar, 'DEGRADE')
    expect(nombres()).toEqual(['Bruno Acosta'])
    await user.clear(buscar)
    await user.type(buscar, 'zzz')
    expect(screen.getByText('Sin resultados')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }))
    expect(nombres()).toEqual(['Agustín Molina', 'Bruno Acosta'])
  })

  it('seleccionar una conversación avisa al padre (clic o teclado)', async () => {
    const user = userEvent.setup()
    const { onSelectConversation } = renderFull()
    await user.click(screen.getAllByText('Bruno Acosta')[0])
    expect(onSelectConversation).toHaveBeenCalledWith(2)
    screen.getAllByText('Agustín Molina')[0].closest('[role="button"]').focus()
    await user.keyboard('{Enter}')
    expect(onSelectConversation).toHaveBeenLastCalledWith(1)
  })

  it('sin conversaciones muestra el estado vacío', () => {
    render(<Messages full conversaciones={[]} onSelectConversation={() => {}} />)
    expect(screen.getByText('Todavía no hay conversaciones')).toBeInTheDocument()
  })
})

describe('Messages (resumen)', () => {
  it('muestra hasta 4 conversaciones con vista previa sin markdown', () => {
    const muchas = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, paciente: `Cliente ${index + 1}`, ultimaHora: '10:00', mensajes: [{ de: 'bot', texto: '**Hola**', hora: '10:00' }],
    }))
    render(<Messages conversaciones={muchas} onSelectConversation={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(screen.getAllByText('Hola')).toHaveLength(4)
  })

  it('una conversación sin mensajes muestra un texto de reemplazo', () => {
    render(<Messages conversaciones={[{ id: 1, paciente: 'Ana', mensajes: [] }]} onSelectConversation={() => {}} />)
    expect(screen.getByText('Sin mensajes todavía')).toBeInTheDocument()
  })

  it('sin conversaciones muestra el estado vacío', () => {
    render(<Messages conversaciones={[]} onSelectConversation={() => {}} />)
    expect(screen.getByText('Sin conversaciones recientes')).toBeInTheDocument()
  })
})

describe('Messages · Iniciar chat (tarea 38)', () => {
  const hiloVacio = { id: 'id-300', paciente: 'Carla Nueva', clienteId: 300, ultimaHora: null, noLeido: false, mensajes: [] }

  it('muestra el hilo vacío enfocado y permite escribir el primer mensaje', async () => {
    const user = userEvent.setup()
    const onSendMessage = vi.fn().mockResolvedValue(true)
    render(
      <Messages
        full
        conversaciones={[hiloVacio, ...conversaciones]}
        selectedId="id-300"
        onSelectConversation={() => {}}
        onSendMessage={onSendMessage}
        focusRequest={{ id: 'id-300', n: 1 }}
      />,
    )
    const composer = screen.getByRole('textbox', { name: 'Mensaje para Carla Nueva' })
    await vi.waitFor(() => expect(composer).toHaveFocus())
    expect(screen.getByText(/Nada se envía hasta que toques Enviar/)).toBeInTheDocument()
    expect(onSendMessage).not.toHaveBeenCalled()
    await user.type(composer, 'Hola Carla{Enter}')
    expect(onSendMessage).toHaveBeenCalledWith('Carla Nueva', 'Hola Carla', 300)
  })

  it('no roba el foco si el pedido es para otro hilo o ya se atendió', () => {
    const { rerender } = render(
      <Messages full conversaciones={conversaciones} selectedId={1} onSelectConversation={() => {}} onSendMessage={vi.fn()} focusRequest={{ id: 2, n: 1 }} />,
    )
    expect(screen.getByRole('textbox', { name: 'Mensaje para Agustín Molina' })).not.toHaveFocus()
    rerender(<Messages full conversaciones={conversaciones} selectedId={1} onSelectConversation={() => {}} onSendMessage={vi.fn()} focusRequest={{ id: 2, n: 1 }} />)
    expect(screen.getByRole('textbox', { name: 'Mensaje para Agustín Molina' })).not.toHaveFocus()
  })

  it('explica por qué no se puede enviar (desconectado, pausado, sin plan o teléfono inválido)', () => {
    render(
      <Messages
        full
        conversaciones={[hiloVacio]}
        selectedId="id-300"
        onSelectConversation={() => {}}
        onSendMessage={vi.fn()}
        estadoChatPorCliente={{ 300: { estado: 'bloqueado', mensaje: 'WhatsApp está pausado para este negocio.' } }}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('WhatsApp está pausado para este negocio.')
    // El borrador sigue disponible para cuando se resuelva.
    expect(screen.getByRole('textbox', { name: 'Mensaje para Carla Nueva' })).toBeEnabled()
  })

  it('muestra la verificación en curso y nada cuando está listo', () => {
    const props = { full: true, conversaciones: [hiloVacio], selectedId: 'id-300', onSelectConversation: () => {}, onSendMessage: vi.fn() }
    const { rerender } = render(<Messages {...props} estadoChatPorCliente={{ 300: { estado: 'verificando', mensaje: '' } }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Verificando')
    rerender(<Messages {...props} estadoChatPorCliente={{ 300: { estado: 'listo', mensaje: '' } }} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('si el envío falla muestra el motivo del servidor y conserva el borrador', async () => {
    const user = userEvent.setup()
    const onSendMessage = vi.fn().mockResolvedValue({ ok: false, message: 'El mensaje no se pudo enviar por WhatsApp. El borrador quedó guardado para reintentar.' })
    render(<Messages full conversaciones={[hiloVacio]} selectedId="id-300" onSelectConversation={() => {}} onSendMessage={onSendMessage} />)
    const composer = screen.getByRole('textbox', { name: 'Mensaje para Carla Nueva' })
    await user.type(composer, 'Primer mensaje')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no se pudo enviar por WhatsApp')
    expect(composer).toHaveValue('Primer mensaje')
  })

  it('el borrador pertenece a su conversación: cambiar de hilo no lo lleva a otro cliente', async () => {
    const user = userEvent.setup()
    const onSendMessage = vi.fn().mockResolvedValue(true)
    const props = { full: true, conversaciones: [hiloVacio, ...conversaciones], onSelectConversation: () => {}, onSendMessage }
    const { rerender } = render(<Messages {...props} selectedId={1} />)
    await user.type(screen.getByRole('textbox', { name: 'Mensaje para Agustín Molina' }), 'Sólo para Agustín')
    rerender(<Messages {...props} selectedId="id-300" focusRequest={{ id: 'id-300', n: 1 }} />)
    const carla = screen.getByRole('textbox', { name: 'Mensaje para Carla Nueva' })
    expect(carla).toHaveValue('')
    await user.type(carla, '{Enter}')
    expect(onSendMessage).not.toHaveBeenCalled()
    rerender(<Messages {...props} selectedId={1} />)
    expect(screen.getByRole('textbox', { name: 'Mensaje para Agustín Molina' })).toHaveValue('Sólo para Agustín')
  })
})

describe('Messages · pedido de foco consumido', () => {
  it('avisa que atendió el pedido para que no se repita al volver a la vista', async () => {
    const onFocusRequestHandled = vi.fn()
    render(<Messages full conversaciones={conversaciones} selectedId={1} onSelectConversation={() => {}} onSendMessage={vi.fn()} focusRequest={{ id: 1, n: 3 }} onFocusRequestHandled={onFocusRequestHandled} />)
    await vi.waitFor(() => expect(onFocusRequestHandled).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('textbox', { name: 'Mensaje para Agustín Molina' })).toHaveFocus()
  })
})

describe('Messages · resultados de envío (revisión 38)', () => {
  const hilo = { id: 'id-300', paciente: 'Carla Nueva', clienteId: 300, ultimaHora: null, noLeido: false, mensajes: [] }

  it('posible duplicado: conserva el borrador y sólo reenvía con confirmación explícita', async () => {
    const user = userEvent.setup()
    const onSendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'Este mismo mensaje se envió o quedó sin confirmar hace instantes.', confirmable: true })
      .mockResolvedValueOnce(true)
    render(<Messages full conversaciones={[hilo]} selectedId="id-300" onSelectConversation={() => {}} onSendMessage={onSendMessage} />)
    const composer = screen.getByRole('textbox', { name: 'Mensaje para Carla Nueva' })
    await user.type(composer, 'Hola{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('hace instantes')
    expect(composer).toHaveValue('Hola')
    expect(onSendMessage).toHaveBeenLastCalledWith('Carla Nueva', 'Hola', 300)
    await user.click(screen.getByRole('button', { name: 'Enviar de todos modos' }))
    expect(onSendMessage).toHaveBeenLastCalledWith('Carla Nueva', 'Hola', 300, { confirmarReenvio: true })
    await vi.waitFor(() => expect(composer).toHaveValue(''))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('un error común no ofrece reenviar', async () => {
    const user = userEvent.setup()
    render(<Messages full conversaciones={[hilo]} selectedId="id-300" onSelectConversation={() => {}} onSendMessage={vi.fn().mockResolvedValue({ ok: false, message: 'WhatsApp rechazó el envío.' })} />)
    await user.type(screen.getByRole('textbox', { name: 'Mensaje para Carla Nueva' }), 'Hola{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('rechazó')
    expect(screen.queryByRole('button', { name: 'Enviar de todos modos' })).toBeNull()
  })

  it('envío incierto: limpia el borrador (el texto queda en el hilo) y explica qué revisar', async () => {
    const user = userEvent.setup()
    render(<Messages full conversaciones={[hilo]} selectedId="id-300" onSelectConversation={() => {}} onSendMessage={vi.fn().mockResolvedValue({ ok: true, aviso: 'WhatsApp no confirmó el envío: puede haber llegado.' })} />)
    const composer = screen.getByRole('textbox', { name: 'Mensaje para Carla Nueva' })
    await user.type(composer, 'Hola{Enter}')
    expect(await screen.findByRole('status')).toHaveTextContent('puede haber llegado')
    expect(composer).toHaveValue('')
  })

  it('muestra el estado de envío de los mensajes del equipo', () => {
    const conEstados = {
      ...hilo,
      mensajes: [
        { id: 1, de: 'clinica', texto: 'Uno', hora: '10:00', estado_envio: 'enviado' },
        { id: 2, de: 'clinica', texto: 'Dos', hora: '10:01', estado_envio: 'incierto' },
        { id: 3, de: 'clinica', texto: 'Tres', hora: '10:02', estado_envio: 'pendiente' },
        { id: 4, de: 'clinica', texto: 'Cuatro', hora: '10:03', estado_envio: 'fallido' },
        { id: 5, de: 'paciente', texto: 'Cinco', hora: '10:04', estado_envio: 'incierto' },
        { id: 6, de: 'clinica', texto: 'Seis', hora: '10:05', estado_envio: 'recibido_n8n' },
        { id: 7, de: 'clinica', texto: 'Siete', hora: '10:06', estado_envio: 'aceptado' },
        { id: 8, de: 'clinica', texto: 'Ocho', hora: '10:07', estado_envio: 'entregado' },
      ],
    }
    const { container } = render(<Messages full conversaciones={[conEstados]} selectedId="id-300" onSelectConversation={() => {}} />)
    const metas = [...container.querySelectorAll('.bubble-meta')].map((n) => n.textContent)
    expect(metas).toEqual([
      'Vos · 10:00',
      'Vos · 10:01 · Sin confirmar',
      'Vos · 10:02 · Enviando…',
      'Vos · 10:03 · No enviado',
      '10:04',
      'Vos · 10:05 · En cola de envío',
      'Vos · 10:06 · Enviado a WhatsApp',
      'Vos · 10:07 · Entregado',
    ])
    // "Entregado" sólo aparece con evidencia de entrega (estado 'entregado').
    expect(metas.filter((m) => m.includes('Entregado'))).toEqual(['Vos · 10:07 · Entregado'])
  })
})
