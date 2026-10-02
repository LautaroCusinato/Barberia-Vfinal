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
    expect(screen.getByText('No hay conversaciones registradas')).toBeInTheDocument()
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
